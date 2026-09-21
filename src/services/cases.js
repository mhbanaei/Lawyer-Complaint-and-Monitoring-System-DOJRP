'use strict';

/**
 * سرویس پرونده‌های شکایت
 * چرخهٔ عمر: ثبت → تعیین وقت دادگاه → پذیرش وکالت‌ها → رأی نهایی → بسته‌شدن
 */

const { JsonTable } = require('../storage');
const { id } = require('../util');

const table = new JsonTable('cases', []);
const state = new JsonTable('state', { seq: 0, msgIndex: {} });

/** مهلت پاسخ وکیلِ انتخابی به پیشنهاد وکالت (ساعت) */
const REQUEST_HOURS = 12;

/** @returns {Array} همهٔ پرونده‌ها */
function all() {
  return table.data;
}

function save() {
  table.save();
  state.save();
}

function flush() {
  table.flush();
  state.flush();
}

/** شمارهٔ ثبت جدید (ترتیبی) */
function nextNumber() {
  state.data.seq = (state.data.seq || 0) + 1;
  return state.data.seq;
}

/** پیش‌نمایش شمارهٔ ثبت بعدی (بدون مصرف) — برای فرم وب */
function peekNumber() {
  return (state.data.seq || 0) + 1;
}

/** ثبت پروندهٔ جدید؛ رکورد کامل برمی‌گرداند */
function create({ complainantId, form, vakilPick }) {
  const now = Date.now();
  const rec = {
    number: nextNumber(),
    status: 'registered', // registered | scheduled | closed
    createdAt: now,
    complainantId,
    // بخش اطلاعات شاکی
    plaintiff: {
      firstName: form.plaintiff_firstName,
      lastName: form.plaintiff_lastName,
      fatherName: form.plaintiff_fatherName || '—',
      nationalId: form.plaintiff_nationalId || '—',
      phone: form.plaintiff_phone,
      job: form.plaintiff_job || '—',
      residence: form.plaintiff_residence || '—',
    },
    // بخش وکیل شاکی (انتخاب از منو)
    vakil: vakilPick ? { discordId: vakilPick.discordId, name: vakilPick.name } : null,
    // مشتکی‌عنهم: از فرم وب آرایهٔ چندنفره می‌آید؛ از فرم دیسکورد ۱ نفر
    defendants: (Array.isArray(form.defendants) && form.defendants.length
      ? form.defendants
      : [{
        firstName: form.def_firstName,
        lastName: form.def_lastName,
        fatherName: form.def_fatherName,
        phone: form.def_phone,
        job: form.def_job,
        relation: form.def_relation,
        place: form.def_place,
      }]
    ).map((d) => ({
      firstName: d.firstName || '—',
      lastName: d.lastName || '—',
      fatherName: d.fatherName || '—',
      phone: d.phone || '—',
      job: d.job || '—',
      relation: d.relation || '—',
      place: d.place || '—',
    })),
    subject: form.subject,
    occurredAt: form.occurredAt || '—',
    occurredPlace: form.occurredPlace || '—',
    occurredDetail: form.occurredDetail || '—',
    evidence: form.evidence || '—',
    description: form.description,
    demand: form.demand || '—',
    // خروجی‌های دادگاه
    session: null,       // { type:'private'|'public', at:ms, atText, judgeId, announcementMsgId }
    // وکالت دو-طرفه
    plaintiffVakil: null, // { discordId, name, acceptedAt }
    defendantVakil: null, // { discordId, name, acceptedAt }
    pendingVakil: null,   // { status:'pending'|'awaiting_confirm', discordId, name, expiresAt, dmMessageId, confirmDmMessageId } — پیشنهاد وکالت شاکی
    vakilRequests: [],    // سابقهٔ پیشنهادها/پذیرش‌ها
    rejectedVakils: [],   // وکلایی که درخواستشان از سوی شاکی رد شده (حق درخواست مجدد ندارند)
    finalRuling: null,   // { outcome:'plaintiff'|'defendant', text, judgeId, at }
    closedAt: null,
  };
  table.data.push(rec);
  table.save();
  return rec;
}

