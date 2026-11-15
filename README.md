# automations

개인 업무를 자동화하는 작은 도구들을 모아 두는 저장소입니다. 프로젝트마다 `projects/<이름>/` 폴더에 독립적으로 들어 있고, 각자 README·`.env.example`·설치 스크립트를 가집니다.

## 프로젝트

| 프로젝트 | 설명 |
| --- | --- |
| [earnings-alert](projects/earnings-alert) | 쿠팡 파트너스·마이리얼트립·네이버 브랜드커넥트 제휴 수익을 모아 슬랙으로 알려 주고, 슬랙에서 바로 조회할 수 있는 봇 |

## 규칙

- 새 프로젝트는 `projects/<이름>/` 아래에 만들고, 위 표에 한 줄 추가합니다.
- 비밀값(API 키, 토큰, 웹훅 URL)은 `.env`에만 두고 커밋하지 않습니다. 필요한 항목은 `.env.example`에 빈 값으로 적습니다.
- 로그인 세션·수익 기록 같은 개인 데이터(`.chrome-profile/`, `history.json`, `*.log`)도 커밋하지 않습니다. 루트 `.gitignore`가 막아 둡니다.
