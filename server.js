'use strict';

const path = require('path');
const os = require('os');
const express = require('express');
const QRCode = require('qrcode');

const db = require('./src/db');
const kakao = require('./src/kakao');
const { estimateWaitMinutes } = require('./src/stores/shared');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSCODE = process.env.ADMIN_PASSCODE || ''; // 비어있으면 관리자 화면 개방

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 비동기 핸들러 에러를 안전하게 처리하는 래퍼
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- 관리자 인증(간단 passcode) ----------
function requireAdmin(req, res, next) {
  if (!ADMIN_PASSCODE) return next();
  const provided = req.get('x-admin-passcode') || req.query.passcode || '';
  if (provided === ADMIN_PASSCODE) return next();
  return res.status(401).json({ error: '관리자 인증이 필요합니다.' });
}

app.get('/api/admin/check', requireAdmin, (req, res) => {
  res.json({ ok: true, protected: Boolean(ADMIN_PASSCODE) });
});

// ---------- 연결 상태 점검(저장소/발송) ----------
app.get('/api/health', requireAdmin, wrap(async (req, res) => {
  const storage = { backend: db.backend, connected: false };
  try {
    // 실제 읽기를 수행해 저장소(특히 Redis REST) 연결을 확인
    await db.getSettings();
    storage.connected = true;
  } catch (err) {
    storage.error = err.message;
  }

  const provider = kakao.currentMode();
  res.json({
    storage,
    messaging: {
      provider,
      live: provider !== 'demo',
      providers: kakao.availableProviders(),
    },
    serverless: Boolean(process.env.VERCEL),
    time: new Date().toISOString(),
  });
}));

// ---------- 손님: 대기 등록 ----------
app.post('/api/waitlist', wrap(async (req, res) => {
  const { name, phone, partySize, memo } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: '이름을 입력해 주세요.' });
  }
  const size = Number(partySize);
  if (!Number.isFinite(size) || size < 1 || size > 50) {
    return res.status(400).json({ error: '인원수를 확인해 주세요.' });
  }
  const entry = await db.addEntry({ name, phone, partySize: size, memo });
  res.status(201).json({
    id: entry.id,
    number: entry.number,
    ahead: await db.positionAhead(entry.id),
  });
}));

// ---------- 손님: 본인 상태 조회 ----------
app.get('/api/waitlist/:id/status', wrap(async (req, res) => {
  const entry = await db.getEntry(req.params.id);
  if (!entry) return res.status(404).json({ error: '대기 정보를 찾을 수 없습니다.' });
  const settings = await db.getSettings();
  let ahead = 0, peopleAhead = 0, eta = 0;
  if (entry.status === 'waiting') {
    const a = await aheadOf(entry);
    ahead = a.teams;
    peopleAhead = a.people;
    eta = estimateWaitMinutes(ahead, settings);
  }
  res.json({
    number: entry.number,
    name: entry.name,
    partySize: entry.partySize,
    status: entry.status,
    ahead,
    peopleAhead,
    estimatedWaitMinutes: eta,
    storeName: settings.storeName,
  });
}));

// ---------- 손님: 대기 요약 (등록 화면용) ----------
// 새로 등록할 손님 기준: 현재 대기 중인 팀/인원 = 앞에 있는 팀/인원.
app.get('/api/summary', wrap(async (req, res) => {
  const settings = await db.getSettings();
  const a = await aheadOf(null); // 전체 대기
  res.json({
    waitingTeams: a.teams,
    waitingPeople: a.people,
    estimatedWaitMinutes: estimateWaitMinutes(a.teams, settings),
    storeName: settings.storeName,
  });
}));

// ---------- 관리자: 목록 ----------
app.get('/api/waitlist', requireAdmin, wrap(async (req, res) => {
  const includeArchived = req.query.all === '1';
  res.json({
    entries: await db.getEntries({ includeArchived }),
    settings: await db.getSettings(),
    kakaoMode: kakao.currentMode(),
  });
}));

