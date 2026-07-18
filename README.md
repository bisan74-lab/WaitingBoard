# 🍽 WaitingBoard — 식당 대기 관리 앱

손님이 **QR로 접속해 직접 대기 등록**하고, 관리자는 **실시간 대시보드**에서 대기 현황을 관리하며 손님에게 **카카오톡 호출 메시지**를 보낼 수 있는 웹 앱입니다.

## 주요 기능

- **손님 셀프 등록** (`/`): QR 스캔 → 이름·연락처·인원수·요청사항 입력 → 대기번호 발급
- **내 순번 확인** (`/status/:id`): 앞에 몇 팀 남았는지 실시간(자동 새로고침) 확인
- **관리자 대시보드** (`/admin`):
  - 대기/호출 목록, 대기 인원 통계, 경과 대기 시간 표시
  - **실시간 갱신** (SSE) — 손님이 등록하면 즉시 목록에 반영
  - **카카오톡 호출** 버튼 — 자리 준비 시 메시지 발송 (착석/취소 처리)
  - **QR 코드** 표시·인쇄
  - **설정** — 가게 이름, 카카오톡 메시지 템플릿 편집

## 기술 스택

- 백엔드: Node.js + Express (네이티브 의존성 없음)
- 저장소: JSON 파일(`data/store.json`) — 소규모 매장용. 필요 시 `src/db.js`만 교체하면 SQLite/Postgres로 확장 가능
- QR: `qrcode` (서버에서 생성)
- 프런트: 순수 HTML/CSS/JS (빌드 불필요)
- 실시간: Server-Sent Events

## 실행

```bash
npm install
npm start
# http://localhost:3000/       (손님 등록)
# http://localhost:3000/admin  (관리자)
```

## 환경 변수 (선택)

| 변수 | 설명 |
|------|------|
| `PORT` | 서버 포트 (기본 3000) |
| `PUBLIC_URL` | 외부 접속 주소. QR/링크 생성 시 사용 (예: `https://wait.myshop.com`) |
| `ADMIN_PASSCODE` | 설정 시 관리자 화면 접근에 암호 필요 (미설정 시 개방) |
| `KAKAO_ACCESS_TOKEN` | 카카오 액세스 토큰. 설정 시 실제 카카오톡 발송(아래 참고) |

## 카카오톡 / 알림톡 발송

발송은 **provider 교체 구조**로 되어 있어 환경변수 `MESSAGING_PROVIDER`로 업체를 고릅니다. 미설정 시 안전하게 데모 모드로 폴백합니다.

| provider | 설명 | 실제 손님 발송 |
|----------|------|:---:|
| `demo` (기본) | 발송 없이 콘솔에 기록만. 흐름 확인용 | – |
| `solapi` | Solapi(CoolSMS) 알림톡 | ✅ |
| `nhncloud` | NHN Cloud(Toast) 비즈메시지 알림톡 | ✅ |
| `aligo` | Aligo(알리고) 알림톡 | ✅ |
| `kakao_memo` | 카카오 "나에게 보내기"(연동 검증용) | – |
| `auto` | 설정이 완료된 알림톡 provider를 자동 선택 | ✅ |

> **왜 대행사인가요?** 한국의 알림톡은 카카오가 개별 사업자에게 직접 API를 열어주지 않고, 인증된 **중계 대행사(솔루션 업체)**를 통해 발송합니다. 업체마다 인증/페이로드가 달라 `src/providers/*.js`로 어댑터를 분리했습니다.

### 알림톡 사용 준비(공통)

1. 카카오톡 채널 개설 → 비즈니스 채널 전환
2. 대행사(위 표)에 발신프로필 등록 및 심사
3. **알림톡 템플릿** 등록·승인 (본문에 `#{name}` `#{store}` 등 변수 사용)
4. 승인받은 **발신프로필 키/ID**, **템플릿 코드/ID**를 환경변수에 설정

이 앱이 채워주는 표준 템플릿 변수: `name`(이름) · `party`(인원수) · `store`(매장명) · `number`(대기번호) · `url`(순번 확인 링크). 승인 템플릿에서 `#{name}` 처럼 사용하세요.

### 업체별 환경변수

`.env.example`를 복사해 채우면 됩니다. 사용하는 업체 것만 채우세요.

```bash
# 예: Solapi 사용
MESSAGING_PROVIDER=solapi
SOLAPI_API_KEY=...          SOLAPI_API_SECRET=...
ALIMTALK_PF_ID=...          ALIMTALK_TEMPLATE_ID=...
ALIMTALK_SENDER=025550000   # 대체발송(SMS)용 발신번호

# 예: NHN Cloud 사용
MESSAGING_PROVIDER=nhncloud
NHN_ALIMTALK_APPKEY=...      NHN_ALIMTALK_SECRET=...
ALIMTALK_SENDER_KEY=...      ALIMTALK_TEMPLATE_CODE=...

# 예: Aligo 사용
MESSAGING_PROVIDER=aligo
ALIGO_API_KEY=...            ALIGO_USER_ID=...
ALIMTALK_SENDER_KEY=...      ALIMTALK_TEMPLATE_CODE=...  ALIMTALK_SENDER=025550000
```

알림톡은 승인 템플릿과 본문이 일치해야 하며, 발송 실패 시 SMS로 **대체발송**되도록 구성했습니다(발신번호 설정 시). 새 업체를 추가하려면 `src/providers/`에 `{ id, label, isConfigured(), send() }` 형태의 파일 하나만 추가하고 `src/kakao.js`에 등록하면 됩니다.

## 프로젝트 구조

```
WaitingBoard/
├── server.js          # Express 서버 · API · SSE · QR
├── src/
│   ├── db.js          # JSON 파일 저장소 (교체 지점)
│   ├── kakao.js       # 발송 디스패처 (provider 선택/폴백)
│   └── providers/     # 알림톡 어댑터
│       ├── demo.js        # 데모(발송 안 함)
│       ├── solapi.js      # Solapi(CoolSMS)
│       ├── nhncloud.js    # NHN Cloud(Toast)
│       ├── aligo.js       # Aligo(알리고)
│       └── kakao_memo.js  # 카카오 나에게 보내기
├── public/
│   ├── index.html     # 손님 대기 등록
│   ├── status.html    # 손님 내 순번 확인
│   ├── admin.html     # 관리자 대시보드
│   └── styles.css
└── data/store.json    # 런타임 데이터(gitignore)
```
