// 공식 문서: https://docs.myrealtrip.com/#/api/getting-started  (GET /v1/revenues, Bearer 인증)
// date: "YYYYMMDD" — 해당 일자 정산(SETTLEMENT) 기준 커미션 합계(원)
export async function myrealtripEarnings(date) {
  const d = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}`;
  const url = `https://partner-ext-api.myrealtrip.com/v1/revenues?dateSearchType=SETTLEMENT&startDate=${d}&endDate=${d}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.MYREALTRIP_API_KEY}` } });
  if (!res.ok && !(res.headers.get("content-type") ?? "").includes("json")) {
    throw new Error(`MRT HTTP ${res.status} (API 가 아닌 차단 페이지 응답 — 키 권한/허용 IP 확인 필요)`);
  }
  const json = await res.json();
  if (json.result?.status !== 200) throw new Error(`MRT ${json.result?.status}: ${json.result?.message}`);
  return (json.data ?? []).reduce((s, r) => s + Number(r.commission ?? 0), 0);
}
