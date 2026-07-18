# 🍽 WaitingBoard — 식당 대기 관리 앱

손님이 **QR로 접속해 직접 대기 등록**하고, 관리자는 **실시간 대시보드**에서 대기 현황을 관리하며 손님에게 **카카오톡 호출 메시지**를 보낼 수 있는 웹 앱입니다.

## 주요 기능

- **손님 셀프 등록** (`/`): QR 스캔 → 이름·연락처·인원수·요청사항 입력 → 대기번호 발급
- **내 순번 확인** (`/status/:id`): 앞에 몇 팀 남았는지 실시간(자동 새로고침) 확인
- **관리자 대시보드** (`/admin`):
  - 대기/호출 목록, 대기 인원 통계, 경과 대기 시간 표시
  - **자동 갱신**(폴링) — 손님이 등록하면 곧 목록에 반영 (서버리스 호환)
  - **카카오톡 호출** 버튼 — 자리 준비 시 메시지 발송 (착석/취소 처리)
  - **QR 코드** 표시·인쇄
  - **설정** — 가게 이름, 카카오톡 메시지 템플릿 편집
- 손님 등록 화면 우측 상단 **⚙︎ 아이콘**으로 관리자 모드 전환, **모바일 대응** UI

## 기술 스택

- 백엔드: Node.js + Express (네이티브 의존성 없음) — 로컬 서버/Vercel 서버리스 모두 지원
- 저장소: **Redis(Upstash/Vercel KV)** 또는 **JSON 파일** 자동 선택 (`src/stores/`)
  - KV 환경변수가 있으면 Redis, 없으면 파일(로컬 개발)
- QR: `qrcode` (서버에서 생성)
- 프런트: 순수 HTML/CSS/JS (빌드 불필요)

## 로컬 실행

```bash
npm install
npm start
# http://localhost:3000/       (손님 등록)
# http://localhost:3000/admin  (관리자)
```

## Vercel 배포

이 앱은 Vercel 서버리스로 배포할 수 있도록 구성돼 있습니다(`vercel.json`, `api/index.js`). **서버리스는 상태가 없으므로 데이터 유지를 위해 KV(Redis)가 필요합니다.**

1. **GitHub에 푸시** → Vercel에서 **New Project → 이 저장소 Import**
2. **Storage 탭 → KV(Upstash Redis) 생성 후 프로젝트에 연결**
   - 연결하면 `KV_REST_API_URL` / `KV_REST_API_TOKEN` 이 자동으로 주입됩니다.
3. (선택) **Settings → Environment Variables** 에 알림톡/관리자 암호 등 추가
   - `MESSAGING_PROVIDER`, `SOLAPI_*` 등 (아래 "알림톡" 참고), `ADMIN_PASSCODE`
4. **Deploy** → `https://<프로젝트>.vercel.app/` (손님) / `.../admin` (관리자)

이후에는 **GitHub에 push 할 때마다 Vercel이 자동 재배포**합니다(기존에 쓰시던 방식과 동일).

> ⚠️ KV를 연결하지 않으면 서버리스 환경에서 대기 데이터가 요청마다 사라집니다. 반드시 2단계를 진행하세요. (KV 없이 항상 켜진 서버가 필요하면 Render·Railway 등에서는 코드 변경 없이 파일 저장으로도 동작합니다.)

## 환경 변수 (선택)

| 변수 | 설명 |
|------|------|
| `PORT` | 서버 포트 (기본 3000) |
| `PUBLIC_URL` | 외부 접속 주소. QR/링크 생성 시 사용 (Vercel은 보통 자동 감지) |
| `ADMIN_PASSCODE` | 설정 시 관리자 화면 접근에 암호 필요 (미설정 시 개방) |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Redis(Upstash/Vercel KV) 접속 정보. 있으면 Redis 저장소 사용(서버리스 필수) |
| `MESSAGING_PROVIDER` 외 | 알림톡 발송 설정 (아래 참고) |

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
├── server.js          # Express 앱 (app export · 로컬은 listen) · API · QR
├── vercel.json        # Vercel 서버리스 배포 설정
├── api/
│   └── index.js       # Vercel 함수 진입점 (server.js 재사용)
├── src/
│   ├── db.js          # 저장소 백엔드 선택기 (Redis ↔ 파일)
│   ├── stores/
│   │   ├── shared.js      # 공용 기본값/헬퍼
│   │   ├── file.js        # 파일(JSON) 저장소 — 로컬
│   │   └── redis.js       # Redis(Upstash/Vercel KV) — 서버리스
│   ├── kakao.js       # 발송 디스패처 (provider 선택/폴백)
│   └── providers/     # 알림톡 어댑터
│       ├── demo.js        # 데모(발송 안 함)
│       ├── solapi.js      # Solapi(CoolSMS)
│       ├── nhncloud.js    # NHN Cloud(Toast)
│       ├── aligo.js       # Aligo(알리고)
│       └── kakao_memo.js  # 카카오 나에게 보내기
├── public/
│   ├── index.html     # 손님 대기 등록 (⚙︎ 관리자 전환 아이콘)
│   ├── status.html    # 손님 내 순번 확인
│   ├── admin.html     # 관리자 대시보드 (모바일 대응)
│   └── styles.css
└── data/store.json    # 로컬 런타임 데이터(gitignore)
```