// ---------- مهاجرت رکوردهای قدیمی (acceptedVakil تکی → دو-طرفه) ----------
(function migrate() {
  let changed = false;
  for (const c of table.data) {
    if (c.acceptedVakil && !c.plaintiffVakil && !c.defendantVakil) {
      const key = c.acceptedVakil.side === 'defendant' ? 'defendantVakil' : 'plaintiffVakil';
      c[key] = { discordId: c.acceptedVakil.discordId, name: c.acceptedVakil.name, acceptedAt: c.acceptedVakil.at || Date.now() };
      c.acceptedVakil = null;
      changed = true;
    }
    if (!Array.isArray(c.vakilRequests)) c.vakilRequests = [];
    if (!Array.isArray(c.rejectedVakils)) c.rejectedVakils = [];
    if (c.pendingVakil && !c.pendingVakil.status) c.pendingVakil.status = 'pending';
  }
  if (changed) table.save();
})();

function findByNumber(number) {
  return table.data.find((c) => c.number === Number(number)) || null;
}

/** پروندهٔ بازِ کاربر (کول‌داون: یک پروندهٔ باز در هر لحظه) */
function openCaseOf(discordId) {
  return table.data.find((c) => c.status !== 'closed' && c.complainantId === discordId) || null;
}

function isComplainant(user, c) { return c && c.complainantId === user.id; }
function isJudge(user, cfgRoles) { return user && cfgRoles.judge && user.roles?.cache?.has(cfgRoles.judge); }
function isDeputy(user, cfgRoles) { return user && cfgRoles.deputy && user.roles?.cache?.has(cfgRoles.deputy); }

/** آیا کاربر وکیلِ پذیرندهٔ این پرونده است؟ (هر دو سمت) */
function isAcceptedVakil(user, c) {
  return Boolean((c.plaintiffVakil && c.plaintiffVakil.discordId === user.id)
    || (c.defendantVakil && c.defendantVakil.discordId === user.id));
}

/**
 * درخواست وکالت شاکی (هم وکیلِ انتخابیِ فرم و هم پذیرش عمومی):
 * همیشه وضعیت pending با مهلت ۱۲ ساعته — ثبت نهایی فقط با تأیید شاکی
 */
function setPendingVakil(c, { discordId, name, origin }) {
  const now = Date.now();
  c.pendingVakil = {
    status: 'pending',
    discordId,
    name,
    origin: origin === 'citizen_pick' ? 'citizen_pick' : 'open_request',
    requestedAt: now,
    expiresAt: now + REQUEST_HOURS * 3600000,
    dmMessageId: null,
    confirmDmMessageId: null,
  };
  c.vakilRequests.push({ discordId, name, outcome: 'pending', at: now });
  table.save();
  return c.pendingVakil;
}

function setPendingDmMessage(c, msgId) {
  if (c.pendingVakil) {
    c.pendingVakil.dmMessageId = msgId;
    table.save();
  }
}

/** وکیلِ انتخابی پیشنهاد را پذیرفت → حالا نوبت تأیید شاکی است */
function acceptPendingByVakil(c) {
  if (!c.pendingVakil || c.pendingVakil.status !== 'pending') return null;
  c.pendingVakil.status = 'awaiting_confirm';
  c.pendingVakil.confirmExpiresAt = Date.now() + REQUEST_HOURS * 3600000;
  // شماره تماس وکیل از رجیستری به پرونده منتقل می‌شود
  try {
    const v = require('./vakils').findByDiscord(c.pendingVakil.discordId);
    c.pendingVakil.phone = (v && v.phone) || null;
  } catch (_) { c.pendingVakil.phone = null; }
  const log = c.vakilRequests[c.vakilRequests.length - 1];
  if (log && log.discordId === c.pendingVakil.discordId && log.outcome === 'pending') log.outcome = 'accepted_awaiting_confirm';
  table.save();
  return c.pendingVakil;
}

/**
 * درخواست عمومی وکیل (دکمهٔ «پذیرش وکالت شاکی» روی پیام پرونده):
 * وکیل خودش همین‌جا درخواست داده؛ مستقیم وارد مرحلهٔ «در انتظار تأیید شاکی» می‌شود.
 * ثبت نهایی همچنان فقط با تأیید صریح شاکی (confirmPendingByPlaintiff) انجام می‌شود.
 */
