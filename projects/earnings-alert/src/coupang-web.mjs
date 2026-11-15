// 쿠팡 파트너스 대시보드(로그인된 전용 Chrome, CDP)에서 어제 실적 + 이번 달 누적 수익을 읽는다.
// API 키(최종 승인 필요) 없이 쓰는 임시 방식. 키가 .env 에 있으면 index.mjs 가 API 를 우선 쓴다.
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CDP = process.env.CDP_URL || "http://127.0.0.1:9333";
const OPEN_CHROME = fileURLToPath(new URL("../open-chrome.sh", import.meta.url));
const num = (s) => Number(String(s).replace(/[^\d]/g, ""));
const up = () => fetch(`${CDP}/json/version`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok, () => false);

async function ensureChrome() {
  if (await up()) return;
  execFileSync("sh", [OPEN_CHROME], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) {
    if (await up()) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("쿠팡 전용 Chrome 을 열지 못함");
}

async function readText(page, hash, marker) {
  await page.goto(`https://partners.coupang.com/#affiliate/ws/report/${hash}`);
  try {
    await page.getByText(marker).first().waitFor({ timeout: 20000 });
  } catch {
    throw new Error("쿠팡 로그인이 만료된 것 같아요. open-chrome.sh 로 연 창에서 다시 로그인해 주세요");
  }
  await page.waitForTimeout(1500); // 숫자 렌더링 대기
  return page.locator("body").innerText();
}

// 반환: { revenue, clicks, orders, amount, monthRevenue }  (금액은 원)
export async function coupangDashboard() {
  await ensureChrome();
  const browser = await chromium.connectOverCDP(CDP, { timeout: 15000 });
  const page = await browser.contexts()[0].newPage();
  try {
    const t = await readText(page, "trend", "구매 건수"); // 기본 범위 = 어제
    const m = t.match(/클릭\s+([\d,]+)\s+구매 건수\s+([\d,]+)\s+합산 금액\s+₩([\d,]+)\s+수익\s+₩([\d,]+)/);
    if (!m) throw new Error("쿠팡 기간별 리포트 화면 구조가 바뀐 것 같아요");
    const e = await readText(page, "earning", "수익 요약");
    const mm = e.match(/\d+월 수익\s+₩([\d,]+)/); // 첫 번째 = 이번 달
    return {
      clicks: num(m[1]), orders: num(m[2]), amount: num(m[3]), revenue: num(m[4]),
      monthRevenue: mm ? num(mm[1]) : null,
    };
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {}); // CDP 연결만 끊음 (Chrome 은 유지)
  }
}
