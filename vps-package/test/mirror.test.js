'use strict';

/**
 * تست آینهٔ DM وکلا (BOT_TEST_MODE=1 node test/mirror.test.js)
 * - انتشار پرونده → آینهٔ DM برای همهٔ وکلای فعال
 * - دکمهٔ پذیرش از داخل DM → ثبت درخواست + مرحلهٔ تأیید شاکی
 * - تأیید شاکی → ثبت نهایی، محو دکمهٔ سمت شاکی (همگام کانال و DM)
 * - رأی نهایی → آینه‌ها بدون دکمه و با embed رأی
 */

process.env.BOT_TEST_MODE = '1';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// دیتای موقت برای جدا شدن از data/ واقعی
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mirror-test-'));
process.chdir(tmp);

const cases = require('../src/services/cases');
const vakils = require('../src/services/vakils');
const mirror = require('../src/services/mirror');
const vakilHandler = require('../src/handlers/vakilHandler');
const ui = require('../src/ui');
const embeds = require('../src/embeds');

let passed = 0;
let failed = 0;
function t(name, fn) {
  try { fn(); passed += 1; console.log(`  ✓ ${name}`); } catch (e) { failed += 1; console.error(`  ✗ ${name}: ${e.message}`); }
}
async function ta(name, fn) {
  try { await fn(); passed += 1; console.log(`  ✓ ${name}`); } catch (e) { failed += 1; console.error(`  ✗ ${name}: ${e.message}`); }
}

/** کلاینت جعلی: users.fetch/send و channels.fetch */
function fakeClient() {
  return {
    users: {
      fetch: async (id) => ({
        id,
        send: async () => ({ id: `dm-${id}-${Math.random().toString(36).slice(2, 8)}` }),
      }),
    },
    channels: { fetch: async () => null },
  };
}

