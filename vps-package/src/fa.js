'use strict';

/** ابزارهای متن فارسی */
const fa = {
  /** رقم‌های لاتین را به فارسی تبدیل می‌کند */
  digits: (s) => String(s).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]),

  /** رقم‌های فارسی/عربی را به لاتین برمی‌گرداند */
  latinDigits: (s) => String(s)
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))),

  /** آیا رشته فقط رقم (فارسی یا لاتین) است */
  isDigits: (s) => /^([۰-۹0-9]+)$/.test(String(s).trim()),

  /** عدد صحیح از رشتهٔ فارسی/لاتین؛ نامعتبر => null */
  toInt: (s) => {
    const t = fa.latinDigits(String(s)).trim().replace(/[,\s_]/g, '');
    if (!/^-?\d+$/.test(t)) return null;
    const n = Number(t);
    return Number.isSafeInteger(n) ? n : null;
  },

  /** قالب‌بندی عدد با جداکنندهٔ هزارگان و ارقام فارسی */
  num: (n) => fa.digits(Number(n).toLocaleString('en-US')),

  /** مدت زمان (ثانیه) به قالب خوانا: ۲ روز و ۳ ساعت و ۴ دقیقه */
  duration: (totalSeconds) => {
    let s = Math.max(0, Math.floor(totalSeconds));
    const d = Math.floor(s / 86400); s -= d * 86400;
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60); s -= m * 60;
    const parts = [];
    if (d) parts.push(`${fa.num(d)} روز`);
    if (h) parts.push(`${fa.num(h)} ساعت`);
    if (m) parts.push(`${fa.num(m)} دقیقه`);
    if (!d && s) parts.push(`${fa.num(s)} ثانیه`);
    if (!parts.length) return 'چند لحظه';
    return parts.join(' و ');
  },

  /** ممیز دیسکورد برای منشن بدون ارسال نوتیف اضافی */
  userMention: (id) => `<@${id}>`,
};

module.exports = fa;
