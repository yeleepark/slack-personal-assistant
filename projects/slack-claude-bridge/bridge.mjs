// 슬랙 → Claude Code 브리지. Socket Mode라 공개 URL이 필요 없다.
// - 최상위 메시지(DM 또는 작업 채널) = 새 작업(새 세션)
// - 봇이 만든 스레드 안의 답장 = 같은 세션 이어가기
// - 채널에서는 사진·글을 여러 번 나눠 올려도 일정 시간 안이면 한 작업으로 묶는다 ("끝"을 올리면 즉시 시작)
// - 메시지 안의 로컬 폴더 경로를 찾아 작업에 알려 준다
// - 진행 상황을 스레드의 메시지 한 개로 계속 갱신한다
import { App } from '@slack/bolt';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, createWriteStream, statSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const HERE = dirname(fileURLToPath(import.meta.url));
const env = process.env;
const { SLACK_BOT_TOKEN, SLACK_APP_TOKEN, SLACK_ALLOWED_USER, SLACK_WORK_CHANNEL, SKILL_COMMAND } = env;
const WORKDIR = env.CLAUDE_WORKDIR || HERE;
const BATCH_MS = Number(env.BATCH_SECONDS || 90) * 1000;
const TIMEOUT_MS = Number(env.TIMEOUT_MINUTES || 40) * 60 * 1000;
const STORE = join(HERE, 'sessions.json');
const INBOX = join(HERE, 'inbox');
const GO = /^(끝|완료|go)$/i; // 이 말을 올리면 대기 없이 바로 시작
const CANCEL = /^(취소|cancel|stop)$/i;

for (const [k, v] of Object.entries({ SLACK_BOT_TOKEN, SLACK_APP_TOKEN, SLACK_ALLOWED_USER })) {
  if (!v) { console.error(`.env에 ${k}가 없습니다`); process.exit(1); }
}

// 헤드리스라 승인 팝업이 없으므로 필요한 도구만 미리 허용한다 (ALLOWED_TOOLS 로 바꿀 수 있다)
const ALLOWED = (env.ALLOWED_TOOLS || [
  'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Skill',
  'Bash(ls:*)', 'Bash(cat:*)', 'Bash(mkdir:*)', 'Bash(cp:*)', 'Bash(mv:*)',
  'Bash(node:*)', 'Bash(pnpm:*)', 'Bash(python3:*)',
].join(',')).split(/,(?![^()]*\))/).map((s) => s.trim()).filter(Boolean);

const SYS = [
  '이 대화는 슬랙에서 호출됐다. 답변은 슬랙 메시지로 전달되므로 짧고 핵심만 쓴다.',
  '질문이 필요하면 번호 매긴 일반 텍스트로 한 번에 묶어 묻는다(AskUserQuestion 금지).',
  'git push, git merge, PR 생성은 하지 않는다.',
  '슬랙 첨부 파일과 폴더는 로컬 경로로 전달된다.',
].join(' ');

// 채널에서 새 작업을 시작할 때 요청 앞에 붙는 지시 (prompt.md 가 있으면 그걸 쓴다)
const promptFile = join(HERE, 'prompt.md');
const CHANNEL_PROMPT = existsSync(promptFile)
  ? readFileSync(promptFile, 'utf8').replace(/<!--[\s\S]*?-->/g, '').trim()
  : '[슬랙 채널 모드] 되묻지 말고 메모와 첨부만으로 끝까지 처리하고 마지막에 결과를 짧게 요약한다.';

// 진행 단계 이름 규칙 (phases.json 이 있으면 기본 규칙보다 먼저 적용)
const phaseFile = join(HERE, 'phases.json');
const RULES = existsSync(phaseFile) ? JSON.parse(readFileSync(phaseFile, 'utf8')) : [];

const app = new App({ token: SLACK_BOT_TOKEN, appToken: SLACK_APP_TOKEN, socketMode: true });

const load = () => (existsSync(STORE) ? JSON.parse(readFileSync(STORE, 'utf8')) : {});
const save = (s) => writeFileSync(STORE, JSON.stringify(s, null, 2));

