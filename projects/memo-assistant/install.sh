#!/bin/zsh
# 한 번 실행: 의존성 설치 후 launchd 로 상시 실행 등록한다 (재부팅·크래시 시 자동 재시작).
set -e
cd "$(dirname "$0")"
DIR="$PWD"
NODE="$(command -v node)" || { echo "node 가 없습니다 (Node 22+ 필요)"; exit 1; }
command -v claude >/dev/null || { echo "claude CLI 가 없습니다"; exit 1; }
[ -s .env ] || { echo ".env 가 비어 있습니다. .env.example 참고해서 채우세요."; exit 1; }
command -v pnpm >/dev/null && pnpm install || npm install
L=local.memo-assistant
P="$HOME/Library/LaunchAgents/$L.plist"
launchctl bootout "gui/$(id -u)/$L" 2>/dev/null || true
cat > "$P" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$L</string>
  <key>ProgramArguments</key><array>
    <string>$NODE</string><string>--env-file=.env</string><string>memo.mjs</string>
  </array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$(dirname "$NODE"):$(dirname "$(command -v claude)"):/usr/local/bin:/usr/bin:/bin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$DIR/memo.log</string>
  <key>StandardErrorPath</key><string>$DIR/memo.log</string>
</dict></plist>
PL
launchctl bootstrap "gui/$(id -u)" "$P"
echo "등록: $L  (로그: $DIR/memo.log)"
echo "맥미니가 자지 않게: sudo pmset -a sleep 0"
