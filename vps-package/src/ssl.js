'use strict';

/**
 * SSL خودکار — Let's Encrypt (ACME) با HTTP-01 challenge
 *
 * در صورت تنظیم SSL_DOMAIN در .env:
 *  - در استارت ربات، اگر گواهی موجود نباشد یا نزدیک انقضا باشد، خودکار از Let's Encrypt گرفته می‌شود
 *  - گواهی در پوشهٔ ssl/ ذخیره می‌شود و HTTPS روی ۴۴۳ بالا می‌آید
 *  - پاسخ challenge از پورت ۸۰ داده می‌شود (قبل از بالا آمدن وب‌سرور فرم)
 *
 * پیش‌نیازها (روی VPS):
 *  - رکورد A دامنه (مثلاً lspd.ir) به IP سرور اشاره کند
 *  - پورت‌های ۸۰ و ۴۴۳ از فایروال باز باشند
 *  - در ویندوز ربات باید با Administrator اجرا شود تا بتواند روی ۸۰/۴۴۳ گوش دهد
 *
 * بدون SSL_DOMAIN فقط HTTP عادی بالا می‌آید و هیچ خطایی رخ نمی‌دهد.
 */

const fs = require('fs');
const path = require('path');

const SSL_DIR = path.join(process.cwd(), 'ssl');

const log = (...a) => console.log('[SSL]', ...a);

/** آیا مود SSL خودکار فعال است؟ (فقط کافی است SSL_DOMAIN تنظیم شده باشد) */
function enabled() {
  return Boolean((process.env.SSL_DOMAIN || '').trim());
}

/** آیا گواهی آمادهٔ استفاده هست؟ (برای وب‌سرور، در لحظهٔ بالا آمدن) */
function sslActive() {
  const c = (process.env.SSL_CERT_PATH || '').trim();
  const k = (process.env.SSL_KEY_PATH || '').trim();
  return Boolean(c && k && fs.existsSync(c) && fs.existsSync(k));
}

/* ---------- پاسخ challenge — از طریق وب‌سرور اصلی (پورت ۸۰) سرو می‌شود ---------- */
const pendingChallenges = new Map(); // token → keyAuthorization

/**
 * سروِ درخواست‌های ACME HTTP-01 — از داخل هندلر وب‌سرور صدا زده می‌شود
 * @returns {boolean} آیا این درخواست یک challenge بود و پاسخ داده شد؟
 */
function serveChallenge(req, res) {
  const m = String(req.url || '').match(/^\u002f\.well-known\/acme-challenge\/([A-Za-z0-9_-]+)$/);
  const token = m && m[1];
  if (!token || !pendingChallenges.has(token)) return false;
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end(pendingChallenges.get(token));
  return true;
}

/* ---------- ابزار گواهی ---------- */

/** روزهای باقی‌ماندهٔ گواهی؛ اگر قابل خواندن نبود null */
function daysRemaining(certPem) {
  try {
    const acme = require('acme-client');
    const info = acme.crypto.readCertificateInfo(certPem);
    return Math.floor((new Date(info.notAfter).getTime() - Date.now()) / 86400000);
  } catch (_) {
    return null;
  }
}

/**
 * دریافت/تمدید گواهی؛ در صورت موفقیت مسیرها را برمی‌گرداند
 * @param {string} domain دامنه (مثلاً lspd.ir)
 */
