'use strict';

/**
 * NHN Cloud (Toast) 카카오 비즈메시지(알림톡) provider.
 * 문서: https://docs.nhncloud.com/ko/Notification/KakaoTalk%20Bizmessage/
 *
 * 필요한 환경변수:
 *   NHN_ALIMTALK_APPKEY      알림톡 서비스 AppKey
 *   NHN_ALIMTALK_SECRET      Secret Key (X-Secret-Key 헤더)
 *   ALIMTALK_SENDER_KEY      발신프로필 키(senderKey)
 *   ALIMTALK_TEMPLATE_CODE   승인된 템플릿 코드
 *
 * 변수 치환: NHN Cloud는 템플릿의 #{키}를 templateParameter { key: value }로 채웁니다.
 */

const APPKEY = process.env.NHN_ALIMTALK_APPKEY || '';
const SECRET = process.env.NHN_ALIMTALK_SECRET || '';
const SENDER_KEY = process.env.ALIMTALK_SENDER_KEY || '';
const TEMPLATE_CODE = process.env.ALIMTALK_TEMPLATE_CODE || '';

// 리전에 따라 도메인이 다를 수 있습니다(기본: 글로벌/한국 공용 엔드포인트).
const BASE =
  process.env.NHN_ALIMTALK_BASE ||
  'https://api-alimtalk.cloud.toast.com';
const API_VERSION = 'v2.3';

module.exports = {
  id: 'nhncloud',
  label: 'NHN Cloud 알림톡',

  isConfigured() {
    return Boolean(APPKEY && SECRET && SENDER_KEY && TEMPLATE_CODE);
  },

  async send({ to, variables }) {
    const url = `${BASE}/alimtalk/${API_VERSION}/appkeys/${APPKEY}/messages`;
    const payload = {
      senderKey: SENDER_KEY,
      templateCode: TEMPLATE_CODE,
      recipientList: [
        {
          recipientNo: String(to || '').replace(/[^0-9]/g, ''),
          templateParameter: variables || {},
        },
      ],
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
        'X-Secret-Key': SECRET,
      },
      body: JSON.stringify(payload),
    });

    const body = await res.json().catch(() => ({}));
    const header = body.header || {};
    if (!res.ok || header.isSuccessful !== true) {
      const msg = header.resultMessage || `HTTP ${res.status}`;
      throw new Error(`NHN Cloud 오류: ${msg}`);
    }
    // 개별 수신자 실패 확인
    const first = (body.message && body.message.sendResults && body.message.sendResults[0]) || null;
    if (first && first.resultCode && first.resultCode !== 0) {
      throw new Error(`NHN Cloud 발송 실패: ${first.resultMessage || first.resultCode}`);
    }
    return { ok: true, providerMessageId: (first && first.requestId) || null };
  },
};
