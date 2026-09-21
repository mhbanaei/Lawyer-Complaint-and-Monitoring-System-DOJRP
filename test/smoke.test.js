'use strict';

/**
 * تست دود (Smoke) — چرخهٔ کامل پرونده بدون اتصال به دیسکورد
 * اجرا: BOT_TEST_MODE=1 node test/smoke.test.js
 */

process.env.BOT_TEST_MODE = '1';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// دیتای موقت برای جدا شدن از data/ واقعی
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paradise-test-'));
process.chdir(tmp);

const cases = require('../src/services/cases');
const vakils = require('../src/services/vakils');
const embeds = require('../src/embeds');
const sessions = require('../src/services/sessions');
const drafts = require('../src/drafts');
const { judgePanelRow, vakilPanelRow, vakilSelectMenu, modal } = require('../src/ui');

let passed = 0;
let failed = 0;
function t(name, fn) {
  try { fn(); passed += 1; } catch (e) { failed += 1; console.error(`  ❌ ${name}: ${e.message}`); }
}

// ---------- ثبت پرونده ----------
const form = {
  plaintiff_firstName: 'علی', plaintiff_lastName: 'رضایی', plaintiff_fatherName: 'حسن',
  plaintiff_nationalId: '۱۲۳۴۵۶۷۸۹۰', plaintiff_phone: '09121234567',
  plaintiff_job: 'راننده', plaintiff_residence: 'تهران، خیابان ولیعصر',
  def_firstName: 'محمود', def_lastName: 'کریمی', def_fatherName: 'رضا',
  def_phone: '09129876543', def_job: 'فروشنده', def_relation: 'همکار', def_place: 'تهران',
  subject: 'کلاهبرداری درون‌بازی', occurredAt: '۱۴۰۵/۰۶/۲۰', occurredPlace: 'التی‌دور',
  occurredDetail: 'ساعت ۱۸:۰۰', evidence: 'کلیپ', description: 'شرح کامل ماجرا', demand: 'استرداد اموال',
};

let c;
t('ثبت پرونده و شمارهٔ ترتیبی', () => {
  c = cases.create({ complainantId: 'user-1', form, vakilPick: null });
  assert.strictEqual(c.number, 1);
  assert.strictEqual(c.status, 'registered');
});

t('پروندهٔ دوم شمارهٔ بعدی', () => {
  const c2 = cases.create({ complainantId: 'user-2', form, vakilPick: null });
  assert.strictEqual(c2.number, 2);
});

t('کول‌داون: پروندهٔ بازِ شاکی', () => {
  assert.ok(cases.openCaseOf('user-1'));
  assert.strictEqual(cases.openCaseOf('user-404'), null);
});

t('این덕س پیام→پرونده', () => {
  cases.indexMessage('msg-1', c.number);
  assert.strictEqual(cases.caseByMessage('msg-1').number, c.number);
});

// ---------- تعیین وقت دادگاه ----------
t('تعیین وقت جلسهٔ خصوصی', () => {
  cases.setSession(c, { type: 'private', at: Date.now() + 86400000, atText: 'شنبه ۱۴۰۵/۰۶/۲۹ - ۱۸:۰۰', judgeId: 'judge-1' });
  assert.strictEqual(c.status, 'scheduled');
  assert.strictEqual(c.session.type, 'private');
});

t('متن اطلاعیهٔ جلسه', () => {
  const text = sessions.sessionAnnouncement(c);
  assert.ok(text.includes('بسمه‌تعالی'));
  assert.ok(text.includes('خصوصی'));
  assert.ok(text.includes('محمود کریمی'));
});

