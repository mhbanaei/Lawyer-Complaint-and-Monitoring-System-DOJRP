'use strict';

/**
 * سرویس «آینهٔ DM» پرونده:
 * همان پیام پروندهٔ کانال شکایات با همان دکمه‌ها برای همهٔ وکلای فعال در DM ارسال می‌شود
 * و در هر تغییر وضعیت پرونده، همان پیام‌ها همگام با کانال ویرایش می‌شوند.
 * دکمه‌ها حاوی شمارهٔ پرونده‌اند → در DM هم همان هندلرِ کانال پاسخ می‌دهد.
 * خودِ شاکی هم نسخهٔ بدون دکمهٔ همین پیام را در DM می‌گیرد — حتی اگر خودش وکیل باشد.
 */

const fa = require('../fa');
const embeds = require('../embeds');
const { vakilPanelRow } = require('../ui');
const cases = require('./cases');
const vakils = require('./vakils');

/** محتوای کامل آینه (embed + دکمه‌ها) بر اساس وضعیت پرونده */
function mirrorPayload(c) {
  if (c.status === 'closed') {
    return {
      content: `بسمه‌تعالی\n⚖️ **رأی نهایی پروندهٔ شمارهٔ ${fa.digits(c.number)}**`,
      embeds: [embeds.finalRulingEmbed(c)],
      components: [], // پرونده بسته شد → دکمه‌ها حذف می‌شوند
    };
  }
  return {
    content: `📋 **پروندهٔ شکایت — شمارهٔ ثبت: ${fa.digits(c.number)}**`,
    embeds: [embeds.caseEmbed(c)],
    components: [vakilPanelRow(c)],
  };
}

/** ارسال یا ویرایش آینه برای یک وکیل؛ شناسهٔ پیام ذخیره می‌شود */
async function mirrorTo(client, c, discordId) {
  const u = await client.users.fetch(discordId).catch(() => null);
  if (!u) return false;

  const payload = mirrorPayload(c);
  const oldId = c.vakilMirror && c.vakilMirror[discordId];
  if (oldId) {
    try {
      const dm = await u.createDM();
      const msg = await dm.messages.fetch(oldId);
      await msg.edit(payload);
      return true;
    } catch (_) {
      // پیام قبلی پاک شده یا DM بسته شد → نسخهٔ تازه ارسال می‌شود
    }
  }

  const sent = await u.send(payload).catch((e) => {
    console.warn(`⚠️ Ayene-ye parvande-ye ${c.number} be vakil ${discordId} ersal nashod (DM baste ast):`, e.message);
    return null;
  });
  if (sent) cases.setVakilMirrorIds(c, discordId, sent.id);
  return Boolean(sent);
}

/** محتوای آینه برای شاکی — همان پرونده ولی بدون هیچ دکمه‌ای (دکمه‌ها فقط برای قاضی و وکلا) */
function complainantPayload(c) {
  if (c.status === 'closed') {
    return {
      content: `بسمه‌تعالی\n⚖️ **رأی نهایی پروندهٔ شمارهٔ ${fa.digits(c.number)}**`,
      embeds: [embeds.finalRulingEmbed(c)],
      components: [],
    };
  }
  return {
    content: `📋 **پروندهٔ شکایت — شمارهٔ ثبت: ${fa.digits(c.number)}**`,
    embeds: [embeds.caseEmbed(c)],
    components: [],
  };
}

/** آینه برای همهٔ وکلای فعال + خود شاکی (نسخهٔ شاکی بدون دکمه است) */
async function mirrorToVakils(client, c) {
  let count = 0;
  for (const v of vakils.activeVakils()) {
    if (v.discordId === c.complainantId) continue; // شاکی جداگانه و بدون دکمه دریافت می‌کند
    // eslint-disable-next-line no-await-in-loop
    await mirrorTo(client, c, v.discordId);
    count += 1;
  }

  // آینهٔ شاکی — حتی اگر خودش وکیل باشد (یعنی می‌تواند هم آینهٔ وکیل با دکمه و هم نسخهٔ خودش را داشته باشد)
  const u = await client.users.fetch(c.complainantId).catch(() => null);
  if (u) {
    const payload = complainantPayload(c);
    const oldId = c.complainantMirror;
    let done = false;
    if (oldId) {
      try {
        const dm = await u.createDM();
        const msg = await dm.messages.fetch(oldId);
        await msg.edit(payload);
        done = true;
      } catch (_) { /* پاک شده → نسخهٔ تازه */ }
    }
    if (!done) {
      const sent = await u.send(payload).catch((e) => {
        console.warn(`⚠️ Ayene-ye parvande-ye ${c.number} be shaki ersal nashod (DM baste ast):`, e.message);
        return null;
      });
      if (sent) cases.setComplainantMirrorId(c, sent.id);
    }
    count += 1;
  }

  return count;
}

module.exports = { mirrorPayload, complainantPayload, mirrorTo, mirrorToVakils };
