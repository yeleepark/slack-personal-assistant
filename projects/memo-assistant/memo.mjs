// 슬랙 메모 채널 비서. Socket Mode라 공개 URL이 필요 없다.
// - 메모 채널에 적은 글을 Claude(헤드리스)가 해석한다
//     일정 → 구글 캘린더(claude.ai 커넥터)에 등록 / 할 일 → todos.json 에 저장
// - 할 일은 완료할 때까지 REMIND_MINUTES 마다 스레드로 다시 알린다 (알림 허용 시간대에만)
// - 완료: 원글이나 봇 답글에 ✅ 리액션, 또는 스레드에 "완료"
// - "할일" 이라고 쓰면 남은 할 일 목록을 보여 준다
import { App } from '@slack/bolt';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const env = process.env;
const { SLACK_BOT_TOKEN, SLACK_APP_TOKEN, SLACK_ALLOWED_USER, SLACK_MEMO_CHANNEL } = env;
for (const [k, v] of Object.entries({ SLACK_BOT_TOKEN, SLACK_APP_TOKEN, SLACK_ALLOWED_USER, SLACK_MEMO_CHANNEL })) {
  if (!v) { console.error(`.env에 ${k}가 없습니다`); process.exit(1); }
}
const MODEL = env.CLAUDE_MODEL || 'sonnet';
const REMIND_MS = Number(env.REMIND_MINUTES || 120) * 60 * 1000;
const FROM = Number(env.REMIND_FROM || 9);
const TO = Number(env.REMIND_TO || 22);
const STORE = join(HERE, 'todos.json');
const DONE_RE = /^(완료|done|✅|끝)$/i;
const LIST_RE = /^(할 ?일|todo|목록)$/i;
const TOOLS = ['create_event', 'update_event', 'delete_event', 'list_events', 'search_events', 'get_event']
  .map((t) => `mcp__claude_ai_Google_Calendar__${t}`);

const app = new App({ token: SLACK_BOT_TOKEN, appToken: SLACK_APP_TOKEN, socketMode: true });

// ---- 저장소 (원자적 쓰기) ----
const load = () => (existsSync(STORE) ? JSON.parse(readFileSync(STORE, 'utf8')) : []);
const save = (t) => { writeFileSync(STORE + '.tmp', JSON.stringify(t, null, 2)); renameSync(STORE + '.tmp', STORE); };

// ---- 시간 ----
const kst = (d = new Date()) => new Date(d.getTime() + 9 * 3600e3);
const hourKST = () => kst().getUTCHours();
const inWindow = () => { const h = hourKST(); return h >= FROM && h < TO; };
const fmtDue = (iso) => {
  const d = kst(new Date(iso));
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};

// ---- Claude 해석 ----
const SYS = `너는 슬랙 메모 채널의 개인 비서다. 사용자의 메모 한 건을 해석해 처리한다. 되묻지 말고 합리적으로 가정해 끝까지 처리한다.
- 일정(날짜/시간이 정해진 약속·행사): Google Calendar 도구로 기본 캘린더에 바로 등록한다. 시간대는 Asia/Seoul. 종료 시각이 없으면 1시간, 시간 없이 날짜만 있으면 종일 일정. 등록 전 list_events 로 같은 제목·시간의 중복을 확인한다.
- 할 일(해야 할 행동): 캘린더에 넣지 말고 결과 JSON의 todos 에 담는다. 기한이 말해졌으면 due(ISO8601, +09:00)에 넣고 없으면 null.
- 한 메모에 일정과 할 일이 섞여 있으면 각각 처리한다. 일정이 아니고 할 일도 아닌 단순 메모는 reply 로 짧게 답한다.
- 일정 수정·삭제는 사용자가 명시적으로 요청했을 때만 한다.
마지막 출력은 반드시 아래 JSON 한 개만 코드펜스 없이 낸다:
{"events":[{"title":"","start":"ISO8601 또는 YYYY-MM-DD","link":"캘린더 이벤트 링크 또는 null"}],"todos":[{"title":"","due":null}],"reply":"사용자에게 보낼 한두 줄 (비워도 됨)"}`;

function runClaude(text) {
  const now = kst().toISOString().replace('Z', '+09:00');
  const prompt = `현재 시각(KST): ${now}\n\n메모:\n${text}`;
  return new Promise((resolve) => {
    const args = ['-p', prompt, '--output-format', 'json', '--model', MODEL,
      '--permission-mode', 'acceptEdits', '--allowedTools', ...TOOLS, '--append-system-prompt', SYS];
    const child = spawn('claude', args, { cwd: HERE, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 5 * 60 * 1000);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => { clearTimeout(timer); resolve({ error: `claude 실행 실패: ${e.message}` }); });
    child.on('close', () => {
      clearTimeout(timer);
      try {
        const res = JSON.parse(out).result || '';
        const m = res.match(/\{[\s\S]*\}\s*$/);
        resolve({ data: JSON.parse(m ? m[0] : res) });
      } catch { resolve({ error: `해석 실패: ${(err || out).slice(0, 300)}` }); }
    });
  });
}

