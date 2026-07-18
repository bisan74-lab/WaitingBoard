'use strict';

/**
 * 데모 provider — 실제 발송 없이 콘솔에 기록만 합니다.
 * 환경변수가 없을 때 기본으로 사용되어, 키 없이도 앱 흐름을 확인할 수 있습니다.
 */
module.exports = {
  id: 'demo',
  label: '데모(발송 안 함)',
  isConfigured() {
    return true;
  },
  async send({ to, text }) {
    console.log(`[알림톡:demo] ${to || '(번호없음)'} → ${String(text).replace(/\n/g, ' ')}`);
    return { ok: true, providerMessageId: 'demo-' + Date.now() };
  },
};
