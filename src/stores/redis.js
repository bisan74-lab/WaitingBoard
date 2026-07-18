'use strict';

/**
 * Redis(Upstash / Vercel KV) 저장소 — 서버리스(Vercel) 운영용.
 * REST API만 사용하므로 지속 연결이 필요 없어 서버리스에 적합합니다.
 *
 * 환경변수(둘 중 아무 세트나 인식):
 *   KV_REST_API_URL / KV_REST_API_TOKEN            (Vercel KV)
 *   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN (Upstash 직접)
 */

const { DEFAULT_SETTINGS, newEntry, isActive, computeAhead } = require('./shared');

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
async function allEntries() {
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
  return raw ? JSON.parse(raw) : null;
}
async function addEntry(data) {
  const number = await cmd(['INCR', K.counter]);
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

module.exports = {
  backend: 'redis',
  isConfigured,
  getSettings, updateSettings, getEntries, getEntry,
  addEntry, patchEntry, positionAhead, waitingCount,
};
