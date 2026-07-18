'use strict';

/** 저장소 백엔드가 공유하는 순수 헬퍼와 기본값. */

const DEFAULT_SETTINGS = {
  storeName: '우리 식당',
  // {name} {party} {store} {number} 치환자 사용 가능
  messageTemplate:
    '[{store}] {name}님, 대기하신 {party}명 자리가 준비되었습니다. 입장해 주세요! (대기번호 {number}번)',
};

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function newEntry({ number, name, phone, partySize, memo }) {
  return {
    id: genId(),
    number,
    name: String(name).trim(),
    phone: String(phone || '').trim(),
    partySize: Number(partySize) || 1,
    memo: String(memo || '').trim(),
    status: 'waiting', // waiting | called | seated | cancelled
    createdAt: new Date().toISOString(),
    calledAt: null,
    seatedAt: null,
    notifiedCount: 0,
  };
}

function isActive(e) {
  return e.status === 'waiting' || e.status === 'called';
}

/** target 앞에 대기 중인 팀 수 */
function computeAhead(entries, target) {
  if (!target || target.status !== 'waiting') return 0;
  return entries.filter(
    (e) => e.status === 'waiting' && e.createdAt < target.createdAt
  ).length;
}

module.exports = { DEFAULT_SETTINGS, genId, newEntry, isActive, computeAhead };