// 브라우저 프로필 등 공유 자원이 있을 수 있어 작업은 한 번에 하나씩
let queue = Promise.resolve();
const enqueue = (fn) => (queue = queue.then(fn, fn));
const running = new Map(); // threadTs -> child

function mrkdwn(t) {
  return t
    .replace(/^#{1,6}\s+(.*)$/gm, '*$1*')
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<$2|$1>');
}
function chunks(t, n = 3500) {
  const out = []; let cur = '';
  for (const line of t.split('\n')) {
    if ((cur + line).length > n) { out.push(cur); cur = ''; }
    cur += line + '\n';
  }
  if (cur.trim()) out.push(cur);
  return out;
}

const IMG = /\.(jpe?g|png|heic|heif|webp)$/i;

// 도구 호출 하나를 사람이 읽을 진행 단계로 바꾼다 (모르면 null → 갱신 안 함)
function phaseOf(block, st) {
  const i = block.input || {}, n = block.name;
  const subject = n === 'Bash' ? i.command || '' : i.file_path || i.pattern || '';
  for (const r of RULES) if (r.tool === n && new RegExp(r.match).test(subject)) return r.label;
  if (n === 'Read' && IMG.test(i.file_path || '')) { st.imgs++; return `이미지 확인 중 (${st.imgs}장째)`; }
  if (n === 'WebSearch' || n === 'WebFetch') return '정보 조사 중';
  if (n === 'Write' || n === 'Edit') return '파일 작성·수정 중';
  if (n === 'Bash') return '명령 실행 중';
  return null;
}

function runClaude({ prompt, sessionId, threadTs, onProgress }) {
  return new Promise((resolve0) => {
    let settled = false;
    const resolve = (v) => { if (!settled) { settled = true; resolve0(v); } };
    const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose',
      '--permission-mode', 'acceptEdits',
      '--allowedTools', ...ALLOWED,
      '--disallowedTools', 'Bash(git push:*)', 'Bash(git merge:*)', 'Bash(gh pr:*)',
      '--append-system-prompt', SYS];
    if (sessionId) args.push('--resume', sessionId);
    const child = spawn('claude', args, { cwd: WORKDIR, stdio: ['ignore', 'pipe', 'pipe'] });
    running.set(threadTs, child);
    let buf = '', err = '', result = null, sid = null;
    const st = { imgs: 0 };
    child.on('error', (e) => { running.delete(threadTs); resolve({ error: `claude 실행 실패: ${e.message}` }); });
    child.stderr.on('data', (d) => (err += d));
    child.stdout.on('data', (d) => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        let j; try { j = JSON.parse(line); } catch { continue; }
        if (j.session_id) sid = j.session_id;
        if (j.type === 'result') {
          // 결과가 나왔으면 바로 완료 처리. 작업 중 띄운 자식 프로세스가 남아 claude가 안 끝나는 경우를 막는다
          result = j;
          resolve({ text: j.result ?? '', sessionId: j.session_id || sid, error: j.is_error ? j.result : null });
          setTimeout(() => child.kill('SIGTERM'), 5000);
        }
        if (j.type === 'assistant') {
          for (const blk of j.message?.content || []) {
            if (blk.type === 'tool_use') { const ph = phaseOf(blk, st); if (ph) onProgress?.(ph); }
          }
        }
      }
    });
    const timer = setTimeout(() => child.kill('SIGTERM'), TIMEOUT_MS);
    child.on('close', (code, sig) => {
      clearTimeout(timer); running.delete(threadTs);
      if (result) return resolve({ text: result.result ?? '', sessionId: result.session_id || sid, error: result.is_error ? result.result : null });
      if (sig) return resolve({ error: `중단됨(${sig})`, sessionId: sid });
      resolve({ error: (err || `exit ${code}`).slice(-1500), sessionId: sid });
    });
  });
}

