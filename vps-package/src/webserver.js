'use strict';

/**
 * وب‌سرور فرم شکایت:
 * - فرم رسمی در مسیر /Shekayat سرو می‌شود (بدون پورت در آدرس — WEB_PORT پیش‌فرض ۸۰)
 * - اگر SSL_CERT_PATH و SSL_KEY_PATH در .env تنظیم شده باشد، HTTPS روی ۴۴۳ بالا می‌آید
 *   و درخواست‌های HTTP به‌صورت خودکار به HTTPS ریدایرکت می‌شوند.
 * - دسترسی با توکن امضاشدهٔ دیسکورد (لینک فقط از داخل سرور با /shekayat داده می‌شود)
 * - GET  /api/meta?u&t  → شمارهٔ ثبت، تاریخ ثبت، فهرست وکلا
 * - POST /submit        → ساخت پرونده و انتشار در کانال شکایات + DM به شاکی
 *
 * نکتهٔ Cloudflare: اگر دامنه از Cloudflare عبور می‌کند (Flexible SSL)،
 * مقادیر SSL_* را خالی بگذارید — HTTPS در لبهٔ Cloudflare برقرار می‌شود.
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const crypto = require('crypto');
const { URL } = require('url');

const cfg = require('./config');
const jalali = require('./jalali');
const fa = require('./fa');
const cases = require('./services/cases');
const vakils = require('./services/vakils');
const publisher = require('./services/casePublisher');
const { HTML } = require('./formTemplate');

/** امضای HMAC برای اتصال امن صفحهٔ وب به کاربر دیسکورد */
function sign(userId) {
  return crypto.createHmac('sha256', cfg.token).update(String(userId)).digest('hex').slice(0, 32);
}

