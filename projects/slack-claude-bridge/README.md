# slack-claude-bridge

슬랙에 올린 글·사진·폴더 경로를 **맥에서 돌아가는 Claude Code 작업**으로 넘기고, 진행 상황과 결과를 스레드로 돌려줍니다. ([전체 소개](../../README.md))

외출 중에도 폰의 슬랙에서 "이 사진들로 글 써줘", "이 폴더 정리해줘"처럼 시키면, 집의 맥(맥미니 등)이 작업합니다. 슬랙 Socket Mode라 공개 URL이나 포트 개방이 필요 없습니다.

```
슬랙 DM / 작업 채널 ──> bridge.mjs ──> claude -p (작업 폴더에서 실행) ──> 스레드에 진행 상황·결과
        ▲                                     │
        └──── 같은 스레드에 답장하면 같은 세션으로 이어서 ───┘
```

## 동작

| 하는 일 | 방법 |
| --- | --- |
| 새 작업 시작 | DM 또는 작업 채널에 **최상위 메시지**로 요청 (스킬을 붙이려면 `SKILL_COMMAND`) |
| 사진 여러 장 | 슬랙은 메시지당 10장까지라 **나눠 올려도** 일정 시간(기본 90초) 안이면 한 작업으로 묶음. `끝`을 올리면 바로 시작 |
| 큰 폴더 | 메시지에 로컬 경로(`~/Pictures/trip` 등)를 쓰면 그 폴더를 읽음. 경로가 있으면 기다리지 않고 바로 시작 |
| 이어서 말하기 | 봇이 만든 **스레드에 답장**하면 같은 Claude 세션으로 이어짐 (질문 답변, 수정 요청) |
| 진행 상황 | 스레드의 메시지 하나가 `⏳ 이미지 확인 중 (12장째) · 경과 3:20` → `✅ 완료`로 갱신됨 |
| 취소 | 스레드에 `취소` |
| 상태 반응 | ⏳ 묶는 중 · 👀 처리 중 · ✅ 완료 · ❌ 실패 |

작업은 **한 번에 하나씩** 순서대로 처리합니다 (브라우저 프로필 같은 공유 자원 보호).

## 준비물

- macOS, Node.js 22 이상, pnpm, [Claude Code](https://claude.com/claude-code) CLI(로그인 완료)
- 슬랙 워크스페이스

## 설치

```sh
pnpm install
cp .env.example .env     # 값 채우기 (아래 참고)
pnpm start               # 먼저 눈으로 확인
./install.sh             # 되면 launchd로 상시 실행 등록
```

### 슬랙 앱 만들기

1. <https://api.slack.com/apps> → **Create New App → From a manifest** → 워크스페이스 선택 → `slack-app-manifest.yaml` 내용 붙여넣기 → 생성 → **Install to Workspace**
2. **Basic Information → App-Level Tokens → Generate Token**: 스코프 `connections:write` → `xapp-…` 가 `SLACK_APP_TOKEN`
3. **OAuth & Permissions**의 Bot User OAuth Token(`xoxb-…`)이 `SLACK_BOT_TOKEN`
4. 슬랙 프로필 → ⋯ → **멤버 ID 복사**가 `SLACK_ALLOWED_USER`
5. 작업 채널을 쓰려면 채널을 만들고 `/invite @Claude Bridge` → 채널 ID(채널 정보 맨 아래)를 `SLACK_WORK_CHANNEL`에 입력. 비우면 DM만 받습니다.

## 설정 (.env)

| 변수 | 의미 |
| --- | --- |
| `SLACK_BOT_TOKEN` / `SLACK_APP_TOKEN` | 슬랙 앱 토큰 |
| `SLACK_ALLOWED_USER` | **이 사용자의 메시지만** 처리 |
| `SLACK_WORK_CHANNEL` | 작업 채널 ID (선택) |
| `CLAUDE_WORKDIR` | Claude Code를 실행할 폴더 (기본: 이 폴더). 스킬이나 `CLAUDE.md`가 있는 폴더로 지정 |
| `SKILL_COMMAND` | 새 작업 앞에 붙일 스킬/슬래시 커맨드 (선택) |
| `BATCH_SECONDS` / `TIMEOUT_MINUTES` | 묶음 대기 시간 / 작업 최대 시간 |
| `ALLOWED_TOOLS` | 미리 허용할 도구(쉼표 구분) |

개인 설정 파일(둘 다 gitignore):

- `prompt.md` — 채널에서 새 작업을 시작할 때 요청 앞에 붙는 지시 ([prompt.example.md](prompt.example.md) 복사)
- `phases.json` — 진행 메시지 단계 이름 규칙 ([phases.example.json](phases.example.json) 복사)

## 보안

헤드리스 실행이라 승인 팝업이 없어서, **미리 허용한 도구만** 쓰도록 했습니다(`ALLOWED_TOOLS`). `git push`, `git merge`, `gh pr`은 막혀 있습니다. 그래도 Bash 일부를 허용하면 그 범위 안에서 맥을 조작할 수 있으니 다음을 지키세요.

- `SLACK_ALLOWED_USER`를 반드시 본인으로 설정합니다. 이 값이 없으면 시작하지 않습니다.
- 봇을 초대한 채널에는 믿을 수 있는 사람만 둡니다 (허용 사용자 외 메시지는 무시되지만 채널은 보이므로).
- `.env`(토큰), `sessions.json`, `inbox/`(내려받은 첨부)는 커밋되지 않습니다.
