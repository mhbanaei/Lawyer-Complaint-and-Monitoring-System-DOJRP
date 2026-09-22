'use strict';

/**
 * مدیریت پیکربندی از .env با اعتبارسنجی
 */

require('dotenv').config();

const required = (name) => {
  const v = process.env[name];
  if (!v || v.trim() === '' || /^0+$/.test(v.trim())) {
    // در زمان استقرار کامندها توکن لازم است؛ در اجرا هم همهٔ کلیدها
    const err = new Error(`متغیر محیطی «${name}» در فایل .env تنظیم نشده است.`);
    err.missingEnv = name;
    throw err;
  }
  return v.trim();
};

const optionalInt = (name, def) => {
  const v = parseInt(process.env[name] || '', 10);
  return Number.isFinite(v) ? v : def;
};

let cfg;
try {
  cfg = {
    token: required('BOT_TOKEN'),
    roles: {
      citizen: required('ROLE_CITIZEN'),
      judge: required('ROLE_JUDGE'),
      deputy: required('ROLE_DEPUTY'),
    },
    channels: {
      complaints: required('CHANNEL_COMPLAINTS'),
      sessions: required('CHANNEL_SESSIONS'),
    },
    playersUrl: process.env.PLAYERS_URL || 'https://x.paradiserp.ir:30120/players.json',
    onlinePollSeconds: optionalInt('ONLINE_POLL_SECONDS', 300),
    sessionHourStart: optionalInt('SESSION_HOUR_START', 9),
    sessionHourEnd: optionalInt('SESSION_HOUR_END', 21),
    // وب‌سرور فرم شکایت (مسیر /Shekayat — پیش‌فرض پورت ۸۰)
    webPort: optionalInt('WEB_PORT', 80),
    webPublicUrl: (process.env.WEB_PUBLIC_URL || 'http://localhost').trim(),
    // SSL اختیاری: اگر هر دو مسیر گواهی داده شود، HTTPS روی ۴۴۳ بالا می‌آید
    sslCert: (process.env.SSL_CERT_PATH || '').trim(),
    sslKey: (process.env.SSL_KEY_PATH || '').trim(),
    sslPort: optionalInt('WEB_SSL_PORT', 443),
  };
  cfg.sslEnabled = Boolean(cfg.sslCert && cfg.sslKey);
} catch (e) {
  // اجازهٔ اجرای تست‌ها بدون .env کامل (مقادیر ساختگی)
  if (process.env.BOT_TEST_MODE === '1') {
    cfg = {
      token: 'test-token',
      roles: { citizen: '1', judge: '2', deputy: '3' },
      channels: { complaints: '4', sessions: '5' },
      playersUrl: process.env.PLAYERS_URL || 'https://x.paradiserp.ir:30120/players.json',
      onlinePollSeconds: 300,
      sessionHourStart: 9,
      sessionHourEnd: 21,
      webPort: optionalInt('WEB_PORT', 4287),
      webPublicUrl: (process.env.WEB_PUBLIC_URL || 'http://localhost').trim(),
      sslCert: '',
      sslKey: '',
      sslPort: 443,
    };
    cfg.sslEnabled = false;
  } else {
    console.error('❌ Khataye peykbandi:', e.message);
    console.error('   File .env.example ra be .env copy konid va maghadir ra takmil konid.');
    process.exitCode = 1;
    throw e;
  }
}

module.exports = cfg;
