#!/bin/zsh
# 맥미니 등에서 한 번 실행: 현재 폴더·node 경로 기준으로 launchd 작업을 등록한다.
#   - 매일 16:30 전체 수익 알림 (전일자 데이터가 오후 4시 전후로 반영되므로)
#   - (.env 에 SLACK_APP_TOKEN, SLACK_BOT_TOKEN 이 있으면) 슬랙 멘션 응답 리스너 상시 실행
set -e
cd "$(dirname "$0")"
DIR="$PWD"
NODE="$(command -v node)" || { echo "node 가 없습니다 (Node 22+ 필요)"; exit 1; }
[ -s .env ] || { echo ".env 가 비어 있습니다. .env.example 참고해서 채우세요."; exit 1; }
UID_=$(id -u)
PREFIX="local.earnings-alert"   # launchd 라벨 접두사

unload() { launchctl bootout "gui/$UID_/$1" 2>/dev/null || true; rm -f "$HOME/Library/LaunchAgents/$1.plist"; }
load() { launchctl bootstrap "gui/$UID_" "$HOME/Library/LaunchAgents/$1.plist"; echo "등록: $1"; }

# 1) 매일 16:30 알림
L=$PREFIX.daily
unload $L
cat > "$HOME/Library/LaunchAgents/$L.plist" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$L</string>
  <key>ProgramArguments</key><array>
    <string>$NODE</string><string>--env-file=.env</string><string>src/index.mjs</string>
  </array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>16</integer><key>Minute</key><integer>30</integer></dict>
  <key>StandardOutPath</key><string>$DIR/run.log</string>
  <key>StandardErrorPath</key><string>$DIR/run.log</string>
</dict></plist>
PL
load $L

# 2) 멘션 응답 리스너 (토큰이 있을 때만)
L=$PREFIX.listen
unload $L
if grep -q '^SLACK_APP_TOKEN=.\+' .env && grep -q '^SLACK_BOT_TOKEN=.\+' .env; then
  cat > "$HOME/Library/LaunchAgents/$L.plist" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$L</string>
  <key>ProgramArguments</key><array>
    <string>$NODE</string><string>--env-file=.env</string><string>src/listen.mjs</string>
  </array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$DIR/listen.log</string>
  <key>StandardErrorPath</key><string>$DIR/listen.log</string>
</dict></plist>
PL
  load $L
else
  echo "멘션 응답 리스너는 건너뜀 (.env 에 SLACK_APP_TOKEN / SLACK_BOT_TOKEN 없음)"
fi

echo "지금 테스트: node --env-file=.env src/index.mjs"
echo "맥미니가 자지 않게: sudo pmset -a sleep 0"
