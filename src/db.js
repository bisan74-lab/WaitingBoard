'use strict';

/**
 * 아주 가벼운 JSON 파일 기반 저장소.
 * 네이티브 빌드가 필요한 DB 의존성 없이 어디서든 바로 실행되도록 설계했습니다.
 * 소규모 매장(단일 프로세스)용으로 충분하며, 필요 시 SQLite/Postgres로 교체할 수 있도록
 * 접근을 이 모듈로 격리했습니다.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');

const DEFAULT_STATE = {
  settings: {
    storeName: '우리 식당',
    // {name} {party} {store} {number} 치환자 사용 가능
    messageTemplate:
      '[{store}] {name}님, 대기하신 {party}명 자리가 준비되었습니다. 입장해 주세요! (대기번호 {number}번)',
  },
  counter: 0,
  entries: [],
};

let state = null;
let writeTimer = null;

function ensureLoaded() {
  if (state) return state;
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      state = {
        ...DEFAULT_STATE,
        ...parsed,
        settings: { ...DEFAULT_STATE.settings, ...(parsed.settings || {}) },
        entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      };
    } else {
      state = structuredClone(DEFAULT_STATE);
    }
  } catch (err) {
    console.error('저장소 로드 실패, 초기 상태로 시작합니다:', err.message);
    state = structuredClone(DEFAULT_STATE);
  }
  return state;
}

function persist() {
  // 짧은 시간 내 다중 쓰기를 병합하여 디스크 부담을 줄입니다.
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = DATA_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
      fs.renameSync(tmp, DATA_FILE); // 원자적 교체
    } catch (err) {
      console.error('저장소 저장 실패:', err.message);
    }
  }, 50);
}

function genId() {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  );
}

// ---- 공개 API ----

function getSettings() {
  return { ...ensureLoaded().settings };
}

function updateSettings(patch) {
  const s = ensureLoaded();
  s.settings = { ...s.settings, ...patch };
  persist();
  return { ...s.settings };
}

function getEntries({ includeArchived = false } = {}) {
  const s = ensureLoaded();
  const list = includeArchived
    ? s.entries
    : s.entries.filter((e) => e.status === 'waiting' || e.status === 'called');
  return list.map((e) => ({ ...e }));
}

function getEntry(id) {
  const s = ensureLoaded();
  const found = s.entries.find((e) => e.id === id);
  return found ? { ...found } : null;
}

function addEntry({ name, phone, partySize, memo }) {
  const s = ensureLoaded();
  s.counter += 1;
  const entry = {
    id: genId(),
    number: s.counter,
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
  s.entries.push(entry);
  persist();
  return { ...entry };
}

function patchEntry(id, patch) {
  const s = ensureLoaded();
  const entry = s.entries.find((e) => e.id === id);
  if (!entry) return null;
  Object.assign(entry, patch);
  persist();
  return { ...entry };
}

/** 특정 대기 항목의 앞에 몇 팀이 대기 중인지(순번) 계산 */
function positionAhead(id) {
  const s = ensureLoaded();
  const target = s.entries.find((e) => e.id === id);
  if (!target || target.status !== 'waiting') return 0;
  return s.entries.filter(
    (e) => e.status === 'waiting' && e.createdAt < target.createdAt
  ).length;
}

function waitingCount() {
  const s = ensureLoaded();
  return s.entries.filter((e) => e.status === 'waiting').length;
}

module.exports = {
  getSettings,
  updateSettings,
  getEntries,
  getEntry,
  addEntry,
  patchEntry,
  positionAhead,
  waitingCount,
};
