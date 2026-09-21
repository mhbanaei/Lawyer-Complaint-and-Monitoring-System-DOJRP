'use strict';

/** ابزارهای عمومی */

const id = (n) => `paradise:${n}`;

/** برش متن طولانی با حفظ حدود ۲۰۰۰ کاراکتر دیسکورد */
function clip(text, max = 1000) {
  const t = String(text || '').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/** متن خالی یا whitespace فقط => null */
function emptyToNull(s) {
  const t = String(s || '').trim();
  return t ? t : null;
}

/** نام نمایشی امن برای انتخاب‌گرها */
function safeLabel(s, max = 90) {
  const t = String(s || '').replace(/[\r\n\t]+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** انتخاب تصادفی از آرایه (برای متن‌های متنوع) */
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

module.exports = { id, clip, emptyToNull, safeLabel, sleep, pick };
