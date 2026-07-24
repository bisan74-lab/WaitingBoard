'use strict';

/**
 * Redis(Upstash / Vercel KV) 저장소 — 서버리스(Vercel) 운영용.
 * REST API만 사용하므로 지속 연결이 필요 없어 서버리스에 적합합니다.
 *
 * 환경변수(둘 중 아무 세트나 인식):
 *   KV_REST_API_URL / KV_REST_API_TOKEN            (Vercel KV)
 *   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN (Upstash 직접)
 */

const { DEFAULT_SETTINGS, newEntry, isActive, computeAhead, dayKey } = require('./shared');

const REST_URL =
  process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const REST_TOKEN =
  process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';

const K = { settings: 'wb:settings', counter: 'wb:counter', entries: 'wb:entries' };

function isConfigured() {
  return Boolean(REST_URL && REST_TOKEN);
}

async function cmd(args) {
  const res = await fetch(REST_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REST_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    throw new Error('Redis 오류: ' + (data.error || `HTTP ${res.status}`));
  }
  return data.result;
}

// HGETALL 결과를 엔트리 배열로 변환 (Upstash는 [f,v,f,v...] 형태 반환)
async function fetchAllEntries() {
  const flat = await cmd(['HGETALL', K.entries]);
  const list = [];
  const pushVal = (v) => {
    try { list.push(JSON.parse(v)); } catch { /* skip */ }
  };
  if (Array.isArray(flat)) {
    for (let i = 1; i < flat.length; i += 2) pushVal(flat[i]);
  } else if (flat && typeof flat === 'object') {
    for (const v of Object.values(flat)) pushVal(v);
  }
  return list;
}

// 날짜가 바뀌면(자정 KST 기준) 이전 날짜에 아직 활성(대기/호출/오는중)인 건을
// 자동으로 '처리완료'로 전환합니다. 기록은 삭제하지 않고 그대로 보존되어
// 관리자 화면의 기록 조회에서 열람할 수 있습니다. 서버리스라 예약작업 없이
// 다음 요청 시점에 지연 실행됩니다.
async function rolloverStale(list) {
  const today = dayKey();
  const now = new Date().toISOString();
  const stale = list.filter((e) => isActive(e) && dayKey(new Date(e.createdAt)) !== today);
  if (!stale.length) return list;
  await Promise.all(stale.map((e) => {
    e.status = 'seated';
    e.seatedAt = e.seatedAt || now;
    e.autoClosed = true;
    return cmd(['HSET', K.entries, e.id, JSON.stringify(e)]);
  }));
  return list;
}

async function allEntries() {
  const list = await fetchAllEntries();
  return rolloverStale(list);
}

async function getSettings() {
  const raw = await cmd(['GET', K.settings]);
  return { ...DEFAULT_SETTINGS, ...(raw ? JSON.parse(raw) : {}) };
}
async function updateSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await cmd(['SET', K.settings, JSON.stringify(next)]);
  return next;
}
async function getEntries({ includeArchived = false } = {}) {
  const list = await allEntries();
  return includeArchived ? list : list.filter(isActive);
}
async function getEntry(id) {
  const raw = await cmd(['HGET', K.entries, id]);
  if (!raw) return null;
  let entry = JSON.parse(raw);
  if (isActive(entry) && dayKey(new Date(entry.createdAt)) !== dayKey()) {
    entry = { ...entry, status: 'seated', seatedAt: entry.seatedAt || new Date().toISOString(), autoClosed: true };
    await cmd(['HSET', K.entries, id, JSON.stringify(entry)]);
  }
  return entry;
}
async function addEntry(data) {
  // 날짜별 카운터 키 → 자정(KST)에 자동으로 1번부터 시작
  const counterKey = `${K.counter}:${dayKey()}`;
  const number = await cmd(['INCR', counterKey]);
  if (Number(number) === 1) {
    // 그날 첫 손님일 때만 만료 설정(2일) — 오래된 카운터 키 자동 정리
    await cmd(['EXPIRE', counterKey, 172800]);
  }
  const entry = newEntry({ ...data, number: Number(number) });
  await cmd(['HSET', K.entries, entry.id, JSON.stringify(entry)]);
  return entry;
}
async function patchEntry(id, patch) {
  const cur = await getEntry(id);
  if (!cur) return null;
  const next = { ...cur, ...patch };
  await cmd(['HSET', K.entries, id, JSON.stringify(next)]);
  return next;
}
async function positionAhead(id) {
  const list = await allEntries();
  return computeAhead(list, list.find((e) => e.id === id));
}
async function waitingCount() {
  return (await allEntries()).filter((e) => e.status === 'waiting').length;
}
// 전체 초기화: 모든 기록(대기목록 전체 이력) 삭제 + 대기번호 카운터 삭제(다음 등록이 1번)
async function reset() {
  await cmd(['DEL', K.entries]);
  await cmd(['DEL', `${K.counter}:${dayKey()}`]);
}
// 오늘 초기화: 오늘 등록된 건만 삭제하고 오늘 번호를 1번부터 다시 시작.
// 이전 날짜 기록은 그대로 유지되어 기록 조회에서 열람할 수 있습니다.
async function resetToday() {
  const list = await fetchAllEntries();
  const today = dayKey();
  const ids = list.filter((e) => dayKey(new Date(e.createdAt)) === today).map((e) => e.id);
  if (ids.length) await cmd(['HDEL', K.entries, ...ids]);
  await cmd(['DEL', `${K.counter}:${today}`]);
}

module.exports = {
  backend: 'redis',
  isConfigured,
  getSettings, updateSettings, getEntries, getEntry,
  addEntry, patchEntry, positionAhead, waitingCount, reset, resetToday,
};
