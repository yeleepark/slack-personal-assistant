// 브랜드커넥트: 공개 API 없음 → 로그인된 전용 Chrome(CDP)에서 쇼핑 커넥트 '판매 실적'을 읽는다.
// 판매 실적 = 주문 발생 기준 '예상 수익'(부가세 포함, 정산 금액과 다를 수 있음). 요약 카드는 반올림("1천 원")이라
// 정확한 금액은 상품별 표의 '예상 수익'을 합산해서 쓴다.
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CDP = process.env.CDP_URL || "http://127.0.0.1:9333";
const OPEN_CHROME = fileURLToPath(new URL("../open-chrome.sh", import.meta.url));
// 브랜드커넥트 주소의 숫자 = 본인 크리에이터 ID (예: brandconnect.naver.com/<ID>/affiliate/...)
const CREATOR_ID = process.env.BRANDCONNECT_ID;
const URL_SALES = `https://brandconnect.naver.com/${CREATOR_ID}/affiliate/sales-dashboard`;
const num = (s) => Number(String(s).replace(/[^\d]/g, "")) || 0;
const up = () => fetch(`${CDP}/json/version`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok, () => false);

async function ensureChrome() {
  if (await up()) return;
  execFileSync("sh", [OPEN_CHROME], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) {
    if (await up()) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("전용 Chrome 을 열지 못함");
}

// "2026-11-14" 달력 칸 클릭 (react-datepicker: aria-label="Choose 2026년 11월 14일 ...")
async function pickDay(page, iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const cell = page.locator(`[aria-label^="Choose ${y}년 ${m}월 ${d}일"]`).first();
  await cell.waitFor({ timeout: 8000 });
  await cell.click();
  await page.waitForTimeout(400);
}

async function query(page, start, end) {
  await page.getByText("직접 선택", { exact: true }).first().click();
  await page.getByLabel("시작 날짜를 선택하세요").click();
  await pickDay(page, start);
  if (!(await page.locator(`[aria-label^="Choose ${end.slice(0, 4)}년"]`).first().isVisible().catch(() => false))) {
    await page.getByLabel("종료 날짜를 선택하세요").click();
  }
  await pickDay(page, end);
  await page.getByRole("button", { name: "조회하기" }).click();
  await page.waitForTimeout(3000);
  const body = await page.locator("body").innerText();
  const orders = body.match(/상품주문 건수\s+([\d,]+)\s*건/);
  const clicks = body.match(/클릭 수\s+([\d,]+)\s*회/);
  const rows = await page.locator("table tbody tr").evaluateAll((trs) =>
    trs.map((tr) => [...tr.querySelectorAll("td")].map((td) => td.innerText.trim())).filter((c) => c.length >= 5),
  );
  return {
    clicks: clicks ? num(clicks[1]) : 0,
    orders: orders ? num(orders[1]) : 0,
    sold: rows.reduce((s, c) => s + num(c[2]), 0),
    revenue: rows.reduce((s, c) => s + num(c[4]), 0),
  };
}

// date: "YYYYMMDD" (어제) → { revenue, clicks, sold, monthRevenue }
export async function brandconnectEarnings(date) {
  const day = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}`;
  const monthStart = `${day.slice(0, 7)}-01`;
  if (!CREATOR_ID) throw new Error("BRANDCONNECT_ID 가 .env 에 없어요 (브랜드커넥트 주소의 숫자)");
  await ensureChrome();
  const browser = await chromium.connectOverCDP(CDP, { timeout: 15000 });
  const page = await browser.contexts()[0].newPage();
  try {
    await page.goto(URL_SALES);
    await page.waitForTimeout(2500);
    if (/nidlogin|nid\.naver\.com/.test(page.url())) {
      throw new Error("브랜드커넥트(네이버) 로그인이 만료된 것 같아요. open-chrome.sh 로 연 창에서 다시 로그인해 주세요");
    }
    try {
      await page.getByText("실적 요약").first().waitFor({ timeout: 20000 });
    } catch {
      throw new Error("브랜드커넥트 판매 실적 화면 구조가 바뀐 것 같아요");
    }
    const yesterday = await query(page, day, day);
    let monthRevenue = yesterday.revenue;
    if (monthStart !== day) monthRevenue = (await query(page, monthStart, day)).revenue;
    return { ...yesterday, monthRevenue };
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
