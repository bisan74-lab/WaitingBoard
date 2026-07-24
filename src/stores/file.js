'use strict';

/**
 * 파일(JSON) 저장소 — 로컬 개발/단일 서버용.
 * 인터페이스는 비동기(Promise)로 통일하여 Redis 백엔드와 교체 가능하게 합니다.
 */

const fs = require('fs');
const path = require('path');
const { DEFAULT_SETTINGS, newEntry, isActive, computeAhead, dayKey } = require('./shared');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');

let state = null;
let writeTimer = null;

function load() {
  if (!state) {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        state = {
          settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
          counter: parsed.counter || 0,
          counterDate: parsed.counterDate || null,
          entries: Array.isArray(parsed.entries) ? parsed.entries : [],
        };
      } else {
        state = { settings: { ...DEFAULT_SETTINGS }, counter: 0, counterDate: null, entries: [] };
      }
    } catch (err) {
      console.error('저장소 로드 실패, 초기 상태로 시작:', err.message);
      state = { settings: { ...DEFAULT_SETTINGS }, counter: 0, counterDate: null, entries: [] };
    }
  }
  rolloverStale(state);
  return state;
}

// 날짜가 바뀌면(자정 KST 기준) 이전 날짜에 아직 활성(대기/호출/오는중)인 건을
// 자동으로 '처리완료'로 전환합니다. 기록은 삭제하지 않고 그대로 보존되어
// 관리자 화면의 기록 조회에서 열람할 수 있습니다. 서버가 계속 떠 있지 않아도
// (서버리스) 다음 요청 시점에 지연 실행되므로 별도 예약작업이 필요 없습니다.
function rolloverStale(s) {
  const today = dayKey();
  let changed = false;
  const now = new Date().toISOString();
  for (const e of s.entries) {
    if (isActive(e) && dayKey(new Date(e.createdAt)) !== today) {
      e.status = 'seated';
      e.seatedAt = e.seatedAt || now;
      e.autoClosed = true;
      changed = true;
    }
  }
  if (changed) persist();
}

function persist() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = DATA_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
      fs.renameSync(tmp, DATA_FILE);
    } catch (err) {
      console.error('저장소 저장 실패:', err.message);
    }
  }, 50);
}

async function getSettings() {
  return { ...load().settings };
}
async function updateSettings(patch) {
  const s = load();
  s.settings = { ...s.settings, ...patch };
  persist();
  return { ...s.settings };
}
async function getEntries({ includeArchived = false } = {}) {
  const s = load();
  const list = includeArchived ? s.entries : s.entries.filter(isActive);
  return list.map((e) => ({ ...e }));
}
async function getEntry(id) {
  const found = load().entries.find((e) => e.id === id);
  return found ? { ...found } : null;
}
async function addEntry(data) {
  const s = load();
  const today = dayKey();
  // 날짜가 바뀌면 대기번호를 1부터 다시 시작
  if (s.counterDate !== today) {
    s.counterDate = today;
    s.counter = 0;
  }
  s.counter += 1;
  const entry = newEntry({ ...data, number: s.counter });
  s.entries.push(entry);
  persist();
  return { ...entry };
}
async function patchEntry(id, patch) {
  const entry = load().entries.find((e) => e.id === id);
  if (!entry) return null;
  Object.assign(entry, patch);
  persist();
  return { ...entry };
}
async function positionAhead(id) {
  const s = load();
  return computeAhead(s.entries, s.entries.find((e) => e.id === id));
}
async function waitingCount() {
  return load().entries.filter((e) => e.status === 'waiting').length;
}
// 전체 초기화: 모든 기록(대기목록 전체 이력) 삭제 + 대기번호 카운터 리셋(다음 등록이 1번)
async function reset() {
  const s = load();
  s.entries = [];
  s.counter = 0;
  s.counterDate = null;
  persist();
}
// 오늘 초기화: 오늘 등록된 건만 삭제하고 오늘 번호를 1번부터 다시 시작.
// 이전 날짜 기록은 그대로 유지되어 기록 조회에서 열람할 수 있습니다.
async function resetToday() {
  const s = load();
  const today = dayKey();
  s.entries = s.entries.filter((e) => dayKey(new Date(e.createdAt)) !== today);
  s.counter = 0;
  s.counterDate = null;
  persist();
}

module.exports = {
  backend: 'file',
  getSettings, updateSettings, getEntries, getEntry,
  addEntry, patchEntry, positionAhead, waitingCount, reset, resetToday,
};
