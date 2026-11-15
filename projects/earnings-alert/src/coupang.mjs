import { createHmac } from "node:crypto";

const HOST = "https://api-gateway.coupang.com";
const BASE = "/v2/providers/affiliate_open_api/apis/openapi/v1";

function authHeader(method, pathWithQuery) {
  const [path, query = ""] = pathWithQuery.split("?");
  const d = new Date().toISOString().replace(/[-:]/g, "").slice(2, 15) + "Z"; // yymmddTHHmmssZ (GMT)
  const sig = createHmac("sha256", process.env.COUPANG_SECRET_KEY)
    .update(d + method + path + query)
    .digest("hex");
  return `CEA algorithm=HmacSHA256, access-key=${process.env.COUPANG_ACCESS_KEY}, signed-date=${d}, signature=${sig}`;
}

// date: "YYYYMMDD" — 해당 일자 커미션 합계(원)
export async function coupangCommission(date) {
  const p = `${BASE}/reports/commission?startDate=${date}&endDate=${date}`;
  const res = await fetch(HOST + p, { headers: { Authorization: authHeader("GET", p) } });
  const json = await res.json();
  if (json.rCode !== "0") throw new Error(`Coupang ${json.rCode}: ${json.rMessage}`);
  const rows = json.data ?? [];
  return rows.reduce((s, r) => s + Number(r.commission ?? 0), 0);
}