// 메모는 한 번에 하나씩 처리 (캘린더 중복 등록 방지)
let queue = Promise.resolve();
const enqueue = (fn) => (queue = queue.then(fn, fn));

const say = (channel, thread_ts, text) => app.client.chat.postMessage({ channel, thread_ts, text });
const react = (channel, ts, name) => app.client.reactions.add({ channel, timestamp: ts, name }).catch(() => {});

function listText(todos) {
  const open = todos.filter((t) => !t.done);
  if (!open.length) return '남은 할 일이 없습니다 🎉';
  return '*남은 할 일*\n' + open.map((t, i) => `${i + 1}. ${t.title}${t.due ? ` (기한 ${fmtDue(t.due)})` : ''}`).join('\n');
}

function complete(todos, pred) {
  const hit = todos.filter((t) => !t.done && pred(t));
  hit.forEach((t) => { t.done = true; t.doneAt = new Date().toISOString(); });
  return hit;
}

// ---- 메시지 ----
app.message(async ({ message }) => {
  if (message.channel !== SLACK_MEMO_CHANNEL || message.user !== SLACK_ALLOWED_USER || message.subtype) return;
  const text = (message.text || '').trim();
  if (!text) return;

  // 스레드 안의 "완료"
  if (message.thread_ts) {
    if (!DONE_RE.test(text)) return;
    const todos = load();
    const hit = complete(todos, (t) => t.ts === message.thread_ts || t.botTs === message.thread_ts);
    if (hit.length) { save(todos); await react(message.channel, message.ts, 'white_check_mark'); }
    return;
  }
  if (LIST_RE.test(text)) return void say(message.channel, message.ts, listText(load()));

  enqueue(async () => {
    await react(message.channel, message.ts, 'eyes');
    const { data, error } = await runClaude(text);
    app.client.reactions.remove({ channel: message.channel, timestamp: message.ts, name: 'eyes' }).catch(() => {});
    if (error) return void (await say(message.channel, message.ts, `⚠️ ${error}`));

    const lines = [];
    for (const e of data.events || []) lines.push(`📅 *${e.title}* — ${e.start}${e.link ? ` <${e.link}|열기>` : ''}`);
    const todos = load();
    const added = [];
    for (const t of data.todos || []) {
      const item = { id: `${message.ts}-${added.length}`, title: t.title, due: t.due || null, ts: message.ts,
        channel: message.channel, created: new Date().toISOString(), lastRemind: null, done: false };
      todos.push(item); added.push(item);
      lines.push(`📝 *${t.title}*${t.due ? ` (기한 ${fmtDue(t.due)})` : ''}`);
    }
    if (added.length) lines.push('_완료하면 이 메시지에 ✅ 를 누르거나 "완료"라고 답하세요. 그때까지 알려 드립니다._');
    if (data.reply) lines.push(data.reply);
    const sent = await say(message.channel, message.ts, lines.join('\n') || '처리할 내용이 없습니다.');
    added.forEach((t) => (t.botTs = sent.ts));
    if (added.length) save(todos);
    await react(message.channel, message.ts, added.length || (data.events || []).length ? 'white_check_mark' : 'memo');
  });
});

// ✅ 리액션 = 완료 (원글 또는 봇 답글)
app.event('reaction_added', async ({ event }) => {
  if (event.user !== SLACK_ALLOWED_USER || event.reaction !== 'white_check_mark') return;
  if (event.item.channel !== SLACK_MEMO_CHANNEL) return;
  const todos = load();
  const hit = complete(todos, (t) => t.ts === event.item.ts || t.botTs === event.item.ts);
  if (hit.length) { save(todos); await say(event.item.channel, event.item.ts, `✅ 완료: ${hit.map((t) => t.title).join(', ')}`); }
});

// ---- 재알림 ----
async function remindTick() {
  if (!inWindow()) return;
  const todos = load();
  const now = Date.now();
  let changed = false;
  for (const t of todos) {
    if (t.done) continue;
    const dueMs = t.due ? new Date(t.due).getTime() : null;
    if (dueMs && now < dueMs - 30 * 60 * 1000) continue;       // 기한 30분 전부터 알림 시작
    if (t.lastRemind && now - new Date(t.lastRemind).getTime() < REMIND_MS) continue;
    if (!t.lastRemind && !dueMs && now - new Date(t.created).getTime() < REMIND_MS) continue; // 갓 만든 건 첫 간격 뒤에
    const late = dueMs && now > dueMs ? ' ⏰ 기한이 지났어요' : dueMs ? ` (기한 ${fmtDue(t.due)})` : '';
    try {
      await say(t.channel, t.ts, `<@${SLACK_ALLOWED_USER}> 🔔 아직 안 끝났어요: *${t.title}*${late}\n_끝났으면 ✅ 또는 "완료"_`);
      t.lastRemind = new Date().toISOString(); changed = true;
    } catch (e) { console.error('알림 실패', e.message); }
  }
  if (changed) save(todos);
}

await app.start();
setInterval(() => remindTick().catch((e) => console.error(e)), 60 * 1000);
console.log('memo-assistant 시작', new Date().toISOString());
