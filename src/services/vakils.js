'use strict';

/**
 * سرویس وکلا: ثبت، حذف، دورهٔ وکالت، آمار پرونده و برد/باخت
 */

const { JsonTable } = require('../storage');

const table = new JsonTable('vakils', []);

/** @returns {Array} همهٔ وکلا */
function all() {
  return table.data;
}

function save() {
  table.save();
}

function flush() {
  table.flush();
}

function findByName(firstName, lastName) {
  const fn = String(firstName || '').trim();
  const ln = String(lastName || '').trim();
  return table.data.find((v) =>
    v.firstName.toLowerCase() === fn.toLowerCase()
    && v.lastName.toLowerCase() === ln.toLowerCase()) || null;
}

function findByDiscord(discordId) {
  return table.data.find((v) => v.discordId === discordId) || null;
}

function create({ discordId, gameId, firstName, lastName, inGameName, phone, days, identifiers }) {
  const now = Date.now();
  const rec = {
    discordId,
    gameId: String(gameId),
    identifiers: Array.isArray(identifiers) ? identifiers.filter((x) => typeof x === 'string' && !x.startsWith('ip:')) : [],
    firstName,
    lastName,
    phone: String(phone || '').trim(),
    inGameName: inGameName || `${firstName} ${lastName}`,
    termDays: days,
    termStartedAt: now,
    termEndsAt: now + days * 86400000,
    onlineSeconds: 0,
    acceptedCases: 0,
    wins: 0,
    losses: 0,
    active: true,
    createdAt: now,
  };
  table.data.push(rec);
  table.save();
  return rec;
}

function remove(rec) {
  const i = table.data.indexOf(rec);
  if (i >= 0) table.data.splice(i, 1);
  table.save();
}

/** آیا دورهٔ وکالت فعال است؟ */
function termActive(v) {
  return Boolean(v) && v.active !== false && Date.now() < v.termEndsAt;
}

/** پایان خودکار دوره‌های تمام‌شده (فقط علامت‌گذاری) */
function sweepExpired() {
  let changed = false;
  for (const v of table.data) {
    if (v.active !== false && Date.now() >= v.termEndsAt) {
      v.active = false;
      changed = true;
    }
  }
  if (changed) table.save();
  return changed;
}

/** روزهای باقی‌ماندهٔ دوره (اعشاری) */
function daysLeft(v) {
  return Math.max(0, (v.termEndsAt - Date.now()) / 86400000);
}

function addOnlineSeconds(discordId, seconds) {
  const v = findByDiscord(discordId);
  if (v) {
    v.onlineSeconds = (v.onlineSeconds || 0) + seconds;
    table.save();
  }
}

function statInc(discordId, field) {
  const v = findByDiscord(discordId);
  if (v) {
    v[field] = (v[field] || 0) + 1;
    table.save();
  }
}

/**
 * وکلای قابل انتخاب برای شاکی: دوره فعال + آنلاین یا اخیراً فعال
 * (برای نمایش منوی مرحلهٔ D فرم شکایت)
 */
function availableForCitizen() {
  sweepExpired();
  return table.data.filter((v) => termActive(v));
}

/** همهٔ وکلای دارای دورهٔ فعال برای اطلاع‌رسانی پذیرش وکالت */
function activeVakils() {
  sweepExpired();
  return table.data.filter((v) => termActive(v));
}

/** لیست کامل برای /list */
function leaderboard() {
  sweepExpired();
  return [...table.data].sort((a, b) => (b.onlineSeconds || 0) - (a.onlineSeconds || 0));
}

/**
 * پرونده‌های پذیرفته‌شدهٔ یک وکیل (هر دو سمت) — با شماره، وضعیت و نتیجه
 * برای نمایش در /list
 */
function acceptedCasesOf(discordId) {
  const cases = require('./cases'); // require داخلی برای پرهیز از وابستگی حلقوی
  return cases.all()
    .filter((c) => (c.plaintiffVakil && c.plaintiffVakil.discordId === discordId)
      || (c.defendantVakil && c.defendantVakil.discordId === discordId))
    .sort((a, b) => a.number - b.number)
    .map((c) => ({
      number: c.number,
      subject: c.subject,
      status: c.status,
      side: (c.plaintiffVakil && c.plaintiffVakil.discordId === discordId) ? 'plaintiff' : 'defendant',
      outcome: c.finalRuling ? c.finalRuling.outcome : null,
      won: c.finalRuling
        ? (c.finalRuling.outcome === 'plaintiff') === (c.plaintiffVakil && c.plaintiffVakil.discordId === discordId)
        : null,
    }));
}

module.exports = {
  table,
  all,
  save,
  flush,
  findByName,
  findByDiscord,
  create,
  remove,
  termActive,
  sweepExpired,
  daysLeft,
  addOnlineSeconds,
  statInc,
  availableForCitizen,
  activeVakils,
  leaderboard,
  acceptedCasesOf,
};
