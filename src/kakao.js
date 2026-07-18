'use strict';

/**
 * 메시지 발송 디스패처.
 *
 * 알림톡(AlimTalk)은 카카오가 개별 사업자에게 직접 API를 제공하지 않고
 * 중계 대행사(솔루션 업체)를 통해 발송하는 것이 일반적입니다. 업체마다 인증/
 * 페이로드가 다르므로, 아래처럼 provider를 교체할 수 있는 구조로 구성했습니다.
 *
 * 발송 업체 선택: 환경변수 MESSAGING_PROVIDER
 *   - 'demo'       (기본) 실제 발송 없이 기록만
 *   - 'solapi'     Solapi(CoolSMS) 알림톡
 *   - 'nhncloud'   NHN Cloud(Toast) 알림톡
 *   - 'aligo'      Aligo(알리고) 알림톡
 *   - 'kakao_memo' 카카오 나에게 보내기(연동 검증용)
 *   - 'auto'       설정된(isConfigured) 알림톡 provider를 자동 선택
 *
 * 미설정 시 안전하게 demo로 폴백합니다.
 */

const PUBLIC_URL = process.env.PUBLIC_URL || '';

const providers = {
  demo: require('./providers/demo'),
  solapi: require('./providers/solapi'),
  nhncloud: require('./providers/nhncloud'),
  aligo: require('./providers/aligo'),
  kakao_memo: require('./providers/kakao_memo'),
};

// 자동 선택 시 시도 순서
const AUTO_ORDER = ['solapi', 'nhncloud', 'aligo', 'kakao_memo'];

function resolveProvider() {
  const want = (process.env.MESSAGING_PROVIDER || 'demo').toLowerCase();

  if (want === 'auto') {
    const found = AUTO_ORDER.map((id) => providers[id]).find((p) => p && p.isConfigured());
    return found || providers.demo;
  }

  const chosen = providers[want];
  if (!chosen) {
    console.warn(`[messaging] 알 수 없는 provider '${want}', demo로 폴백합니다.`);
    return providers.demo;
  }
  if (!chosen.isConfigured()) {
    console.warn(`[messaging] provider '${want}' 환경변수 미설정, demo로 폴백합니다.`);
    return providers.demo;
  }
  return chosen;
}

/** 현재 활성 provider id (관리자 화면 배지에 사용) */
function currentMode() {
  return resolveProvider().id;
}

/** 사용 가능한(설정 완료된) provider 목록 */
function availableProviders() {
  return Object.values(providers).map((p) => ({
    id: p.id,
    label: p.label,
    configured: p.isConfigured(),
  }));
}

/**
 * 통합 발송 인터페이스.
 * @param {object} args
 * @param {string} args.text        최종 본문(대체발송/데모/검증용). 알림톡 본문은 승인 템플릿을 따릅니다.
 * @param {string} [args.phone]     수신자 번호
 * @param {string} [args.linkUrl]   첨부 링크
 * @param {object} [args.variables] 템플릿 변수 { key: value }
 * @param {string} [args.subject]   알림톡 제목(일부 업체/템플릿 유형)
 * @returns {Promise<{ok:boolean, mode:string, text:string, providerMessageId?:string, error?:string}>}
 */
async function sendMessage({ text, phone, linkUrl, variables, subject }) {
  const provider = resolveProvider();
  const link = linkUrl || PUBLIC_URL || undefined;

  try {
    const result = await provider.send({
      to: phone,
      text,
      linkUrl: link,
      variables,
      subject,
      fallbackText: text,
    });
    return {
      ok: true,
      mode: provider.id,
      text,
      providerMessageId: result && result.providerMessageId,
    };
  } catch (err) {
    console.error(`[messaging:${provider.id}] 발송 실패:`, err.message);
    return { ok: false, mode: provider.id, text, error: err.message };
  }
}

module.exports = { sendMessage, currentMode, availableProviders };
