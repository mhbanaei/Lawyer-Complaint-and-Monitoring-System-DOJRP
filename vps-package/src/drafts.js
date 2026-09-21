'use strict';

/**
 * پیش‌نویس‌های فرم شکایت در حافظه (به‌ازای هر کاربر یک پیش‌نویس)
 * با انقضا به‌صورت خودکار پاک می‌شود.
 */

const TTL_MS = 30 * 60 * 1000; // ۳۰ دقیقه

const drafts = new Map(); // userId -> { stage, data, updatedAt }

function touch(userId, stage) {
  const cur = drafts.get(userId) || { data: {} };
  cur.stage = stage || cur.stage || 'A';
  cur.updatedAt = Date.now();
  drafts.set(userId, cur);
  return cur;
}

function get(userId) {
  return drafts.get(userId) || null;
}

function update(userId, stage, fields) {
  const cur = touch(userId, stage);
  Object.assign(cur.data, fields);
  cur.updatedAt = Date.now();
  return cur;
}

function setData(userId, data) {
  const cur = touch(userId, 'A');
  cur.data = data;
  return cur;
}

function setStage(userId, stage) {
  return touch(userId, stage);
}

function remove(userId) {
  drafts.delete(userId);
}

// پاکسازی دوره‌ای پیش‌نویس‌های منقضی
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [uid, d] of drafts) {
    if (now - d.updatedAt > TTL_MS) drafts.delete(uid);
  }
}, 5 * 60 * 1000);
if (sweep.unref) sweep.unref();

module.exports = { touch, get, update, setData, setStage, remove };
