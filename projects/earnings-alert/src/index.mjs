import { sendSlack } from "./slack.mjs";
import { buildReport } from "./report.mjs";

// 사용: index.mjs        → 전체 수익 알림 (매일 16:30, 전일자 데이터가 오후 4시 전후로 반영되므로)
//       index.mjs --test → 슬랙 연결 테스트
if (process.argv.includes("--test")) {
  await sendSlack("✅ 수익 알림 봇 연결 테스트");
  process.exit(0);
}

const text = await buildReport();
if (text) await sendSlack(text); // 연동된 소스가 하나도 없으면 빈 알림을 보내지 않는다
