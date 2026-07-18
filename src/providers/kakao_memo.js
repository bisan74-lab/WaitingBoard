'use strict';

/**
 * 카카오 "나에게 보내기" provider (연동 검증용).
 * KAKAO_ACCESS_TOKEN 토큰 소유자 본인에게만 발송됩니다.
 * 실제 손님 발송용이 아니라, 카카오 연동/토큰이 정상인지 확인하는 용도입니다.
 */

const KAKAO_ACCESS_TOKEN = process.env.KAKAO_ACCESS_TOKEN || '';

module.exports = {
  id: 'kakao_memo',
  label: '카카오 나에게 보내기(검증용)',

  isConfigured() {
    return Boolean(KAKAO_ACCESS_TOKEN);
  },

  async send({ text, linkUrl }) {
    const templateObject = {
      object_type: 'text',
      text,
      link: linkUrl ? { web_url: linkUrl, mobile_web_url: linkUrl } : {},
    };
    const res = await fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${KAKAO_ACCESS_TOKEN}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ template_object: JSON.stringify(templateObject) }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.result_code !== 0) {
      throw new Error(`카카오 API 오류: ${body.msg || body.error_description || `HTTP ${res.status}`}`);
    }
    return { ok: true, providerMessageId: null };
  },
};
