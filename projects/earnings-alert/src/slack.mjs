export async function sendSlack(text, blocks) {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) throw new Error("SLACK_WEBHOOK_URL 이 비어 있음");
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: `${process.env.SLACK_MENTION ? process.env.SLACK_MENTION + " " : ""}${text}`, blocks }),
  });
  if (!res.ok) throw new Error(`Slack ${res.status}: ${await res.text()}`);
}
