// 슬랙에서 앱을 멘션하면(@Blog Earnings Alert) 지금 수익을 조회해서 그 스레드에 답한다.
// Socket Mode(공개 URL 불필요) 사용: .env 에 SLACK_APP_TOKEN(xapp-…), SLACK_BOT_TOKEN(xoxb-…) 필요.
import { buildReport } from "./report.mjs";

const APP = process.env.SLACK_APP_TOKEN;
const BOT = process.env.SLACK_BOT_TOKEN;
if (!APP || !BOT) {
  console.error("SLACK_APP_TOKEN / SLACK_BOT_TOKEN 이 .env 에 없습니다");
  process.exit(1);
}

const log = (...a) => console.log(new Date().toISOString(), ...a);
const api = async (method, token, body) => {
  const r = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body ?? {}),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(`${method}: ${j.error}`);
  return j;
};
const say = (channel, thread_ts, text) => api("chat.postMessage", BOT, { channel, thread_ts, text });

let busy = false;
const seen = new Set();

async function onMention(ev) {
  if (seen.has(ev.ts)) return;
  seen.add(ev.ts);
  const thread = ev.thread_ts || ev.ts;
  if (busy) return say(ev.channel, thread, "⏳ 이미 조회 중이에요. 끝나면 알려 드릴게요.");
  busy = true;
  try {
    await say(ev.channel, thread, "⏳ 조회 중이에요 (1분쯤 걸려요)");
    const text = await buildReport();
    await say(ev.channel, thread, text ?? "연동된 항목이 없어요.");
  } catch (e) {
    await say(ev.channel, thread, `오류: ${e.message}`).catch(() => {});
  } finally {
    busy = false;
  }
}

// 슬래시 커맨드(/earnings): 즉시 ack 로 "조회 중" 안내 → 끝나면 response_url 로 채널에 결과 게시
async function onSlash(cmd) {
  busy = true;
  try {
    const text = (await buildReport()) ?? "연동된 항목이 없어요.";
    await fetch(cmd.response_url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ response_type: "in_channel", text }),
    });
  } catch (e) {
    await fetch(cmd.response_url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ response_type: "ephemeral", text: `오류: ${e.message}` }),
    }).catch(() => {});
  } finally {
    busy = false;
  }
}

let delay = 2000;
async function connect() {
  let url;
  try {
    ({ url } = await api("apps.connections.open", APP));
  } catch (e) {
    log("연결 실패:", e.message, `→ ${delay / 1000}s 후 재시도`);
    setTimeout(connect, delay);
    delay = Math.min(delay * 2, 60000);
    return;
  }
  const ws = new WebSocket(url);
  ws.onopen = () => { delay = 2000; log("Slack Socket Mode 연결됨"); };
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.type === "slash_commands") {
      const wasBusy = busy;
      ws.send(JSON.stringify({
        envelope_id: msg.envelope_id,
        payload: { response_type: "ephemeral", text: wasBusy ? "⏳ 이미 조회 중이에요. 끝나면 채널에 올라와요." : "⏳ 조회 중이에요 (1분쯤 걸려요)" },
      }));
      if (!wasBusy) onSlash(msg.payload).catch((e) => log("슬래시 처리 오류:", e.message));
      return;
    }
    if (msg.envelope_id) ws.send(JSON.stringify({ envelope_id: msg.envelope_id })); // 즉시 ack
    if (msg.type === "events_api" && msg.payload?.event?.type === "app_mention" && !msg.retry_attempt) {
      onMention(msg.payload.event).catch((e) => log("처리 오류:", e.message));
    }
  };
  ws.onclose = () => { log("연결 끊김 → 재연결"); setTimeout(connect, delay); };
  ws.onerror = (e) => log("ws 오류:", e.message ?? "");
}
connect();