// ---------- 관리자: 상태 변경 ----------
app.post('/api/waitlist/:id/status', requireAdmin, wrap(async (req, res) => {
  const { status } = req.body || {};
  const allowed = ['waiting', 'called', 'coming', 'seated', 'cancelled'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: '잘못된 상태값입니다.' });
  }
  const now = new Date().toISOString();
  const patch = { status };
  if (status === 'called') patch.calledAt = now;
  if (status === 'coming') patch.comingAt = now; // 재호출 중지
  if (status === 'seated') patch.seatedAt = now;
  // 대기중으로 되돌리면(호출취소/되돌리기) 호출 관련 정보 초기화
  if (status === 'waiting') {
    patch.calledAt = null;
    patch.lastNotifiedAt = null;
    patch.comingAt = null;
    patch.notifiedCount = 0;
  }
  const updated = await db.patchEntry(req.params.id, patch);
  if (!updated) return res.status(404).json({ error: '대상을 찾을 수 없습니다.' });
  res.json(updated);
}));

// ---------- 손님: "가는 중" 응답 (재호출 중지) ----------
// 손님 상태 화면에서 직접 누르므로 관리자 인증 없이 허용.
app.post('/api/waitlist/:id/coming', wrap(async (req, res) => {
  const entry = await db.getEntry(req.params.id);
  if (!entry) return res.status(404).json({ error: '대기 정보를 찾을 수 없습니다.' });
  if (entry.status === 'seated' || entry.status === 'cancelled') {
    return res.json({ ok: true, status: entry.status }); // 이미 종료된 건 변경 없음
  }
  const updated = await db.patchEntry(entry.id, {
    status: 'coming',
    comingAt: new Date().toISOString(),
  });
  res.json({ ok: true, status: updated.status });
}));

// ---------- 손님: 대기 취소 (본인 순번 화면에서) ----------
// 고유한 순번 링크(id)를 가진 손님만 접근하므로 관리자 인증 없이 허용.
app.post('/api/waitlist/:id/cancel', wrap(async (req, res) => {
  const entry = await db.getEntry(req.params.id);
  if (!entry) return res.status(404).json({ error: '대기 정보를 찾을 수 없습니다.' });
  if (entry.status === 'seated') {
    return res.status(400).json({ error: '이미 착석 처리되어 취소할 수 없습니다.' });
  }
  if (entry.status === 'cancelled') {
    return res.json({ ok: true, status: 'cancelled' });
  }
  const updated = await db.patchEntry(entry.id, { status: 'cancelled' });
  res.json({ ok: true, status: updated.status });
}));

// ---------- 자동 재호출 트리거 ----------
// 로컬(미니PC)에서는 아래 setInterval이, Vercel에서는 Cron 또는 열려있는
// 대시보드가 이 엔드포인트를 호출해 1분마다 응답 없는 손님을 재호출합니다.
app.all('/api/cron/recall', wrap(async (req, res) => {
  const secret = process.env.CRON_SECRET;
  const auth = req.get('authorization') || '';
  const adminOk = ADMIN_PASSCODE && req.get('x-admin-passcode') === ADMIN_PASSCODE;
  const cronOk = secret ? auth === `Bearer ${secret}` : true; // secret 없으면 개방(로컬)
  if (!(cronOk || adminOk)) return res.status(401).json({ error: 'unauthorized' });
  const recalled = await processRecalls();
  res.json({ ok: true, recalled });
}));

// ---------- 관리자: 카카오톡 호출 메시지 발송 ----------
app.post('/api/waitlist/:id/notify', requireAdmin, wrap(async (req, res) => {
  const entry = await db.getEntry(req.params.id);
  if (!entry) return res.status(404).json({ error: '대상을 찾을 수 없습니다.' });

  const settings = await db.getSettings();
  const custom = (req.body && req.body.message) || '';
  const text = custom
    ? String(custom)
    : renderTemplate(settings.messageTemplate, entry, settings);

  const linkUrl = statusUrl(req, entry.id);
  // 알림톡 승인 템플릿의 #{변수} 치환에 사용됩니다.
  const variables = {
    name: entry.name,
    party: String(entry.partySize),
    store: settings.storeName,
    number: String(entry.number),
    url: linkUrl,
  };
  const result = await kakao.sendMessage({ text, phone: entry.phone, linkUrl, variables });

  if (!result.ok) {
    return res.status(502).json({ error: result.error || '발송에 실패했습니다.', mode: result.mode });
  }

  const now = new Date().toISOString();
  const updated = await db.patchEntry(entry.id, {
    // 대기중이면 호출로 전환. 이미 '오는중'이면 그대로 두어 재호출 대상에서 제외.
    status: entry.status === 'waiting' || entry.status === 'called' ? 'called' : entry.status,
    calledAt: entry.calledAt || now,
    lastNotifiedAt: now,
    notifiedCount: (entry.notifiedCount || 0) + 1,
  });
  res.json({ ok: true, mode: result.mode, text, entry: updated });
}));