function setPendingVakilAwaitingConfirm(c, { discordId, name, phone }) {
  if (c.plaintiffVakil || c.pendingVakil) return null;
  if ((c.rejectedVakils || []).includes(discordId)) return null;
  const now = Date.now();
  c.pendingVakil = {
    status: 'awaiting_confirm',
    discordId,
    name,
    phone: phone || null,
    origin: 'open_request',
    requestedAt: now,
    expiresAt: now + REQUEST_HOURS * 3600000,
    confirmExpiresAt: now + REQUEST_HOURS * 3600000,
    dmMessageId: null,
    confirmDmMessageId: null,
  };
  c.vakilRequests.push({ discordId, name, outcome: 'accepted_awaiting_confirm', at: now });
  table.save();
  return c.pendingVakil;
}

/** شاکی وکیل را تأیید کرد → وکیلِ رسمی سمت شاکی می‌شود */
function confirmPendingByPlaintiff(c) {
  if (!c.pendingVakil || c.pendingVakil.status !== 'awaiting_confirm') return null;
  const p = c.pendingVakil;
  c.plaintiffVakil = { discordId: p.discordId, name: p.name, phone: p.phone || null, acceptedAt: Date.now() };
  const log = c.vakilRequests[c.vakilRequests.length - 1];
  if (log && log.discordId === p.discordId) log.outcome = 'confirmed';
  c.pendingVakil = null;
  table.save();
  return p;
}

/**
 * شاکی وکیل را رد کرد → وکیل حق درخواست مجدد ندارد و گزینه برای بقیه باز می‌شود
 * @param {boolean} opts.block فقط ردِ صریح شاکی وکیل را مسدود می‌کند؛ انقضای مهلت مسدود نمی‌کند
 */
function rejectPendingByPlaintiff(c, { block = true } = {}) {
  if (!c.pendingVakil || c.pendingVakil.status !== 'awaiting_confirm') return null;
  const p = c.pendingVakil;
  if (block && !c.rejectedVakils.includes(p.discordId)) c.rejectedVakils.push(p.discordId);
  const log = c.vakilRequests[c.vakilRequests.length - 1];
  if (log && log.discordId === p.discordId) log.outcome = block ? 'rejected_by_plaintiff' : 'confirm_expired';
  c.pendingVakil = null;
  table.save();
  return p;
}

/** آیا این وکیل حق درخواست وکالت سمت شاکی را دارد؟ */
function canRequestPlaintiffVakil(c, discordId) {
  return !c.plaintiffVakil && !c.pendingVakil && !(c.rejectedVakils || []).includes(discordId);
}

/**
 * درخواست وکالت سمت شاکی: هم از انتخاب خود شاکی (citizen_pick) و هم پذیرش عمومی وکیل (open_request).
 * در هر دو حالت وکیل فقط پس از تأیید صریح شاکی (confirmPendingByPlaintiff) رسمی می‌شود.
 */
function requestPlaintiffVakilByCitizen(c, { discordId, name, origin }) {
  if (c.plaintiffVakil || c.pendingVakil) return null;
  if ((c.rejectedVakils || []).includes(discordId)) return null;
  return setPendingVakil(c, { discordId, name, origin });
}

/** وکلای مجاز برای انتخاب مجدد شاکی (مسدودها و آن‌هایی که قبلاً رد کردند حذف می‌شوند) */
function listAvailablePlaintiffVakils(c, vakilList) {
  return vakilList.filter((v) => canRequestPlaintiffVakil(c, v.discordId));
}

/**
 * شناسهٔ پیام رونوشت DM را ذخیره می‌کند تا پس از صدور رأی، همان پیام
 * به شکل رأی نهایی ویرایش شود (بدون ارسال پیام جدید)
 * @param {object} c پرونده
 * @param {'complainant'|'plaintiffVakil'|'defendantVakil'} role نقش گیرنده
 */
function setCopyMsgIds(c, role, msgId) {
  if (!c.copyMessages) c.copyMessages = {};
  c.copyMessages[role] = msgId;
  table.save();
}

