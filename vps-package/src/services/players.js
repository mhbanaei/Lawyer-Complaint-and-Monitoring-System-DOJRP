'use strict';

/**
 * سرویس اتصال به سرور بازیکنان FiveM
 * - دریافت players.json (با تحمل گواهی منقضی، فقط برای این هاست)
 * - کش چند دقیقه‌ای + پایش دوره‌ای آنلاین‌بودن وکلا
 */

const https = require('https');
const { URL } = require('url');
const cfg = require('../config');
const { JsonTable } = require('../storage');

let host_ = null;
try { host_ = new URL(cfg.playersUrl).host; } catch (_) { /* noop */ }

const agent = new https.Agent({
  // گواهی سرور x.paradiserp.ir منقضی است؛ فقط برای این هاست اعتبارسنجی را رد می‌کنیم
  rejectUnauthorized: false,
});

const onlineTable = new JsonTable('online', {});

let cache = { at: 0, players: [] };
const CACHE_MS = 60 * 1000;

function fetchPlayersJson() {
  return new Promise((resolve, reject) => {
    const u = new URL(cfg.playersUrl);
    const req = https.get({
      hostname: u.hostname,
      port: u.port || 443,
      path: `${u.pathname}${u.search}`,
      agent,
      timeout: 10000,
      headers: { 'User-Agent': 'ParadiseComplaintBot/1.0' },
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`پاسخ HTTP ${res.statusCode} از سرور بازیکنان`));
      }
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          resolve(Array.isArray(parsed) ? parsed : []);
        } catch (e) {
          reject(new Error('پاسخ سرور بازیکنان JSON معتبر نیست'));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('اتمام وقت اتصال به سرور بازیکنان')));
    req.on('error', reject);
  });
}

async function getPlayers(force = false) {
  if (!force && Date.now() - cache.at < CACHE_MS && cache.players.length) {
    return cache.players;
  }
  const players = await fetchPlayersJson();
  cache = { at: Date.now(), players };
  return players;
}

/** یافتن بازیکن بر اساس شناسهٔ درون‌بازی (gameId) */
async function findByGameId(gameId) {
  const players = await getPlayers(true);
  return players.find((p) => String(p.id) === String(gameId)) || null;
}

/** مقایسهٔ نام‌ها بدون حساسیت به بزرگی/کوچکی حروف و فاصله */
function sameName(a, b) {
  const x = String(a || '').trim().toLowerCase();
  const y = String(b || '').trim().toLowerCase();
  return x !== '' && x === y;
}

/**
 * آیا این بازیکن همان وکیل است؟
 * ترتیب تطبیق: gameId جلسهٔ فعلی → نام درون‌بازی ذخیره‌شده در /addvakil → شناسه‌های لایسنس.
 * نکته: id بازیکن بعد از هر DC و برگشتن تغییر می‌کند؛ به همین دلیل تطبیق نام اصلی‌ترین روش است.
 */
function playerMatchesVakil(player, vakil) {
  if (String(player.id) === String(vakil.gameId)) return true;
  if (sameName(player.name, vakil.inGameName)) return true;
  const vIds = new Set((vakil.identifiers || [])
    .filter((x) => typeof x === 'string' && !x.startsWith('ip:')));
  if (Array.isArray(player.identifiers)) return player.identifiers.some((idn) => vIds.has(idn));
  return false;
}

/**
 * آیا این وکیل در فهرست بازیکنان حاضر است؟
 */
function matchesPlayer(vakil, players) {
  return players.some((p) => playerMatchesVakil(p, vakil));
}

/**
 * پس از تطبیق، شناسه‌های متغیر وکیل را تازه می‌کند تا تطبیق‌های بعدی مطمئن‌تر شود:
 * id جلسهٔ فعلی، نام درون‌بازی (اگر عوض شده باشد) و شناسه‌های لایسنس جدید
 * @returns {boolean} آیا وکیل در فهرست پیدا شد؟
 */
function syncVakilFromPlayer(vakil, players) {
  const p = players.find((x) => playerMatchesVakil(x, vakil));
  if (!p) return false;
  const vakils = require('./vakils');
  let changed = false;
  if (String(p.id) !== String(vakil.gameId)) { vakil.gameId = String(p.id); changed = true; }
  if (p.name && !sameName(p.name, vakil.inGameName)) { vakil.inGameName = String(p.name).trim(); changed = true; }
  if (Array.isArray(p.identifiers) && p.identifiers.length) {
    const keep = new Set(vakil.identifiers || []);
    for (const idn of p.identifiers) {
      if (typeof idn === 'string' && !idn.startsWith('ip:') && !keep.has(idn)) { keep.add(idn); changed = true; }
    }
    if (changed) vakil.identifiers = [...keep];
  }
  if (changed) vakils.save();
  return true;
}

/** آیا بازیکن با این gameId الان آنلاین است؟ */
async function isOnline(gameId) {
  try {
    const players = await getPlayers();
    return players.some((p) => String(p.id) === String(gameId));
  } catch (_) {
    return null; // نامشخص (خطای شبکه)
  }
}

// ---------- پایش آنلاین‌بودن وکلا ----------
let pollTimer = null;

function startOnlinePolling(onTick) {
  if (pollTimer) return;
  const interval = Math.max(30, cfg.onlinePollSeconds) * 1000;
  pollTimer = setInterval(async () => {
    try {
      const vakils = require('./vakils');
      const list = vakils.activeVakils();
      if (!list.length) return;
      const players = await getPlayers(true).catch(() => null);
      if (!players) return; // خطای شبکه: این دور را رد کن
      let changed = false;
      for (const v of list) {
        const was = Boolean(onlineTable.data[v.discordId]);
        const now = syncVakilFromPlayer(v, players); // تطبیق + تازه‌سازی id/نام
        if (now && !was) onlineTable.data[v.discordId] = Date.now();
        else if (!now && was) {
          const started = onlineTable.data[v.discordId] || Date.now();
          vakils.addOnlineSeconds(v.discordId, Math.floor((Date.now() - started) / 1000));
          delete onlineTable.data[v.discordId];
        }
        if (was !== now) changed = true;
      }
      if (changed) { onlineTable.save(); vakils.save(); }
    } catch (e) {
      console.error('⚠️ Khataye payash online:', e.message);
    }
  }, interval);
  if (pollTimer.unref) pollTimer.unref();
}

function stopOnlinePolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

/** ثانیه‌های آنلاین فعلی (شامل جلسهٔ جاری) */
function currentOnlineSeconds(vakil) {
  let s = vakil.onlineSeconds || 0;
  const since = onlineTable.data[vakil.discordId];
  if (since) s += Math.floor((Date.now() - since) / 1000);
  return s;
}

function isCurrentlyOnline(vakil) {
  return Boolean(onlineTable.data[vakil.discordId]);
}

// در زمان خاموشی، جلسات باز را ببند
function flushOnExit() {
  try {
    const vakils = require('./vakils');
    const now = Date.now();
    for (const [did, since] of Object.entries(onlineTable.data)) {
      vakils.addOnlineSeconds(did, Math.floor((now - since) / 1000));
    }
    onlineTable.data = {};
    vakils.save();
    onlineTable.flush();
  } catch (_) { /* noop */ }
}
process.on('exit', flushOnExit);

module.exports = {
  getPlayers,
  findByGameId,
  matchesPlayer,
  isOnline,
  startOnlinePolling,
  stopOnlinePolling,
  currentOnlineSeconds,
  isCurrentlyOnline,
  flushOnExit,
};
