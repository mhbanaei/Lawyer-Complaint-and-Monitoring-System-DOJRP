'use strict';

/** تست‌های مبدل تاریخ شمسی — اجرا: npm test */

const jalali = require('../src/jalali');
const fa = require('../src/fa');

let passed = 0;
let failed = 0;

function ok(cond, name) {
  if (cond) { passed += 1; }
  else {
    failed += 1;
    console.error(`  ❌ ${name}`);
  }
}

function eq(a, b, name) {
  ok(JSON.stringify(a) === JSON.stringify(b), `${name} (دریافتی: ${JSON.stringify(a)}, انتظار: ${JSON.stringify(b)})`);
}

// ---------- fa ----------
eq(fa.latinDigits('۱۴۰۵/۰۶/۲۸'), '1405/06/28', 'تبدیل رقم فارسی به لاتین');
eq(fa.digits('1405/06/28'), '۱۴۰۵/۰۶/۲۸', 'تبدیل رقم لاتین به فارسی');
eq(fa.toInt('۱۲۳'), 123, 'toInt از رقم فارسی');
eq(fa.toInt('abc'), null, 'toInt مقدار نامعتبر');
ok(fa.duration(90000).includes('ساعت'), 'قالب مدت زمان');

// ---------- jalali: نقاط شناخته‌شده ----------
// 2026-09-19 == 1405/06/28 (میلادی→شمسی)
let j = jalali.dateToJalali(new Date(Date.UTC(2026, 8, 19, 8, 30))); // 08:30 UTC = 12:00 تهران
eq([j.jy, j.jm, j.jd], [1405, 6, 28], '2026-09-19 → 1405/06/28');

// مرز شبانه‌روز: 20:30 UTC = 00:00 تهران روز بعد → 1405/06/29
j = jalali.dateToJalali(new Date(Date.UTC(2026, 8, 19, 20, 30)));
eq([j.jy, j.jm, j.jd], [1405, 6, 29], 'مرز نیمه‌شب تهران');

// 2026-03-21 == 1405/01/01 (نوروز ۱۴۰۵)
j = jalali.dateToJalali(new Date(Date.UTC(2026, 2, 20, 20, 30)));
eq([j.jy, j.jm, j.jd], [1405, 1, 1], 'نوروز ۱۴۰۵');

// 2025-03-21 == 1404/01/01
j = jalali.dateToJalali(new Date(Date.UTC(2025, 2, 20, 20, 30)));
eq([j.jy, j.jm, j.jd], [1404, 1, 1], 'نوروز ۱۴۰۴');

// معروف: 1404/09/30 == 2025-12-21 (انقلاب زمستانی)
j = jalali.dateToJalali(new Date(Date.UTC(2025, 11, 21, 12, 0)));
eq([j.jy, j.jm, j.jd], [1404, 9, 30], '2025-12-21 → 1404/09/30');

// شمسی→میلادی: 1405/06/28 باید به 2026-09-19 برگردد
const d = jalali.jalaliToDate(1405, 6, 28, 12, 0);
j = jalali.dateToJalali(d);
eq([j.jy, j.jm, j.jd], [1405, 6, 28], 'رفت‌وبرگشت شمسی→میلادی→شمسی');

// طول ماه‌ها
eq(jalali.jalaliMonthLength(1405, 1), 31, 'فروردین ۳۱ روز');
eq(jalali.jalaliMonthLength(1405, 7), 30, 'مهر ۳۰ روز');
eq(jalali.jalaliMonthLength(1403, 12), 30, 'اسفند ۱۴۰۳ کبیسه ۳۰ روز');
eq(jalali.jalaliMonthLength(1404, 12), 29, 'اسفند ۱۴۰۴ ۲۹ روز');

// روز هفته: 2026-09-19 شنبه است
ok(jalali.jalaliWeekday(new Date(Date.UTC(2026, 8, 19))) === 'شنبه', 'روز هفته ۱۹ سپتامبر ۲۰۲۶ = شنبه');

// قالب رشته‌ای
ok(/^\d{4}\/\d{2}\/\d{2}$/.test('1405/06/28'), 'قالب تاریخ');

console.log(`\nنتایج: ${passed} موفق، ${failed} ناموفق`);
process.exit(failed ? 1 : 0);