async function main() {
  console.log('— آماده‌سازی: سه وکیل فعال (شاکی خودش هم وکیل است) —');
  vakils.create({ discordId: 'vak1', gameId: '7', firstName: 'One', lastName: 'First', inGameName: 'ONE', phone: '09120000000', days: 30 });
  vakils.create({ discordId: 'vak2', gameId: '8', firstName: 'Two', lastName: 'Second', inGameName: 'TWO', phone: '09350000000', days: 30 });
  vakils.create({ discordId: 'citizen', gameId: '9', firstName: 'Com', lastName: 'Plain', inGameName: 'CIT', phone: '09360000000', days: 30 });
  assert.strictEqual(vakils.activeVakils().length, 3);

  const client = fakeClient();

  console.log('— انتشار پرونده و آینهٔ DM —');
  const c = cases.create({
    complainantId: 'citizen',
    form: { plaintiff_firstName: 'Ali', plaintiff_lastName: 'Ahmadi', plaintiff_phone: '0911', def_firstName: 'Reza', def_lastName: 'Karimi', subject: 'تست', description: 'شرح' },
    vakilPick: null,
  });
  await ta('آینه برای دو وکیل دیگر + نسخهٔ بدون دکمهٔ شاکی ارسال شد', async () => {
    const n = await mirror.mirrorToVakils(client, c);
    assert.strictEqual(n, 3); // آینهٔ vak1 + آینهٔ vak2 + آینهٔ شاکی
    assert.ok(c.vakilMirror && c.vakilMirror.vak1 && c.vakilMirror.vak2);
  });

  t('شاکیِ وکیل فقط نسخهٔ بدون دکمه می‌گیرد (نه نسخهٔ وکیل)', () => {
    assert.ok(!c.vakilMirror.citizen, 'شاکی نباید آینهٔ وکیل با دکمه داشته باشد');
    assert.ok(c.complainantMirror, 'شاکی نسخهٔ بدون دکمه دارد');
    assert.strictEqual(mirror.complainantPayload(c).components.length, 0, 'نسخهٔ شاکی هیچ دکمه‌ای ندارد');
    assert.strictEqual(mirror.mirrorPayload(c).components.length, 1, 'نسخهٔ وکیل دکمه دارد');
  });

  t('دکمه‌های پنل وکیل شمارهٔ پرونده دارند', () => {
    const row = ui.vakilPanelRow(c);
    const ids = row.components.map((b) => b.data.custom_id);
    assert.ok(ids.includes(`paradise:vakil:read:${c.number}`));
    assert.ok(ids.includes(`paradise:vakil:accept:plaintiff:${c.number}`));
    assert.ok(ids.includes(`paradise:vakil:accept:defendant:${c.number}`));
  });

  t('آینهٔ اولیه همان دکمه‌های پنل را دارد', () => {
    const p = mirror.mirrorPayload(c);
    assert.strictEqual(p.components.length, 1);
    assert.ok(p.components[0].components.some((b) => b.data.custom_id === `paradise:vakil:accept:plaintiff:${c.number}`));
  });

  console.log('— پذیرش وکالت شاکی از داخل DM وکیل ۱ —');
  await ta('درخواست ثبت و وارد مرحلهٔ تأیید شاکی شد', async () => {
    const interaction = {
      user: { id: 'vak1' },
      member: { roles: { cache: new Map() } },
      message: { id: 'mirror-msg-vak1' },
      customId: `paradise:vakil:accept:plaintiff:${c.number}`,
      client,
      reply: async (x) => x,
      update: async (x) => x,
    };
    await vakilHandler.onComponent(interaction);
    assert.ok(c.pendingVakil);
    assert.strictEqual(c.pendingVakil.status, 'awaiting_confirm');
    assert.strictEqual(c.pendingVakil.discordId, 'vak1');
  });

  console.log('— تأیید شاکی از داخل DM —');
  await ta('وکیل شاکی نهایی شد', async () => {
    const interaction = {
      user: { id: 'citizen' },
      member: null, // داخل DM بدون گیلد
      message: { id: 'confirm-dm' },
      customId: `paradise:vakil:confirm:accept:${c.number}`,
      client,
      reply: async (x) => x,
      update: async (x) => x,
    };
    await vakilHandler.onComponent(interaction);
    assert.ok(c.plaintiffVakil && c.plaintiffVakil.discordId === 'vak1');
  });

  t('پس از ثبت، دکمهٔ سمت شاکی از پنل حذف می‌شود (همگام کانال و DMها)', () => {
    const ids = ui.vakilPanelRow(c).components.map((b) => b.data.custom_id);
    assert.ok(!ids.some((i) => i.includes('plaintiff')), 'دکمهٔ شاکی نباشد');
    assert.ok(ids.includes(`paradise:vakil:accept:defendant:${c.number}`), 'دکمهٔ متشاکی(شکایت‌شده) بماند');
  });

  t('آینهٔ همگام‌شده هم دیگر دکمهٔ شاکی ندارد', () => {
    const p = mirror.mirrorPayload(c);
    assert.ok(!p.components[0].components.some((b) => b.data.custom_id.includes('plaintiff')));
  });

  console.log('— رأی نهایی (مختومه) —');
  cases.closeWithRuling(c, { outcome: 'dismissed', text: 'به جهات قانونی مختومه اعلام شد.', judgeId: 'judge' });

  t('آینهٔ رأی نهایی بدون دکمه است', () => {
    const p = mirror.mirrorPayload(c);
    assert.strictEqual(p.components.length, 0);
    assert.ok(p.embeds[0].data.title.includes('رأی نهایی'));
  });

  await ta('همگام‌سازی نهایی آینه‌ها بدون خطا (شاکی هم ویرایش می‌شود)', async () => {
    await mirror.mirrorToVakils(client, c);
    assert.strictEqual(mirror.complainantPayload(c).components.length, 0);
  });

  t('embed کامل پرونده (full) برای وکیل پذیرنده ساخته می‌شود', () => {
    const e = embeds.caseEmbed(c, { full: true });
    assert.ok(e.data.description || e.data.fields.length > 0);
  });

  console.log(`\nنتیجه: ${passed} موفق، ${failed} ناموفق`);
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