// ---------- 관리자: 전체 초기화 ----------
// 모든 기록(전체 이력) 삭제 + 대기번호 1번부터 다시 시작
app.post('/api/reset', requireAdmin, wrap(async (req, res) => {
  await db.reset();
  res.json({ ok: true });
}));

// ---------- 관리자: 오늘 초기화 ----------
// 오늘 등록된 대기만 삭제하고 오늘 번호를 1번부터 다시 시작. 이전 날짜 기록은 유지됩니다.
app.post('/api/reset-today', requireAdmin, wrap(async (req, res) => {
  await db.resetToday();
  res.json({ ok: true });
}));

// ---------- 관리자: 설정 ----------
app.get('/api/settings', requireAdmin, wrap(async (req, res) => {
  res.json(await db.getSettings());
}));
app.put('/api/settings', requireAdmin, wrap(async (req, res) => {
  const { storeName, messageTemplate, avgTurnMinutes, tableCount } = req.body || {};
  const patch = {};
  if (typeof storeName === 'string') patch.storeName = storeName;
  if (typeof messageTemplate === 'string') patch.messageTemplate = messageTemplate;
  if (avgTurnMinutes !== undefined) patch.avgTurnMinutes = Math.max(1, Number(avgTurnMinutes) || 40);
  if (tableCount !== undefined) patch.tableCount = Math.max(1, Number(tableCount) || 1);
  res.json(await db.updateSettings(patch));
}));

// ---------- QR 코드 (등록 페이지 링크) ----------
app.get('/api/qr', wrap(async (req, res) => {
  const target = registerUrl(req);
  const dataUrl = await QRCode.toDataURL(target, {
    width: 480,
    margin: 2,
    color: { dark: '#1f2937', light: '#ffffff' },
  });
  res.json({ url: target, qr: dataUrl });
}));

// ---------- 관리자 접속 QR (암호 자동 포함) ----------
// 스캔하면 /admin?passcode=<암호> 로 열려 별도 입력 없이 관리자 화면에 진입합니다.
// 암호가 담긴 QR이므로 관리자 인증이 있어야 발급됩니다.
app.get('/api/qr/admin', requireAdmin, wrap(async (req, res) => {
  const base = baseUrl(req);
  const target = ADMIN_PASSCODE
    ? `${base}/admin?passcode=${encodeURIComponent(ADMIN_PASSCODE)}`
    : `${base}/admin`;
  const dataUrl = await QRCode.toDataURL(target, {
    width: 480,
    margin: 2,
    color: { dark: '#1f2937', light: '#ffffff' },
  });
  res.json({ url: target, qr: dataUrl, protected: Boolean(ADMIN_PASSCODE) });
}));

// ---------- 공개 설정 (카카오 등 프런트에서 쓰는 값) ----------
// JavaScript 앱키는 공개용으로 설계된 값이라 프런트 노출이 정상입니다.
// 카카오 JavaScript 키(공개용). 환경변수가 있으면 그것을 우선 사용합니다.
const KAKAO_JS_KEY = process.env.KAKAO_JS_KEY || 'a6a54f9a79b212652ed4b52732d430a3';
app.get('/api/public-config', (req, res) => {
  res.json({
    kakaoJsKey: KAKAO_JS_KEY,
    kakaoChannelId: process.env.KAKAO_CHANNEL_ID || '',
  });
});

// ---------- 정적 파일 & 페이지 ----------
app.use(express.static(path.join(__dirname, 'public')));

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
app.get('/status/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'status.html'));
});

// ---------- 공통 에러 핸들러 ----------
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('요청 처리 오류:', err.message);
  res.status(500).json({ error: '서버 오류가 발생했습니다.' });
});

// ---------- 헬퍼 ----------
function baseUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  const proto = req.get('x-forwarded-proto') || req.protocol;
  const host = req.get('x-forwarded-host') || req.get('host');
  return `${proto}://${host}`;
}
function registerUrl(req) {
  return `${baseUrl(req)}/`;
}
function statusUrl(req, id) {
  return `${baseUrl(req)}/status/${id}`;
}
function renderTemplate(tpl, entry, settings) {
  return String(tpl)
    .replace(/\{name\}/g, entry.name)
    .replace(/\{party\}/g, entry.partySize)
    .replace(/\{store\}/g, settings.storeName)
    .replace(/\{number\}/g, entry.number);
}

