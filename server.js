'use strict';

const path = require('path');
const express = require('express');
const QRCode = require('qrcode');

const db = require('./src/db');
const kakao = require('./src/kakao');

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
  res.json({
    number: entry.number,
    name: entry.name,
    partySize: entry.partySize,
    status: entry.status,
    ahead: entry.status === 'waiting' ? await db.positionAhead(entry.id) : 0,
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
  const allowed = ['waiting', 'called', 'seated', 'cancelled'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: '잘못된 상태값입니다.' });
  }
  const patch = { status };
  if (status === 'called') patch.calledAt = new Date().toISOString();
  if (status === 'seated') patch.seatedAt = new Date().toISOString();
  const updated = await db.patchEntry(req.params.id, patch);
  if (!updated) return res.status(404).json({ error: '대상을 찾을 수 없습니다.' });
  res.json(updated);
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

  const updated = await db.patchEntry(entry.id, {
    status: entry.status === 'waiting' ? 'called' : entry.status,
    calledAt: entry.calledAt || new Date().toISOString(),
    notifiedCount: (entry.notifiedCount || 0) + 1,
  });
  res.json({ ok: true, mode: result.mode, text, entry: updated });
}));

// ---------- 관리자: 설정 ----------
app.get('/api/settings', requireAdmin, wrap(async (req, res) => {
  res.json(await db.getSettings());
}));
app.put('/api/settings', requireAdmin, wrap(async (req, res) => {
  const { storeName, messageTemplate } = req.body || {};
  const patch = {};
  if (typeof storeName === 'string') patch.storeName = storeName;
  if (typeof messageTemplate === 'string') patch.messageTemplate = messageTemplate;
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

// 로컬에서 직접 실행할 때만 리슨(서버리스에서는 app만 export)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n  🍽  대기 관리 서버 실행 중`);
    console.log(`  · 손님 등록:  http://localhost:${PORT}/`);
    console.log(`  · 관리자:     http://localhost:${PORT}/admin`);
    console.log(`  · 카카오 모드: ${kakao.currentMode()}`);
    if (ADMIN_PASSCODE) console.log('  · 관리자 암호 보호: 사용');
    console.log('');
  });
}

module.exports = app;