async function download(files, ts) {
  if (!files?.length) return [];
  const dir = join(INBOX, ts.replace('.', '_'));
  mkdirSync(dir, { recursive: true });
  const paths = [];
  for (const f of files) {
    const url = f.url_private_download || f.url_private;
    if (!url) continue;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` } });
    if (!res.ok) continue;
    const p = join(dir, basename(f.name || f.id));
    await pipeline(Readable.fromWeb(res.body), createWriteStream(p));
    paths.push(p);
  }
  return paths;
}

// 메시지 안의 로컬 폴더 경로(/…, ~/…, 따옴표·백틱 가능, 공백 포함 가능)를 찾는다
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
function findFolders(text) {
  const found = [];
  const add = (raw) => {
    raw = raw.trim().replace(/[.,)]+$/, '');
    let path = raw.startsWith('~') ? join(homedir(), raw.slice(1)) : raw;
    if (/^(Users|home)\//.test(path)) path = '/' + path; // 선행 슬래시 누락 보정
    if (!isDir(path)) return false;
    found.push({ path, n: readdirSync(path).filter((f) => IMG.test(f)).length });
    return true;
  };
  for (const m of text.matchAll(/[`"'“”]([~/UH][^`"'“”\n]+)[`"'“”]/g)) add(m[1]);
  if (found.length) return found;
  // 감싸지 않은 경로: 단어를 하나씩 줄여가며 실제 존재하는 가장 긴 폴더를 찾는다
  for (const m of text.matchAll(/(?:^|\s)((?:~\/|\/|Users\/|home\/)\S*)/g)) {
    const rest = text.slice(m.index + m[0].length - m[1].length).split('\n')[0].split(/\s+/);
    for (let k = rest.length; k > 0; k--) if (add(rest.slice(0, k).join(' '))) break;
  }
  return found;
}