t('پذیرش وکالت دو-طرفه', () => {
  assert.ok(cases.acceptSideVakil(c, { discordId: 'vakil-1', name: 'رضا محمدی', side: 'plaintiff' }));
  // سمت شاکی پر است ولی سمت مشتکی‌عنه باز است
  assert.strictEqual(cases.acceptSideVakil(c, { discordId: 'vakil-2', name: 'دیگری', side: 'plaintiff' }), false);
  assert.ok(cases.acceptSideVakil(c, { discordId: 'vakil-2', name: 'سارا احمدی', side: 'defendant' }));
  assert.strictEqual(c.plaintiffVakil.discordId, 'vakil-1');
  assert.strictEqual(c.defendantVakil.discordId, 'vakil-2');
});

t('جریان تأیید شاکی: قبول وکیل → تأیید شاکی → وکیل رسمی', () => {
  const c4 = cases.create({ complainantId: 'user-4', form, vakilPick: null });
  cases.setPendingVakil(c4, { discordId: 'vakil-7', name: 'وکیل تاییدپذیر' });
  assert.strictEqual(c4.pendingVakil.status, 'pending');
  // وکیل می‌پذیرد → awaiting_confirm
  cases.acceptPendingByVakil(c4);
  assert.strictEqual(c4.pendingVakil.status, 'awaiting_confirm');
  assert.ok(cases.canRequestPlaintiffVakil(c4, 'vakil-8') === false); // هنوز pending هست
  // شاکی تأیید می‌کند → وکیل رسمی
  const p = cases.confirmPendingByPlaintiff(c4);
  assert.ok(p);
  assert.strictEqual(c4.plaintiffVakil.name, 'وکیل تاییدپذیر');
  assert.strictEqual(c4.pendingVakil, null);
});

t('رد شاکی → مسدود شدن وکیل و بازگشایی برای بقیه', () => {
  const c5 = cases.create({ complainantId: 'user-5', form, vakilPick: null });
  cases.setPendingVakil(c5, { discordId: 'vakil-7', name: 'وکیل ردشده' });
  cases.acceptPendingByVakil(c5);
  const p = cases.rejectPendingByPlaintiff(c5);
  assert.ok(p);
  assert.strictEqual(c5.pendingVakil, null);
  assert.ok(c5.rejectedVakils.includes('vakil-7')); // دیگر حق درخواست ندارد
  assert.strictEqual(cases.canRequestPlaintiffVakil(c5, 'vakil-7'), false);
  assert.strictEqual(cases.canRequestPlaintiffVakil(c5, 'vakil-8'), true); // بقیه آزادند
});

t('پیشنهاد وکالت ۱۲ ساعته و رد خودکار', () => {
  const c3 = cases.create({ complainantId: 'user-3', form, vakilPick: null });
  const p = cases.setPendingVakil(c3, { discordId: 'vakil-9', name: 'وکیل منتظر' });
  assert.ok(p.expiresAt > Date.now());
  assert.strictEqual(cases.caseByMessage('msg-1').pendingVakil, null);
  // انقضای مصنوعی → sweep → پاک می‌شود
  c3.pendingVakil.expiresAt = Date.now() - 1000;
  const swept = cases.sweepExpiredPending();
  assert.strictEqual(swept.length, 1);
  assert.strictEqual(swept[0].case.number, c3.number);
  assert.strictEqual(c3.pendingVakil, null);
  assert.ok(c3.vakilRequests.some((r) => r.outcome === 'expired'));
});

// ---------- مسیرهای مدل تأیید شاکی ----------

t('پذیرش عمومی وکالت شاکی: وکیل ثبت نمی‌شود تا شاکی تأیید کند', () => {
  const c6 = cases.create({ complainantId: 'user-6', form, vakilPick: null });
  const p = cases.requestPlaintiffVakilByCitizen(c6, { discordId: 'vakil-11', name: 'وکیل عمومی', origin: 'open_request' });
  assert.ok(p);
  assert.strictEqual(c6.pendingVakil.status, 'pending');
  assert.strictEqual(c6.pendingVakil.origin, 'open_request');
  assert.strictEqual(c6.plaintiffVakil, null); // هنوز وکیل رسمی نشده
  // وکیل می‌پذیرد → تأیید شاکی
  cases.acceptPendingByVakil(c6);
  assert.strictEqual(c6.pendingVakil.status, 'awaiting_confirm');
  assert.strictEqual(c6.plaintiffVakil, null);
  cases.confirmPendingByPlaintiff(c6);
  assert.strictEqual(c6.plaintiffVakil.name, 'وکیل عمومی');
});

