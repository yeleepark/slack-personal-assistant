import { coupangCommission } from "./coupang.mjs";
import { coupangDashboard } from "./coupang-web.mjs";
import { myrealtripEarnings } from "./myrealtrip.mjs";
import { myrealtripDashboard } from "./myrealtrip-web.mjs";
import { brandconnectEarnings } from "./browser.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// 일별 수익 기록 (전일 대비 계산용). 개인 수익 정보라 .gitignore 에 포함.
const HISTORY = fileURLToPath(new URL("../history.json", import.meta.url));
const loadHistory = () => { try { return JSON.parse(readFileSync(HISTORY, "utf8")); } catch { return {}; } };
const prevDate = (d) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6)) - 864e5).toISOString().slice(0, 10).replace(/-/g, "");
const delta = (cur, prev) => (prev == null || cur == null ? null : cur - prev);
const arrow = (n) => (n > 0 ? `▲${won(n)}` : n < 0 ? `▼${won(-n)}` : "변동 없음");

const won = (n) => (n == null ? "미연동" : `${n.toLocaleString("ko-KR")}원`);
const fmt = (v) => (typeof v === "string" ? v : won(v));
const obj = (v) => v && typeof v === "object";
const fmtCp = (v) =>
  obj(v) ? `${won(v.revenue)} (클릭 ${v.clicks} · 구매 ${v.orders}건) · 이번 달 누적 ${won(v.monthRevenue)}` : fmt(v);
const fmtMrt = (v) =>
  obj(v) ? `${won(v.revenue)} (예약 ${v.reservations}건) · 이번 달 누적 ${won(v.monthRevenue)}` : fmt(v);
const fmtBc = (v) =>
  obj(v)
    ? `${won(v.revenue)} (클릭 ${v.clicks} · 판매 ${v.sold}개) · 이번 달 누적 ${won(v.monthRevenue)} _(예상 수익)_`
    : fmt(v);
const val = (v) => (obj(v) ? v.revenue : v);

const sources = [
  { label: "쿠팡 파트너스", fn: process.env.COUPANG_ACCESS_KEY ? coupangCommission : coupangDashboard, fmt: fmtCp },
  // API 는 허용 IP 문제로 403 → 기본은 대시보드 읽기. MYREALTRIP_MODE=api 로 바꾸면 API 사용
  { label: "마이리얼트립", fn: process.env.MYREALTRIP_MODE === "api" ? myrealtripEarnings : myrealtripDashboard, fmt: fmtMrt },
  { label: "브랜드커넥트", fn: brandconnectEarnings, fmt: fmtBc },
];
sources[1].fmt = fmtMrt;

// 어제 기준 제휴 수익 메시지를 만든다. 전부 미연동이면 null.
export async function buildReport() {
  const y = new Date(Date.now() - 864e5);
  const date = y.toISOString().slice(0, 10).replace(/-/g, "");
  const results = [];
  // 같은 Chrome 을 쓰므로 순서대로 실행 (동시에 열면 Chrome 이 꺼져 있을 때 창이 겹침)
  for (const s of sources) {
    try { results.push(await s.fn(date)); } catch (e) { results.push(`오류: ${e.message}`); }
  }
  if (results.every((r) => r == null)) return null;
  const nums = results.map(val);
  const total = nums.filter((v) => typeof v === "number").reduce((a, b) => a + b, 0);

  // 전일 기록과 비교 → 오늘 값은 (오류가 아닌 것만) 기록. 같은 날짜는 최신 값으로 덮어쓴다.
  const hist = loadHistory();
  const prev = hist[prevDate(date)];
  const today = { ...(hist[date] ?? {}) };
  sources.forEach((s, i) => { if (typeof nums[i] === "number") today[s.label] = nums[i]; });
  hist[date] = today;
  writeFileSync(HISTORY, JSON.stringify(hist, null, 1));

  const lines = sources.map((s, i) => {
    const d = prev ? delta(nums[i], prev[s.label]) : null;
    return `• ${s.label}: ${s.fmt(results[i])}${d != null ? ` · 전일 대비 ${arrow(d)}` : ""}`;
  });
  const prevTotal = prev ? Object.values(prev).reduce((a, b) => a + b, 0) : null;
  lines.push(`*합계: ${won(total)}*${prevTotal != null ? ` (전일 ${won(prevTotal)} → ${arrow(total - prevTotal)})` : " _(전일 기록이 없어 비교는 내일부터)_"}`);
  return [`💰 *${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)} 제휴 수익*`, ...lines].join("\n");
}
