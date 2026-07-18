'use strict';

/**
 * Solapi (구 CoolSMS) 알림톡 provider.
 * 문서: https://developers.solapi.com  (알림톡 = 카카오 채널 발신프로필 pfId + 템플릿 templateId)
 *
 * 필요한 환경변수:
 *   SOLAPI_API_KEY       API 키
 *   SOLAPI_API_SECRET    API 시크릿
 *   ALIMTALK_PF_ID       카카오 발신프로필 ID (pfId)
 *   ALIMTALK_TEMPLATE_ID 승인된 템플릿 ID
 *   ALIMTALK_SENDER      대체발송(SMS/LMS)용 발신번호 (사전 등록 필요, 권장)
 *
 * 변수 치환: Solapi는 템플릿의 #{키} 형식 변수를 kakaoOptions.variables 로 채웁니다.
 */

const crypto = require('crypto');

const API_KEY = process.env.SOLAPI_API_KEY || '';
const API_SECRET = process.env.SOLAPI_API_SECRET || '';
const PF_ID = process.env.ALIMTALK_PF_ID || '';
const TEMPLATE_ID = process.env.ALIMTALK_TEMPLATE_ID || '';
const SENDER = process.env.ALIMTALK_SENDER || '';

const ENDPOINT = 'https://api.solapi.com/messages/v4/send';

function authHeader() {
  const date = new Date().toISOString();
  const salt = crypto.randomBytes(32).toString('hex');
  const signature = crypto
    .createHmac('sha256', API_SECRET)
    .update(date + salt)
    .digest('hex');
  return `HMAC-SHA256 apiKey=${API_KEY}, date=${date}, salt=${salt}, signature=${signature}`;
}

// { name: '홍길동' } → { '#{name}': '홍길동' }
function toKakaoVariables(variables = {}) {
  const out = {};
  for (const [k, v] of Object.entries(variables)) {
    out[`#{${k}}`] = String(v ?? '');
  }
  return out;
}

module.exports = {
  id: 'solapi',
  label: 'Solapi(CoolSMS) 알림톡',

  isConfigured() {
    return Boolean(API_KEY && API_SECRET && PF_ID && TEMPLATE_ID);
  },

  /**
   * @param {object} args
   * @param {string} args.to          수신번호 (하이픈 유무 무관)
   * @param {string} args.text        대체발송 시 사용할 본문(알림톡 본문은 승인 템플릿을 따름)
   * @param {object} [args.variables] 템플릿 변수 { key: value }
   * @param {boolean} [args.disableSms] 대체발송(SMS) 비활성화 여부
   */
  async send({ to, text, variables, disableSms = false }) {
    const message = {
      to: String(to || '').replace(/[^0-9]/g, ''),
      kakaoOptions: {
        pfId: PF_ID,
        templateId: TEMPLATE_ID,
        variables: toKakaoVariables(variables),
        disableSms,
      },
    };
    // 대체발송(알림톡 실패 시 SMS/LMS)용 발신번호와 본문
    if (SENDER) {
      message.from = SENDER.replace(/[^0-9]/g, '');
      if (text) message.text = text;
    }

    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: authHeader(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message }),
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = body.errorMessage || body.message || `HTTP ${res.status}`;
      throw new Error(`Solapi 오류: ${msg}`);
    }
    // 개별 메시지 실패는 failedMessageList 로 반환됩니다.
    if (body.failedMessageList && body.failedMessageList.length) {
      const f = body.failedMessageList[0];
      throw new Error(`Solapi 발송 실패: ${f.reason || f.statusMessage || '알 수 없음'}`);
    }
    return { ok: true, providerMessageId: body.groupId || body.messageId || null };
  },
};
