#!/bin/sh
# 대시보드 읽기 전용 크롬 (포트 9333, 별도 프로필). 처음 한 번 여기서 직접 로그인하면 이후 유지된다.
ROOT="$(cd "$(dirname "$0")" && pwd)"
PORT=9333
if curl -s -m 1 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then
  echo "이미 열려 있음 (포트 $PORT)"
else
  open -na "Google Chrome" --args \
    --remote-debugging-port=$PORT \
    --user-data-dir="$ROOT/.chrome-profile" \
    --window-size=1280,900 --no-first-run \
    "https://partners.coupang.com"
  echo "열었음 (포트 $PORT)"
fi
