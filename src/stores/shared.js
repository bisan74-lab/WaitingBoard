'use strict';

/** 저장소 백엔드가 공유하는 순수 헬퍼와 기본값. */

const DEFAULT_SETTINGS = {
  storeName: '우리 식당',
  // {name} {party} {store} {number} 치환자 사용 가능
  messageTemplate:
    '[{store}] {name}님, 대기하신 {party}명 자리가 준비되었습니다. {store}으로 이동해 주세요! (대기번호 {number}번)',
};

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// 대기번호 리셋 기준 날짜(YYYY-MM-DD). 기본 한국시간(UTC+9) — 서버가 UTC여도 KST 자정에 리셋.
const DAY_OFFSET_HOURS = Number(process.env.RESET_TZ_OFFSET_HOURS || 9);
function dayKey(date = new Date()) {
  const shifted = new Date(date.getTime() + DAY_OFFSET_HOURS * 3600 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function newEntry({ number, name, phone, partySize, memo }) {
  return {
    id: genId(),
    number,
    name: String(name).trim(),
    phone: String(phone || '').trim(),
    partySize: Number(partySize) || 1,
    memo: String(memo || '').trim(),
    status: 'waiting', // waiting | called | coming | seated | cancelled
    createdAt: new Date().toISOString(),
    calledAt: null,        // 최초 호출 시각
    lastNotifiedAt: null,  // 마지막 알림 발송 시각(1분 재호출 판단용)
    comingAt: null,        // 손님이 "가는 중" 응답한 시각(재호출 중지)
    seatedAt: null,
    notifiedCount: 0,
  };
}

function isActive(e) {
  return e.status === 'waiting' || e.status === 'called' || e.status === 'coming';
}

/** target 앞에 대기 중인 팀 수 */
function computeAhead(entries, target) {
  if (!target || target.status !== 'waiting') return 0;
  return entries.filter(
    (e) => e.status === 'waiting' && e.createdAt < target.createdAt
  ).length;
}

module.exports = { DEFAULT_SETTINGS, genId, newEntry, isActive, computeAhead, dayKey };
