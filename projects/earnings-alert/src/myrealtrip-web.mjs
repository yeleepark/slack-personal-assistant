// 마이리얼트립 파트너 대시보드(수익 현황, 예약일 기준)를 로그인된 전용 Chrome(CDP)에서 읽는다.
// 기본 조회 범위 = 이번 달 → 날짜별 행에서 어제 값을, 전체 행 합계로 이번 달 누적을 구한다.
// 주의: 수익이 있는 행의 실제 표 구조는 아직 확인 못 함(수익 0원 상태에서 작성). 첫 수익 발생 후 점검 필요.
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CDP = process.env.CDP_URL || "http://127.0.0.1:9333";
const OPEN_CHROME = fileURLToPath(new URL("../open-chrome.sh", import.meta.url));
const URL_SALES = "https://partner.myrealtrip.com/partnership-marketing/sales";
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

// date: "YYYYMMDD" (어제) → { revenue, reservations, monthRevenue }
export async function myrealtripDashboard(date) {
  const day = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}`;
  await ensureChrome();
  const browser = await chromium.connectOverCDP(CDP, { timeout: 15000 });
  const page = await browser.contexts()[0].newPage();
  try {
    await page.goto(URL_SALES);
    await page.waitForTimeout(2500);
    if (page.url().includes("/signin")) {
      throw new Error("마이리얼트립 로그인이 만료된 것 같아요. open-chrome.sh 로 연 창에서 다시 로그인해 주세요");
    }
    try {
      await page.getByText("예약 수").first().waitFor({ timeout: 20000 });
    } catch {
      throw new Error("마이리얼트립 수익 현황 화면 구조가 바뀐 것 같아요");
    }
    await page.waitForTimeout(2500); // 표 데이터 로딩 대기

    // 요약표 행: 첫 칸이 날짜이고 칸 수가 적은 행 (상세표는 칸이 10개 이상)
    const rows = await page.locator("tr").evaluateAll((trs) =>
      trs
        .map((tr) => [...tr.querySelectorAll("td")].map((td) => td.innerText.trim()))
        .filter((c) => c.length >= 3 && c.length <= 7 && /^\d{4}-\d{2}-\d{2}/.test(c[0])),
    );
    const today = rows.find((c) => c[0].startsWith(day));
    return {
      reservations: today ? num(today[1]) : 0,
      revenue: today ? num(today[2]) : 0,
      monthRevenue: rows.reduce((s, c) => s + num(c[2]), 0),
    };
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
