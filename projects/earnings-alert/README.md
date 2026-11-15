# earnings-alert

제휴 수익을 한 곳에서 확인하는 슬랙 봇입니다.

- 매일 정해진 시각에 **전날 수익**을 슬랙으로 알립니다. 소스별 금액, 이번 달 누적, **전일 대비 증감**을 함께 보여 줍니다.
- 슬랙에서 **`/블로그수익`** 슬래시 커맨드를 치거나 앱을 **멘션**하면 그 자리에서 조회해서 답합니다.

| 소스 | 방식 |
| --- | --- |
| 쿠팡 파트너스 | API 키가 있으면 공식 API, 없으면 대시보드 읽기 |
| 마이리얼트립 | 대시보드 읽기 (API는 `MYREALTRIP_MODE=api`) |
| 네이버 브랜드커넥트 | 대시보드 읽기 (공개 API 없음) — 쇼핑 커넥트 *판매 실적*의 예상 수익 |

## 동작 방식

```
launchd 매일 16:30 ─┐
슬랙 /블로그수익 ───┼─> report.mjs ──> 각 소스 조회 ──> 합산·전일 대비 ──> 슬랙
슬랙 앱 멘션 ───────┘
```

대시보드 읽기는 Playwright로 **로그인해 둔 전용 Chrome**(원격 디버깅 포트 9333)에 붙어서 화면 텍스트를 읽습니다. 계정 정보를 코드나 `.env`에 저장하지 않고, 사람이 한 번 로그인한 세션을 재사용합니다.

## 준비물

- macOS (launchd 사용), Node.js 22 이상, pnpm, Google Chrome
- 슬랙 워크스페이스와 앱

## 설치

```sh
pnpm install
cp .env.example .env     # 값 채우기 (아래 참고)
./open-chrome.sh         # 열린 Chrome 창에서 각 사이트에 직접 로그인 (로그인 상태 유지 체크)
./install.sh             # launchd 등록
```

### 1. 슬랙 앱 만들기

1. <https://api.slack.com/apps> → **Create New App → From scratch**
2. **Incoming Webhooks** 켜고 알림 받을 채널에 웹훅 추가 → URL을 `SLACK_WEBHOOK_URL`에
3. (슬래시 커맨드·멘션을 쓰려면)
   - **Socket Mode** 켜기 → App-Level Token(`connections:write`) → `SLACK_APP_TOKEN` (`xapp-…`)
   - **Event Subscriptions** 켜고 봇 이벤트 `app_mention` 추가
   - **Slash Commands** → `/블로그수익` 생성 (Request URL 불필요)
   - **OAuth & Permissions** 봇 권한에 `chat:write`, `app_mentions:read`, `commands`
   - 워크스페이스에 설치(권한을 바꿀 때마다 재설치) → Bot Token → `SLACK_BOT_TOKEN` (`xoxb-…`)

### 2. `.env`

| 변수 | 설명 |
| --- | --- |
| `SLACK_WEBHOOK_URL` | 정기 알림용 웹훅 |
| `SLACK_MENTION` | 알림이 울리도록 메시지 앞에 붙는 멘션 (`<!channel>` 등) |
| `SLACK_APP_TOKEN`, `SLACK_BOT_TOKEN` | 슬래시 커맨드·멘션 응답용 (없으면 리스너는 꺼짐) |
| `COUPANG_ACCESS_KEY`, `COUPANG_SECRET_KEY` | 쿠팡 파트너스 API (최종 승인 후 발급, 없으면 대시보드 읽기) |
| `MYREALTRIP_API_KEY`, `MYREALTRIP_MODE` | 마이리얼트립 API 사용 시 |
| `BRANDCONNECT_ID` | 브랜드커넥트 주소 `brandconnect.naver.com/<ID>/…`의 숫자 |
| `CDP_URL` | 전용 Chrome 주소 (기본 `http://127.0.0.1:9333`) |

## 실행

```sh
node --env-file=.env src/index.mjs          # 지금 한 번 알림 보내기
node --env-file=.env src/index.mjs --test   # 슬랙 연결 테스트
node --env-file=.env src/listen.mjs         # 슬래시 커맨드·멘션 리스너 (install.sh 가 상시 실행으로 등록)
```

## 알아둘 점

- **16:30에 알리는 이유**: 쿠팡 대시보드가 전일자 데이터를 오후 4시 전후에 반영합니다.
- **브랜드커넥트 금액**은 주문 발생 기준 *예상 수익*(부가세 포함)이라 확정 정산 금액과 다를 수 있습니다.
- **마이리얼트립 API**는 허용 IP 제한으로 403이 날 수 있어 대시보드 읽기를 기본으로 합니다. 수익이 있는 날의 표 구조는 첫 수익이 생긴 뒤 한 번 대조해 보세요.
- **대시보드 읽기는 화면 구조에 의존**합니다. 사이트가 바뀌면 깨질 수 있고, 로그인이 만료되면 슬랙으로 "다시 로그인해 주세요"가 옵니다.
- 본인 계정의 본인 데이터를 읽는 용도입니다. 각 서비스의 이용약관을 확인하세요.
- `history.json`(전일 대비용 수익 기록), `.chrome-profile/`(로그인 세션), `*.log`는 개인 정보라 커밋되지 않습니다.