t('پذیرش عمومی مستقیم (دکمهٔ روی پرونده): مستقیم وارد مرحلهٔ تأیید شاکی می‌شود', () => {
  const c9 = cases.create({ complainantId: 'user-9', form, vakilPick: null });
  // وکیل خودش روی «پذیرش وکالت شاکی» می‌زند → بدون DM واسط، منتظر تأیید شاکی
  const p = cases.setPendingVakilAwaitingConfirm(c9, { discordId: 'vakil-21', name: 'وکیل مستقیم' });
  assert.ok(p);
  assert.strictEqual(c9.pendingVakil.status, 'awaiting_confirm');
  assert.strictEqual(c9.plaintiffVakil, null); // ثبت نهایی فقط با تأیید شاکی
  assert.ok(c9.pendingVakil.confirmExpiresAt > Date.now()); // مهلت ۱۲ ساعتهٔ تأیید
  // شاکی تأیید می‌کند → وکیل رسمی
  cases.confirmPendingByPlaintiff(c9);
  assert.strictEqual(c9.plaintiffVakil.name, 'وکیل مستقیم');
  // مسیر ردشده هم بسته است: وکیل مسدود یا پر بودن سمت → null
  assert.strictEqual(cases.setPendingVakilAwaitingConfirm(c9, { discordId: 'vakil-22', name: 'دیگری' }), null);
});

t('انقضای مهلت تأیید شاکی: وکیل مسدود نمی‌شود و می‌تواند دوباره درخواست دهد', () => {
  const c7 = cases.create({ complainantId: 'user-7', form, vakilPick: null });
  cases.setPendingVakil(c7, { discordId: 'vakil-12', name: 'وکیل منقضی' });
  cases.acceptPendingByVakil(c7);
  c7.pendingVakil.confirmExpiresAt = Date.now() - 1000;
  const swept = cases.sweepExpiredPending();
  assert.ok(swept.some((s) => s.case.number === c7.number && s.kind === 'confirm_expired'));
  assert.strictEqual(c7.pendingVakil, null);
  assert.ok(!(c7.rejectedVakils || []).includes('vakil-12')); // انقضا ≠ مسدودسازی
  assert.strictEqual(cases.canRequestPlaintiffVakil(c7, 'vakil-12'), true);
});

t('پس از رد شاکی، وکلای ردنشده در فهرست انتخاب مجدد می‌آیند', () => {
  const c8 = cases.create({ complainantId: 'user-8', form, vakilPick: null });
  cases.setPendingVakil(c8, { discordId: 'vakil-13', name: 'وکیل اول' });
  cases.acceptPendingByVakil(c8);
  cases.rejectPendingByPlaintiff(c8); // شاکی رد می‌کند → vakil-13 مسدود و pending پاک
  assert.strictEqual(c8.pendingVakil, null);
  const future = Date.now() + 86400000; // دورهٔ وکالت فعال برای همهٔ ورودی‌های ساختگی
  const list = cases.listAvailablePlaintiffVakils(c8, [
    { discordId: 'vakil-13', firstName: 'مسدود', lastName: 'شده', active: true, termEndsAt: future },
    { discordId: 'vakil-14', firstName: 'آزادِ', lastName: 'اول', active: true, termEndsAt: future },
    { discordId: 'vakil-15', firstName: 'آزادِ', lastName: 'دوم', active: true, termEndsAt: future },
  ]);
  const ids = list.map((v) => v.discordId);
  assert.ok(!ids.includes('vakil-13')); // مسدود حذف
  assert.ok(ids.includes('vakil-14') && ids.includes('vakil-15')); // بقیه آزادند
});

