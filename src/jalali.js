'use strict';

/**
 * تبدیل تاریخ شمسی (جلالی) ↔ میلادی — بدون وابستگی خارجی
 * بر پایهٔ الگوریتم استاندارد جلالی (jalaali-js style) با تقویم ۳۳ ساله.
 */

const breaks = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210,
  1635, 1700, 1792, 1866, 2328, 2394, 2452, 2820];

function jalCal(jy) {
  let bl = breaks.length;
  const gy = jy + 621;
  let leapJ = -14;
  let jp = breaks[0];
  let jump = 0;
  for (let i = 1; i < bl; i += 1) {
    const jm = breaks[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ += div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ += div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

function div(a, b) { return ~~(a / b); }
function mod(a, b) { return a - ~~(a / b) * b; }

function g2d(gy, gm, gd) {
  let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4)
    + div(153 * mod(gm + 9, 12) + 2, 5)
    + gd - 34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

function d2g(jdn) {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

function j2d(jy, jm, jd) {
  const r = jalCal(jy);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

function d2j(jdn) {
  const gy = d2g(jdn).gy;
  let jy = gy - 621;
  const r = jalCal(jy);
  const jdn1f = g2d(gy, 3, r.march);
  let k = jdn - jdn1f;
  if (k >= 0) {
    if (k <= 185) {
      const jm = 1 + div(k, 31);
      const jd = mod(k, 31) + 1;
      return { jy, jm, jd };
    }
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  const jm = 7 + div(k, 30);
  const jd = mod(k, 30) + 1;
  return { jy, jm, jd };
}

function isLeapJalaliYear(jy) {
  return jalCal(jy).leap === 0;
}

/** تعداد روزهای ماه شمسی */
function jalaliMonthLength(jy, jm) {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return isLeapJalaliYear(jy) ? 30 : 29;
}

/** تبدیل Date (UTC-based) به {jy,jm,jd} — بر اساس زمان تهران */
function dateToJalali(date) {
  const tehran = new Date(date.getTime() + 3.5 * 3600 * 1000);
  const gy = tehran.getUTCFullYear();
  const gm = tehran.getUTCMonth() + 1;
  const gd = tehran.getUTCDate();
  return d2j(g2d(gy, gm, gd));
}

/** تبدیل {jy,jm,jd} شمسی به Date (UTC midnight Tehran offset applied) */
function jalaliToDate(jy, jm, jd, hour = 0, minute = 0) {
  const jdn = j2d(jy, jm, jd);
  const g = d2g(jdn);
  // زمان تهران = UTC+3:30
  const ms = Date.UTC(g.gy, g.gm - 1, g.gd, hour, minute) - 3.5 * 3600 * 1000;
  return new Date(ms);
}

const MONTH_NAMES = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
];

const WEEKDAY_NAMES = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];

/** نام روز هفتهٔ شمسی برای یک Date (بر پایهٔ زمان تهران) */
function jalaliWeekday(date) {
  const tehran = new Date(date.getTime() + 3.5 * 3600 * 1000);
  // getUTCDay: 0=Sunday..6=Saturday  →  ترتیب شمسی یکشنبه..شنبه
  return WEEKDAY_NAMES[tehran.getUTCDay()];
}

const fa = require('./fa');

/** تاریخ کوتاه با رقم فارسی: ۱۴۰۵/۰۶/۲۸ */
function formatJalali(date) {
  const { jy, jm, jd } = dateToJalali(date);
  const p = (n) => String(n).padStart(2, '0');
  return fa.digits(`${jy}/${p(jm)}/${p(jd)}`);
}

/** تاریخ + ساعت تهران با رقم فارسی: ۱۴۰۵/۰۶/۲۸ - ۱۸:۳۰ */
function formatJalaliDateTime(date) {
  const tehran = new Date(date.getTime() + 3.5 * 3600 * 1000);
  const hh = String(tehran.getUTCHours()).padStart(2, '0');
  const mm = String(tehran.getUTCMinutes()).padStart(2, '0');
  return `${formatJalali(date)} - ${fa.digits(`${hh}:${mm}`)}`;
}

module.exports = {
  dateToJalali,
  jalaliToDate,
  jalaliMonthLength,
  isLeapJalaliYear,
  formatJalali,
  formatJalaliDateTime,
  jalaliWeekday,
  MONTH_NAMES,
  WEEKDAY_NAMES,
};