// entry가 대기중일 때 앞에 있는 대기 팀/인원. entry=null 이면 전체 대기(신규 등록 기준).
async function aheadOf(entry) {
  const waiting = (await db.getEntries({ includeArchived: false })).filter((e) => e.status === 'waiting');
  const ahead = entry ? waiting.filter((e) => e.createdAt < entry.createdAt) : waiting;
  return {
    teams: ahead.length,
    people: ahead.reduce((s, e) => s + (e.partySize || 0), 0),
  };
}

// ---------- 자동 재호출 로직 ----------
const RECALL_INTERVAL_MS = Number(process.env.RECALL_INTERVAL_MS || 60 * 1000); // 재호출 간격(기본 1분)
const RECALL_MAX = Number(process.env.RECALL_MAX_ATTEMPTS || 10); // 최대 호출 횟수(0=무제한, 과호출 방지)

function publicStatusUrl(id) {
  const base = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
  return base ? `${base}/status/${id}` : '';
}

// 같은 네트워크(휴대폰)에서 접속할 수 있는 이 PC의 LAN IPv4 주소 목록
function lanAddresses() {
  const nets = os.networkInterfaces();
  const out = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

async function recallOne(entry, settings) {
  const text = renderTemplate(settings.messageTemplate, entry, settings);
  const url = publicStatusUrl(entry.id);
  const variables = {
    name: entry.name,
    party: String(entry.partySize),
    store: settings.storeName,
    number: String(entry.number),
    url,
  };
  const result = await kakao.sendMessage({ text, phone: entry.phone, linkUrl: url || undefined, variables });
  if (result.ok) {
    await db.patchEntry(entry.id, {
      lastNotifiedAt: new Date().toISOString(),
      notifiedCount: (entry.notifiedCount || 0) + 1,
    });
  }
  return result.ok;
}

// 응답이 없는 '호출됨' 손님을 1분마다 재호출. coming/seated/cancelled 는 제외됩니다.
// 서버 자동 재호출은 서버가 직접 보낼 수 있는 실제 발송 채널(알림톡 등)이 있을 때만 의미가 있습니다.
// 문자(SMS)는 관리자 휴대폰에서 직접 보내므로 서버가 대신 보낼 수 없습니다.
// 따라서 발송 provider가 demo(대행사 미연동)이면 자동 재호출을 하지 않습니다.
async function processRecalls() {
  if (kakao.currentMode() === 'demo') return 0;
  const now = Date.now();
  const settings = await db.getSettings();
  const list = await db.getEntries({ includeArchived: false });
  let count = 0;
  for (const e of list) {
    if (e.status !== 'called') continue;
    if (RECALL_MAX > 0 && (e.notifiedCount || 0) >= RECALL_MAX) continue;
    const last = e.lastNotifiedAt ? new Date(e.lastNotifiedAt).getTime() : 0;
    if (now - last < RECALL_INTERVAL_MS) continue;
    // eslint-disable-next-line no-await-in-loop
    if (await recallOne(e, settings)) count += 1;
  }
  return count;
}

// 로컬에서 직접 실행할 때만 리슨(서버리스에서는 app만 export)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n  🍽  대기 관리 서버 실행 중`);
    console.log(`  · 이 PC에서:  http://localhost:${PORT}/  (관리자: /admin)`);
    for (const ip of lanAddresses()) {
      console.log(`  · 같은 와이파이의 휴대폰에서:  http://${ip}:${PORT}/`);
    }
    console.log(`  · 카카오 모드: ${kakao.currentMode()}`);
    if (ADMIN_PASSCODE) console.log('  · 관리자 암호 보호: 사용');
    console.log(`  · 자동 재호출: ${Math.round(RECALL_INTERVAL_MS / 1000)}초 간격, 최대 ${RECALL_MAX || '무제한'}회`);
    console.log('');
  });

  // 헤드리스(모니터 없는 미니PC)에서도 브라우저 없이 자동 재호출이 동작하도록
  // 서버가 주기적으로 응답 없는 손님을 재호출합니다.
  setInterval(() => {
    processRecalls().catch((e) => console.error('자동 재호출 오류:', e.message));
  }, 15000);
}

module.exports = app;
