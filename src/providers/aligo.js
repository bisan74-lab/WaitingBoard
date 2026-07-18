'use strict';

/**
 * Aligo(알리고) 카카오 알림톡 provider.
 * 문서: https://smartsms.aligo.in/admin/api/spec.html (알림톡 API)
 *
 * 발송 전 토큰 발급이 필요합니다(/token/create). 이 모듈은 발송 시점에
 * 토큰을 자동 발급한 뒤 발송합니다.
 *
 * 필요한 환경변수:
 *   ALIGO_API_KEY          API 키
 *   ALIGO_USER_ID          알리고 아이디
 *   ALIMTALK_SENDER_KEY    발신프로필 키(senderkey)
 *   ALIMTALK_TEMPLATE_CODE 승인된 템플릿 코드(tpl_code)
 *   ALIMTALK_SENDER        발신번호(sender) — 대체발송 및 채널 등록 번호
 *
 * 변수 치환: 알리고는 최종 치환된 message 본문을 그대로 전송합니다.
 *          (승인 템플릿과 내용이 일치해야 함)
 */

const API_KEY = process.env.ALIGO_API_KEY || '';
const USER_ID = process.env.ALIGO_USER_ID || '';
const SENDER_KEY = process.env.ALIMTALK_SENDER_KEY || '';
const TEMPLATE_CODE = process.env.ALIMTALK_TEMPLATE_CODE || '';
const SENDER = process.env.ALIMTALK_SENDER || '';

const BASE = 'https://kakaoapi.aligo.in';

async function issueToken() {
  const res = await fetch(`${BASE}/akv10/token/create/30/s/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ apikey: API_KEY, userid: USER_ID }),
  });
  const body = await res.json().catch(() => ({}));
  if (body.code !== 0 || !body.token) {
    throw new Error(`Aligo 토큰 발급 실패: ${body.message || 'unknown'}`);
  }
  return body.token;
}

module.exports = {
  id: 'aligo',
  label: 'Aligo 알림톡',

  isConfigured() {
    return Boolean(API_KEY && USER_ID && SENDER_KEY && TEMPLATE_CODE && SENDER);
  },

  /**
   * @param {object} args
   * @param {string} args.to        수신번호
   * @param {string} args.text      최종 치환된 알림톡 본문(승인 템플릿과 일치)
   * @param {string} [args.subject] 알림톡 제목(강조표기형 템플릿 등에서 사용)
   * @param {string} [args.fallbackText] 대체발송(SMS) 본문
   */
  async send({ to, text, subject, fallbackText }) {
    const token = await issueToken();
    const params = new URLSearchParams({
      apikey: API_KEY,
      userid: USER_ID,
      token,
      senderkey: SENDER_KEY,
      tpl_code: TEMPLATE_CODE,
      sender: SENDER.replace(/[^0-9]/g, ''),
      receiver_1: String(to || '').replace(/[^0-9]/g, ''),
      subject_1: subject || '대기 안내',
      message_1: text,
    });
    // 대체발송(알림톡 실패 시 SMS) 설정
    if (fallbackText) {
      params.set('failover', 'Y');
      params.set('fsubject_1', subject || '대기 안내');
      params.set('fmessage_1', fallbackText);
    }

    const res = await fetch(`${BASE}/akv10/alimtalk/send/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });
    const body = await res.json().catch(() => ({}));
    if (body.code !== 0) {
      throw new Error(`Aligo 발송 실패: ${body.message || `code ${body.code}`}`);
    }
    return { ok: true, providerMessageId: (body.info && body.info.mid) || null };
  },
};
