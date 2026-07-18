'use strict';

/**
 * 카카오톡 메시지 발송 모듈.
 *
 * 실제 "손님(제3자)에게" 알림을 보내려면 카카오 비즈니스 채널 + 알림톡(AlimTalk)
 * 또는 친구톡 계약이 필요합니다. 그 부분은 계약/발신프로필 심사가 있어야 하므로,
 * 이 모듈은 다음 두 가지 모드를 지원하도록 설계했습니다.
 *
 *  1) demo  : 환경변수가 없을 때(기본). 실제 발송 없이 발송 내용을 기록/반환합니다.
 *             화면·기능 흐름을 그대로 확인할 수 있습니다.
 *  2) memo  : KAKAO_ACCESS_TOKEN 이 설정된 경우 카카오 "나에게 보내기" API로
 *             실제 카카오톡 메시지를 전송합니다(토큰 소유자 본인에게 발송되는
 *             카카오 기본 기능으로, 연동 검증용).
 *
 * 실제 운영에서 손님에게 발송하려면 sendAlimTalk() 자리에 계약된
 * 알림톡 API 호출을 채우면 됩니다. 인터페이스는 동일하게 유지됩니다.
 */

const KAKAO_ACCESS_TOKEN = process.env.KAKAO_ACCESS_TOKEN || '';
const PUBLIC_URL = process.env.PUBLIC_URL || '';

function currentMode() {
  return KAKAO_ACCESS_TOKEN ? 'memo' : 'demo';
}

async function sendViaMemoApi(text, linkUrl) {
  const templateObject = {
    object_type: 'text',
    text,
    link: linkUrl ? { web_url: linkUrl, mobile_web_url: linkUrl } : {},
  };
  const res = await fetch(
    'https://kapi.kakao.com/v2/api/talk/memo/default/send',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${KAKAO_ACCESS_TOKEN}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        template_object: JSON.stringify(templateObject),
      }),
    }
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.result_code !== 0) {
    const msg =
      body.msg || body.error_description || `HTTP ${res.status}`;
    throw new Error(`카카오 API 오류: ${msg}`);
  }
  return body;
}

/**
 * @param {object} args
 * @param {string} args.text  발송할 메시지 본문
 * @param {string} [args.phone] 수신자 전화번호(알림톡 연동 시 사용)
 * @param {string} [args.linkUrl] 메시지에 첨부할 링크
 * @returns {Promise<{ok:boolean, mode:string, text:string, error?:string}>}
 */
async function sendMessage({ text, phone, linkUrl }) {
  const mode = currentMode();
  const link = linkUrl || PUBLIC_URL || undefined;

  if (mode === 'demo') {
    console.log(
      `[카카오:demo] ${phone || '(번호없음)'} → ${text.replace(/\n/g, ' ')}`
    );
    return { ok: true, mode, text };
  }

  try {
    await sendViaMemoApi(text, link);
    return { ok: true, mode, text };
  } catch (err) {
    console.error('[카카오:memo] 발송 실패:', err.message);
    return { ok: false, mode, text, error: err.message };
  }
}

module.exports = { sendMessage, currentMode };