/** ثبت پاسخ وکیل به پیشنهاد (accept | reject | expired) و پاک‌کردن پیشنهاد */
function respondPending(c, outcome) {
  if (!c.pendingVakil) return null;
  const p = c.pendingVakil;
  const log = c.vakilRequests[c.vakilRequests.length - 1];
  if (log && log.discordId === p.discordId && log.outcome === 'pending') log.outcome = outcome;
  c.pendingVakil = null;
  table.save();
  return p;
}

/** رد خودکار پیشنهادهای منقضی‌شده — هم «در انتظار وکیل» و هم «در انتظار تأیید شاکی» */
function sweepExpiredPending() {
  const swept = [];
  const now = Date.now();
  for (const c of table.data) {
    if (!c.pendingVakil) continue;
    if (c.pendingVakil.status === 'pending' && now > c.pendingVakil.expiresAt) {
      // انقضای مهلت وکیل ← وکیل مسدود نمی‌شود؛ فقط پیشنهاد پاک و درخواست‌های تازه باز می‌شود
      const p = respondPending(c, 'expired');
      swept.push({ case: c, pending: p, kind: 'vakil_expired' });
    } else if (c.pendingVakil.status === 'awaiting_confirm' && now > (c.pendingVakil.confirmExpiresAt || c.pendingVakil.expiresAt)) {
      // انقضای مهلت تأیید ← وکیل مسدود نمی‌شود؛ فقط درخواست پاک و انتخاب مجدد باز می‌شود
      const p = rejectPendingByPlaintiff(c, { block: false });
      swept.push({ case: c, pending: p, kind: 'confirm_expired' });
    }
  }
  return swept;
}

/**
 * پذیرش وکالت سمت مشتکی‌عنه (نخستین وکیل؛ نیازی به تأیید طرف مقابل ندارد)
 */
function acceptSideVakil(c, { discordId, name, phone, side }) {
  const key = side === 'defendant' ? 'defendantVakil' : 'plaintiffVakil';
  if (c[key]) return false;
  c[key] = { discordId, name, phone: phone || null, acceptedAt: Date.now() };
  c.vakilRequests.push({ discordId, name, outcome: `accepted:${side}`, at: Date.now() });
  table.save();
  return true;
}



/** ثبت وقت دادگاه */
function setSession(c, { type, at, atText, judgeId }) {
  c.session = { type, at, atText, judgeId, announcementMsgId: null };
  c.status = 'scheduled';
  table.save();
}

function setAnnouncementMsg(c, msgId) {
  if (c.session) {
    c.session.announcementMsgId = msgId;
    table.save();
  }
}

/** ثبت رأی نهایی و بستن پرونده */
function closeWithRuling(c, { outcome, text, judgeId }) {
  c.finalRuling = { outcome, text, judgeId, at: Date.now() };
  c.status = 'closed';
  c.closedAt = Date.now();
  table.save();
}

/** ایندکس پیام → پرونده (برای هندل دکمه‌های زیر پیام پرونده) */
function indexMessage(msgId, caseNumber) {
  state.data.msgIndex[msgId] = caseNumber;
  state.save();
}

function caseByMessage(msgId) {
  const n = state.data.msgIndex[msgId];
  return n ? findByNumber(n) : null;
}

/** آمار کلی برای داشبورد */
function stats() {
  const open = table.data.filter((c) => c.status !== 'closed').length;
  const closed = table.data.filter((c) => c.status === 'closed').length;
  return { total: table.data.length, open, closed };
}

module.exports = {
  all,
  save,
  flush,
  create,
  peekNumber,
  findByNumber,
  openCaseOf,
  isComplainant,
  isJudge,
  isDeputy,
  isAcceptedVakil,
  acceptSideVakil,
  setPendingVakil,
  setPendingVakilAwaitingConfirm,
  setPendingDmMessage,
  acceptPendingByVakil,
  confirmPendingByPlaintiff,
  rejectPendingByPlaintiff,
  canRequestPlaintiffVakil,
  requestPlaintiffVakilByCitizen,
  listAvailablePlaintiffVakils,
  respondPending,
  sweepExpiredPending,
  REQUEST_HOURS,
  setSession,
  setAnnouncementMsg,
  setCopyMsgIds,
  closeWithRuling,
  indexMessage,
  caseByMessage,
  stats,
};