t('مطالعه فقط برای وکیل پذیرنده (هر دو سمت)', () => {
  assert.ok(cases.isAcceptedVakil({ id: 'vakil-1' }, c)); // وکیل شاکی
  assert.ok(cases.isAcceptedVakil({ id: 'vakil-2' }, c)); // وکیل مشتکی‌عنه
  assert.strictEqual(cases.isAcceptedVakil({ id: 'vakil-3' }, c), false);
});

// ---------- رأی نهایی ----------
t('رأی نهایی به نفع شاکی و بستن پرونده', () => {
  cases.closeWithRuling(c, { outcome: 'plaintiff', text: 'مشتکی‌عنه ملزم به استرداد است.', judgeId: 'judge-1' });
  assert.strictEqual(c.status, 'closed');
  assert.ok(c.finalRuling.text.includes('استرداد'));
});

t('آزاد شدن کول‌داون پس از بستن', () => {
  assert.strictEqual(cases.openCaseOf('user-1'), null);
});

// ---------- وکلا ----------
t('افزودن وکیل و روزشمار', () => {
  const v = vakils.create({ discordId: 'vakil-1', gameId: '7', firstName: 'رضا', lastName: 'محمدی', inGameName: 'Reza_M', days: 30 });
  assert.strictEqual(v.termDays, 30);
  assert.ok(vakils.termActive(v));
  assert.ok(vakils.findByName('رضا', 'محمدی'));
});

t('آمار پرونده و برد/باخت', () => {
  vakils.statInc('vakil-1', 'acceptedCases');
  vakils.statInc('vakil-1', 'wins');
  const v = vakils.findByDiscord('vakil-1');
  assert.strictEqual(v.acceptedCases, 1);
  assert.strictEqual(v.wins, 1);
  assert.strictEqual(v.losses, 0);
});

t('افزودن زمان آنلاین', () => {
  vakils.addOnlineSeconds('vakil-1', 3600);
  assert.strictEqual(vakils.findByDiscord('vakil-1').onlineSeconds, 3600);
});

t('لیدربورد مرتب', () => {
  vakils.create({ discordId: 'vakil-2', gameId: '8', firstName: 'سارا', lastName: 'احمدی', days: 30 });
  vakils.addOnlineSeconds('vakil-2', 7200);
  const lb = vakils.leaderboard();
  assert.strictEqual(lb[0].discordId, 'vakil-2');
});

// ---------- Embedها و UI ----------
t('Embed پرونده', () => {
  const e = embeds.caseEmbed(c);
  assert.ok(e.data.title.includes('فرم ثبت شکایت'));
  assert.ok(e.data.fields.length > 10);
});

t('Embed رأی نهایی', () => {
  const e = embeds.finalRulingEmbed(c);
  assert.ok(e.data.title.includes('رأی نهایی'));
  const f = e.data.fields.find((x) => x.name.includes('رأی نهایی'));
  assert.ok(f.value.includes('به نفع شاکی'));
});

t('Embed اطلاعیه', () => {
  const e = embeds.sessionAnnouncementEmbed(c);
  assert.ok(e.data.description.includes('۱۴۰۵'));
});

t('Embed لیست وکلا', () => {
  const rows = vakils.leaderboard().map((v) => ({ ...v }));
  const e = embeds.vakilListEmbed(rows, { onlineMap: {} });
  const names = (e.data.fields || []).map((f) => f.name).join(' | ');
  assert.ok(names.includes('رضا محمدی') || names.includes('سارا احمدی'));
});