async function startJob({ channel, threadTs, text, files, channelMode, sessionId, firstTs }) {
  const say = (t) => app.client.chat.postMessage({ token: SLACK_BOT_TOKEN, channel, thread_ts: threadTs, text: t, mrkdwn: true });
  const react = (name, add = true) =>
    app.client.reactions[add ? 'add' : 'remove']({ token: SLACK_BOT_TOKEN, channel, timestamp: firstTs, name }).catch(() => {});

  const photos = await download(files, firstTs).catch(() => []);
  const folders = findFolders(text || '');
  const missing = folders.filter((f) => f.n < 0);
  if (missing.length) await say(`⚠️ 찾지 못한 경로: ${missing.map((f) => '`' + f.path + '`').join(', ')}`);
  const folderNote = folders.filter((f) => f.n >= 0)
    .map((f) => `\n\n[폴더] ${f.path} (이미지 ${f.n}장). 파일명 순서대로 처리한다.`).join('');
  const photoNote = folderNote + (photos.length ? `\n\n[슬랙 첨부 ${photos.length}개, 올린 순서]\n${photos.join('\n')}` : '');
  const head0 = sessionId ? '' : [SKILL_COMMAND, channelMode ? CHANNEL_PROMPT : ''].filter(Boolean).join(' ');
  const prompt = `${head0 ? head0 + '\n\n' : ''}${text || '(메모 없음, 첨부만)'}${photoNote}`.trim();

  await react('eyes');
  const n = folders.filter((f) => f.n >= 0).reduce((a, f) => a + f.n, 0) + photos.length;
  const started = Date.now();
  const mmss = () => { const t = Math.floor((Date.now() - started) / 1000); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
  const head = await say(`⏳ 작업 시작${n ? ` · 첨부 ${n}개` : ''}`).catch(() => null);
  let phase = '준비 중', lastText = '', lastPush = 0;
  const update = async (force) => {
    if (!head?.ts) return;
    const t = `⏳ ${phase} · 경과 ${mmss()}`;
    if (t === lastText && !force) return;
    lastText = t;
    await app.client.chat.update({ token: SLACK_BOT_TOKEN, channel, ts: head.ts, text: t }).catch(() => {});
  };
  const onProgress = (ph) => {
    if (ph === phase) return;
    phase = ph;
    if (Date.now() - lastPush > 4000) { lastPush = Date.now(); update(); }
  };
  enqueue(async () => {
    const tick = setInterval(() => update(true), 30000); // 단계가 안 바뀌어도 경과 시간 갱신
    const r = await runClaude({ prompt, sessionId, threadTs, onProgress });
    clearInterval(tick);
    await react('eyes', false);
    if (r.sessionId) { const s = load(); s[threadTs] = r.sessionId; save(s); }
    if (head?.ts) await app.client.chat.update({ token: SLACK_BOT_TOKEN, channel, ts: head.ts,
      text: r.error ? `❌ 실패 · 경과 ${mmss()}` : `✅ 완료 · 소요 ${mmss()}` }).catch(() => {});
    if (r.error) { await react('x'); await say(`❌ ${r.error}`); return; }
    await react('white_check_mark');
    for (const c of chunks(mrkdwn(r.text || '(빈 응답)'))) await say(c);
  });
}

// 작업 채널: 일정 시간 안에 올린 최상위 메시지들을 하나의 작업으로 묶는다
const batches = new Map(); // channel -> { firstTs, texts, files, timer }
function addToBatch(event) {
  const hasFolder = findFolders(event.text || '').some((f) => f.n >= 0);
  const go = GO.test((event.text || '').trim()) || hasFolder; // 폴더 경로가 있으면 입력이 완결된 것으로 본다
  console.log(new Date().toISOString(), 'channel msg', event.ts, 'files:', event.files?.length || 0, go ? '→ 즉시 시작' : '→ 대기');
  app.client.reactions.add({ token: SLACK_BOT_TOKEN, channel: event.channel, timestamp: event.ts,
    name: go ? 'eyes' : 'hourglass_flowing_sand' }).catch(() => {});
  let b = batches.get(event.channel);
  if (!b) {
    if (go && !hasFolder) return; // 묶을 게 없는데 "끝"만 온 경우
    b = { firstTs: event.ts, texts: [], files: [] };
    batches.set(event.channel, b);
  }
  if (!GO.test((event.text || '').trim()) && event.text?.trim()) b.texts.push(event.text.trim());
  if (event.files?.length) b.files.push(...event.files);
  clearTimeout(b.timer);
  const fire = () => {
    batches.delete(event.channel);
    console.log(new Date().toISOString(), 'job start', b.firstTs, 'texts:', b.texts.length, 'files:', b.files.length);
    startJob({ channel: event.channel, threadTs: b.firstTs, firstTs: b.firstTs,
      text: b.texts.join('\n'), files: b.files, channelMode: true });
  };
  if (go) fire(); else b.timer = setTimeout(fire, BATCH_MS);
}

app.event('message', async ({ event }) => {
  if (event.bot_id) return;
  if (event.subtype && event.subtype !== 'file_share') return;
  if (event.user !== SLACK_ALLOWED_USER) return; // 허용한 사용자 외에는 전부 무시

  const isDM = event.channel_type === 'im';
  const isWork = SLACK_WORK_CHANNEL && event.channel === SLACK_WORK_CHANNEL;
  if (!isDM && !isWork) return;

  const isReply = Boolean(event.thread_ts) && event.thread_ts !== event.ts;
  const threadTs = event.thread_ts || event.ts;
  const text = (event.text || '').trim();

  if (CANCEL.test(text) && running.has(threadTs)) { running.get(threadTs).kill('SIGTERM'); return; }
  if (isWork && !isReply) { addToBatch(event); return; }

  const sessionId = isReply ? load()[threadTs] : undefined;
  if (isReply && !sessionId) {
    await app.client.chat.postMessage({ token: SLACK_BOT_TOKEN, channel: event.channel, thread_ts: threadTs,
      text: '이 스레드의 세션을 찾지 못했어요. 새 작업은 스레드 밖에 새 메시지로 보내주세요.' });
    return;
  }
  await startJob({ channel: event.channel, threadTs, firstTs: event.ts, text, files: event.files,
    channelMode: isWork, sessionId });
});

app.error(async (e) => console.error('slack error', e));
await app.start();
console.log('slack-claude-bridge up');
