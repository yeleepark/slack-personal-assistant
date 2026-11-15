#!/bin/zsh
# 현재 폴더·node·claude 경로 기준으로 launchd 상시 실행을 등록한다 (로그인 시 자동 시작, 죽으면 재시작).
set -e
cd "$(dirname "$0")"
DIR="$PWD"
NODE="$(command -v node)" || { echo "node 가 없습니다 (Node 22+ 필요)"; exit 1; }
CLAUDE="$(command -v claude)" || { echo "claude CLI 가 없습니다"; exit 1; }
[ -s .env ] || { echo ".env 가 비어 있습니다. .env.example 참고해서 채우세요."; exit 1; }
[ -d node_modules ] || pnpm install
LABEL="local.slack-claude-bridge"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
UID_=$(id -u)
launchctl bootout "gui/$UID_/$LABEL" 2>/dev/null || true
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array>
    <string>$NODE</string><string>--env-file=.env</string><string>bridge.mjs</string>
  </array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>$(dirname "$NODE"):$(dirname "$CLAUDE"):/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$DIR/bridge.log</string>
  <key>StandardErrorPath</key><string>$DIR/bridge.log</string>
</dict></plist>
PL
launchctl bootstrap "gui/$UID_" "$PLIST"
echo "등록: $LABEL (로그: $DIR/bridge.log)"
echo "해제: launchctl bootout gui/$UID_/$LABEL && rm $PLIST"