t('پرونده‌های قبول‌شدهٔ هر وکیل برای /list', () => {
  const recs = vakils.acceptedCasesOf('vakil-1');
  const mine = recs.find((r) => r.number === c.number);
  assert.ok(mine);
  assert.strictEqual(mine.side, 'plaintiff');
  assert.strictEqual(mine.won, true); // رأی نهایی به نفع شاکی بود
  const recs2 = vakils.acceptedCasesOf('vakil-2');
  const mine2 = recs2.find((r) => r.number === c.number);
  assert.ok(mine2);
  assert.strictEqual(mine2.side, 'defendant');
  assert.strictEqual(mine2.won, false);
  assert.strictEqual(vakils.acceptedCasesOf('vakil-nada').length, 0);
});

t('کامپوننت‌های UI ساخته می‌شوند', () => {
  assert.strictEqual(judgePanelRow().components.length, 2);
  // پذیرش وکالت دو-طرفه: پیش‌فرض هر دو دکمه فعال
  assert.strictEqual(vakilPanelRow().components.length, 3);
  assert.strictEqual(vakilPanelRow({ status: 'registered' }).components.length, 3);
  assert.strictEqual(vakilPanelRow({ status: 'scheduled' }).components.length, 3);
  // پیشنهاد در جریان → دکمهٔ سمت شاکی «کلاً پنهان»؛ فقط مطالعه + دکمهٔ مشتکی‌عنه
  const pendingRow = vakilPanelRow({ status: 'registered', pendingVakil: { name: 'وکیل' } });
  assert.strictEqual(pendingRow.components.length, 2);
  assert.ok(!pendingRow.components[1].data.disabled);
  // وکیل شاکی پذیرفته → دکمهٔ شاکی حذف، دکمهٔ مشتکی‌عنه فعال
  assert.strictEqual(vakilPanelRow({ status: 'scheduled', plaintiffVakil: { name: 'a' } }).components.length, 2);
  // هر دو سمت پذیرفته → فقط مطالعه
  assert.strictEqual(vakilPanelRow({ status: 'scheduled', plaintiffVakil: { name: 'a' }, defendantVakil: { name: 'b' } }).components.length, 1);
  assert.strictEqual(vakilPanelRow({ status: 'closed' }).components.length, 1);
  assert.strictEqual(vakilSelectMenu([{ discordId: '1', firstName: 'ر', lastName: 'م', acceptedCases: 2 }]).components.length, 1);
  // «بدون وکیل» باید گزینهٔ اول منوی انتخاب وکیل باشد
  const selOpts = vakilSelectMenu([{ discordId: '1', firstName: 'ر', lastName: 'م', acceptedCases: 2 }]).components[0].options;
  assert.strictEqual(selOpts[0].data.value, 'novakil');
  assert.strictEqual(selOpts[1].data.value, 'vakil:1');
  const m = modal('paradise:test', 'عنوان', [{ id: 'f1', label: 'فیلد', required: true }, { id: 'f2', label: 'توضیح', paragraph: true }]);
  assert.strictEqual(m.components.length, 2);
});

t('پیش‌نویس فرم: ذخیره و بازیابی', () => {
  drafts.update('u1', 'A', { plaintiff_firstName: 'x' });
  drafts.update('u1', 'B', { def_firstName: 'y' });
  const d = drafts.get('u1');
  assert.strictEqual(d.stage, 'B');
  assert.strictEqual(d.data.plaintiff_firstName, 'x');
  drafts.remove('u1');
  assert.strictEqual(drafts.get('u1'), null);
});

t('ذخیره‌سازی روی دیسک (جدول JSON)', () => {
  const { JsonTable } = require('../src/storage');
  const tbl = new JsonTable('smoke-test', { hello: 1 });
  tbl.data.hello = 42;
  tbl.flush();
  const tbl2 = new JsonTable('smoke-test', { hello: 1 });
  assert.strictEqual(tbl2.data.hello, 42);
});

console.log(`\nنتایج دود: ${passed} موفق، ${failed} ناموفق`);
process.exit(failed ? 1 : 0);