async function ensureCertificate(domain) {
  const acme = require('acme-client');
  fs.mkdirSync(SSL_DIR, { recursive: true });

  const certPath = path.join(SSL_DIR, 'cert.pem');
  const keyPath = path.join(SSL_DIR, 'key.pem');
  const accountKeyPath = path.join(SSL_DIR, 'account.key');

  // اگر گواهی موجود بیش از ۳۰ روز اعتبار دارد، دریافت مجدد لازم نیست
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    const remain = daysRemaining(fs.readFileSync(certPath));
    if (remain === null || remain > 30) {
      log(`Goavahi-e mojood estefade mishavad (${remain === null ? 'mavjood vali gheyr-e ghabel-e khandan' : `${remain} rooz baghi-mande`}).`);
      return { cert: certPath, key: keyPath };
    }
    log(`Goavahi ${remain} rooz be engeza mande — tamdid mikonam...`);
  }

  log(`Dar hale daryaft-e goavahi Let's Encrypt baraye ${domain} (ta 2 daghighe momken ast tool bekeshad)...`);

  // کلید حساب ACME — یک بار ساخته و همیشه همان استفاده می‌شود
  const accountKey = fs.existsSync(accountKeyPath)
    ? fs.readFileSync(accountKeyPath)
    : await acme.crypto.createPrivateKey();
  if (!fs.existsSync(accountKeyPath)) fs.writeFileSync(accountKeyPath, accountKey);

  const client = new acme.Client({
    directoryUrl: acme.directory.letsencrypt.production,
    accountKey,
  });

  // کلید دامنه + CSR
  const [certKey, csr] = await acme.crypto.createCsr({ commonName: domain, altNames: [domain] });

  // صدور کامل (سفارش + challenge + نهایی‌سازی) با auto()
  const certificate = await client.auto({
    csr,
    email: (process.env.SSL_EMAIL || `admin@${domain}`).trim(),
    termsOfServiceAgreed: true,
    // تأیید داخلی را رد می‌کنیم؛ از داخل VPS ممکن است دسترسی به دامنه (hairpin NAT) ممکن نباشد.
    // Let's Encrypt خودش از بیرون تأیید می‌کند.
    skipChallengeVerification: true,
    challengeCreateFn: async (authz, challenge, keyAuthorization) => {
      pendingChallenges.set(challenge.token, keyAuthorization);
      // پاسخ از طریق وب‌سرور اصلی (پورت ۸۰) داده می‌شود — سرور جداگانه‌ای لازم نیست
      log(`Challenge amade ast — Let's Encrypt an ra az http://${domain}/.well-known/acme-challenge/ barresi mikonad...`);
    },
    challengeRemoveFn: async (authz, challenge) => {
      pendingChallenges.delete(challenge.token);
    },
  });

  fs.writeFileSync(certPath, certificate);
  fs.writeFileSync(keyPath, certKey);
  log(`✅ Goavahi ${domain} sader va dar pooshe-ye ssl/ zakhire shod.`);
  return { cert: certPath, key: keyPath };
}

/**
 * در استارت ربات (قبل از بارگذاری config و وب‌سرور): گواهی را آماده کن و env را ست کن
 * @returns {Promise<{cert?: string, key?: string}>}
 */
let readyPromise = null;

const RETRY_MS = 10 * 60 * 1000; // بازهٔ تلاش مجدد: ۱۰ دقیقه

function setup() {
  if (!readyPromise) {
    readyPromise = (async () => {
      const domain = (process.env.SSL_DOMAIN || '').trim();
      if (!domain) return {};
      for (let attempt = 1; ; attempt += 1) {
        try {
          const paths = await ensureCertificate(domain);
          process.env.SSL_CERT_PATH = paths.cert;
          process.env.SSL_KEY_PATH = paths.key;
          return paths;
        } catch (e) {
          console.error('[SSL] ❌ Daryaft-e goavahi namovafagh bood:', e.message);
          if (attempt === 1) {
            console.error('[SSL]    Checklist: 1) Firewall Windows — start.bat khodesh mishanad 2) Firewall-e panel-e datacenter — port 80 va 443 baz bashad 3) ArvanCloud roye DNS only (khakestari) bashad');
            console.error('[SSL]    Har 10 daghighe khodkar dobare talash mikonam — be mahze dastres boodan-e port 80 az internet, goavahi sader va HTTPS bedoone restart roshan mishavad.');
          } else {
            console.error(`[SSL]    (Talash-e shomare-ye ${attempt}) — 10 daghighe digar dobare...`);
          }
          await new Promise((r) => setTimeout(r, RETRY_MS));
        }
      }
    })();
  }
  return readyPromise;
}

/** وعدهٔ آماده‌شدن SSL — وب‌سرور قبل از بالا آمدن منتظرش می‌ماند */
function ready() { return setup(); }

module.exports = { setup, ready, enabled, sslActive, serveChallenge, SSL_DIR };