function verifyToken(userId, token) {
  try {
    const a = Buffer.from(sign(userId));
    const b = Buffer.from(String(token || ''));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (_) {
    return false;
  }
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req, limit = 128 * 1024) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > limit) {
        reject(new Error('حجم داده بیش از حد مجاز است'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

/** GET /api/meta — پیش‌پر کردن فرم + فهرست وکلا */
async function handleMeta(res, params, client) {
  const u = params.get('u');
  const t = params.get('t');
  if (!u || !verifyToken(u, t)) {
    return sendJson(res, 403, { ok: false, message: 'دسترسی نامعتبر است — فرم را از داخل دیسکورد با /shekayat باز کنید.' });
  }

  const list = vakils.availableForCitizen()
    .slice()
    .sort((a, b) => (b.acceptedCases || 0) - (a.acceptedCases || 0)) // باتجربه‌ترین‌ها اول
    .map((v) => ({
      value: `vakil:${v.discordId}`,
      label: [
        `${v.firstName} ${v.lastName}`,
        v.phone ? `📞 ${fa.digits(String(v.phone))}` : null,
        `🗂 ${fa.num(v.acceptedCases || 0)} پرونده`,
        `🏆 ${fa.num(v.wins || 0)} برد`,
        `📉 ${fa.num(v.losses || 0)} باخت`,
      ].filter(Boolean).join(' | '),
    }));

  return sendJson(res, 200, {
    ok: true,
    registrationNo: fa.num(cases.peekNumber()),
    registrationDate: jalali.formatJalali(new Date()),
    openCase: Boolean(cases.openCaseOf(u)),
    vakils: list,
  });
}

/** POST /submit — ثبت پرونده */
async function handleSubmit(req, res, client) {
  let data;
  try {
    data = JSON.parse(await readBody(req));
  } catch (e) {
    return sendJson(res, 400, { ok: false, message: e.message || 'دادهٔ نامعتبر' });
  }

  const u = String(data.u || '');
  if (!u || !verifyToken(u, data.t)) {
    return sendJson(res, 403, { ok: false, message: 'دسترسی نامعتبر است — فرم را از داخل دیسکورد با /shekayat باز کنید.' });
  }

  const open = cases.openCaseOf(u);
  if (open) {
    return sendJson(res, 400, {
      ok: false,
      message: `شما یک پروندهٔ باز دارید (شمارهٔ ثبت: ${fa.digits(open.number)}). تا صدور رأی نهایی امکان ثبت جدید نیست.`,
    });
  }

  // اعتبارسنجی فیلدهای الزامی
  const missing = [];
  for (const [k, label] of [
    ['complainant_first_name', 'نام شاکی'],
    ['complainant_last_name', 'نام خانوادگی شاکی'],
    ['complainant_phone', 'شماره تماس شاکی'],
    ['subject', 'موضوع شکایت'],
    ['description', 'شرح کامل شکایت'],
  ]) {
    if (!String(data[k] || '').trim()) missing.push(label);
  }
  const count = Math.max(1, Math.min(10, Number(data.defendant_count) || 1));
  for (let i = 1; i <= count; i += 1) {
    if (!String(data[`defendant_${i}_first_name`] || '').trim()) missing.push(`نام متشاکی(شکایت‌شده) ${fa.num(i)}`);
    if (!String(data[`defendant_${i}_last_name`] || '').trim()) missing.push(`نام خانوادگی متشاکی(شکایت‌شده) ${fa.num(i)}`);
  }
  if (missing.length) {
    return sendJson(res, 400, { ok: false, message: `تکمیل این موارد الزامی است: ${missing.join('، ')}` });
  }

  const form = {
    plaintiff_firstName: String(data.complainant_first_name).trim(),
    plaintiff_lastName: String(data.complainant_last_name).trim(),
    plaintiff_fatherName: String(data.complainant_father || '').trim(),
    plaintiff_nationalId: String(data.complainant_id || '').trim(),
    plaintiff_phone: String(data.complainant_phone).trim(),
    plaintiff_job: String(data.complainant_job || '').trim(),
    plaintiff_residence: String(data.complainant_address || '').trim(),
    defendants: [],
    subject: String(data.subject).trim(),
    occurredAt: String(data.incident_date || '').trim(),
    occurredPlace: String(data.incident_location || '').trim(),
    occurredDetail: String(data.incident_address || '').trim(),
    evidence: String(data.evidence || '').trim(),
    description: String(data.description).trim(),
    demand: String(data.request || '').trim(),
  };
  for (let i = 1; i <= count; i += 1) {
    form.defendants.push({
      firstName: String(data[`defendant_${i}_first_name`] || '').trim(),
      lastName: String(data[`defendant_${i}_last_name`] || '').trim(),
      fatherName: String(data[`defendant_${i}_father`] || '').trim(),
      phone: String(data[`defendant_${i}_phone`] || '').trim(),
      job: String(data[`defendant_${i}_job`] || '').trim(),
      relation: String(data[`defendant_${i}_relationship`] || '').trim(),
      place: String(data[`defendant_${i}_address`] || '').trim(),
    });
  }

  const lawyerRaw = String(data.complainant_lawyer || 'novakil');
  const vakilId = lawyerRaw.startsWith('vakil:') ? lawyerRaw.slice(6) : 'novakil';

  try {
    const rec = await publisher.publishCase(client, { complainantId: u, form, vakilId });
    return sendJson(res, 200, {
      ok: true,
      number: rec.number,
      message: `درخواست شما با موفقیت ثبت شد. شمارهٔ ثبت: ${fa.digits(rec.number)}`,
    });
  } catch (e) {
    return sendJson(res, 500, { ok: false, message: e.message || 'خطا در ثبت پرونده' });
  }
}

/** مسیریابی مشترک HTTP/HTTPS */
function makeHandler(client) {
  return async (req, res) => {
    try {
      // اگر SSL فعال است، درخواست‌های HTTP به HTTPS ریدایرکت می‌شوند
      if (cfg.sslEnabled && !req.socket.encrypted) {
        const host = String(req.headers.host || '').split(':')[0] || 'localhost';
        // پورت HTTPS را حفظ کن (مثلاً ۴۲۸۹) مگر ۴۴۳ باشد که نیازی به ذکرش نیست
        const portSuffix = Number(cfg.sslPort) === 443 ? '' : `:${cfg.sslPort}`;
        res.writeHead(301, { Location: `https://${host}${portSuffix}${req.url}` });
        return res.end();
      }

      const u = new URL(req.url, 'http://localhost');
      const path = u.pathname.toLowerCase();

      // پاسخ به challengeهای Let's Encrypt (SSL خودکار) — قبل از همهٔ مسیرها
      try { if (require('./ssl').serveChallenge(req, res)) return; } catch (_) { /* noop */ }

      if (req.method === 'GET' && (path === '/shekayat' || path === '/shekayat/' || path === '/index.html')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(HTML);
      }
      if (req.method === 'GET' && (path === '/' || path === '')) {
        res.writeHead(302, { Location: '/Shekayat' });
        return res.end();
      }
      if (req.method === 'GET' && u.pathname === '/api/meta') {
        return await handleMeta(res, u.searchParams, client);
      }
      if (req.method === 'POST' && u.pathname === '/submit') {
        return await handleSubmit(req, res, client);
      }

      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not Found');
    } catch (e) {
      console.error('⚠️ Khataye webserver:', e);
      return sendJson(res, 500, { ok: false, message: 'خطای داخلی سرور' });
    }
  };
}

/** گوش‌دادن به پورت با پیام خطای راهنما */
function listen(server, port, label) {
  return new Promise((resolve) => {
    server.once('error', (e) => {
      console.error(`⚠️ ${label} roye port ${port} ejra nashod: ${e.message}`);
      if (e.code === 'EACCES' || e.code === 'EADDRINUSE') {
        console.error(`   Port ${port} eshghal ast ya dastresi nadarad — dar .env meghdare WEB_PORT ra taghir dahid`);
        console.error('   (Masalan WEB_PORT=4287) va an port ra dar firewall/VPS baz konid.');
      }
      resolve(false);
    });
    server.listen(port, '0.0.0.0', () => {
      console.log(`🌐 ${label} faal shod (port ${port})`);
      resolve(true);
    });
  });
}

/** راه‌اندازی وب‌سرور فرم (HTTP + HTTPS اختیاری) */
async function start(client) {
  const handler = makeHandler(client);

  // ⚠️ ترتیب حیاتی: HTTP باید «فوراً» بالا بیاید تا challengeهای Let's Encrypt
  // (که روی همین پورت ۸۰ می‌آیند) پاسخ بگیرند — وگرنه گواهی هیچ‌وقت صادر نمی‌شود!
  const httpServer = http.createServer(handler);
  listen(httpServer, cfg.webPort, 'HTTP form-e shekayat');

  // سپس (حتی دقایقی بعد) به‌محض آماده‌شدن گواهی، HTTPS را همان‌جا روشن کن
  require('./ssl').ready().then(() => {
    const c = (process.env.SSL_CERT_PATH || '').trim();
    const k = (process.env.SSL_KEY_PATH || '').trim();
    if (!c || !k) return;
    try {
      const opts = { cert: fs.readFileSync(c), key: fs.readFileSync(k) };
      const httpsServer = https.createServer(opts, handler);
      listen(httpsServer, cfg.sslPort, 'HTTPS form-e shekayat');
      console.log(`↪️ Az in lahze HTTP be HTTPS redirect mishavad — adrese asli: https://<domain>${cfg.sslPort === 443 ? '' : ':' + cfg.sslPort}/Shekayat`);
    } catch (e) {
      console.error('⚠️ Khandan-e goavahi SSL namovafagh bood:', e.message, "— fe'lan faghat HTTP faal mimanad.");
    }
  }).catch(() => { /* noop */ });
}

module.exports = { start, sign };
