# memo-assistant

슬랙 메모 채널에 적으면 알아서 처리합니다.

| 이렇게 적으면 | 이렇게 됩니다 |
| --- | --- |
| `내일 오후 3시 치과` | 구글 캘린더에 일정 등록, 스레드로 링크 답장 |
| `금요일까지 세금 서류 제출` | 할 일로 저장, 기한 30분 전부터 완료할 때까지 알림 |
| `우유 사기` | 할 일로 저장, 2시간마다 알림 |
| `할일` | 남은 할 일 목록 |

완료하려면 원글(또는 봇 답글)에 ✅ 리액션을 달거나 스레드에 `완료`라고 답하세요. 알림은 기본적으로 09~22시에만 옵니다.

## 동작 방식
Slack Socket Mode로 메시지를 받아 `claude -p`(헤드리스)가 일정/할 일을 가려냅니다. 일정은 claude.ai의 **Google Calendar 커넥터**로 등록하므로 구글 OAuth를 따로 만들 필요가 없습니다. 할 일은 `todos.json`에 저장되고 1분마다 재알림 대상을 확인합니다.

## 설치
1. [api.slack.com/apps](https://api.slack.com/apps) → Create New App → From manifest → `slack-app-manifest.yaml` 붙여넣기
2. Basic Information → App-Level Tokens에서 `connections:write` 토큰 생성 (`xapp-…`), Install to Workspace 후 Bot Token (`xoxb-…`) 복사
3. 메모 채널을 만들고 `/invite @Memo Assistant`, 채널 ID 복사
4. `cp .env.example .env` 후 값 채우기
5. 맥에서 `claude` 로그인(claude.ai 계정) + 해당 계정에 Google Calendar 커넥터 연결
6. `./install.sh`

테스트: `node --env-file=.env memo.mjs` 를 직접 실행해 메모 채널에 글을 적어 보세요.
