'use strict';

/**
 * پنل قاضی:
 * - «تنظیم قرار دادگاه»: انتخاب خصوصی/عمومی → منوی روز → منوی ساعت → انتشار اطلاعیه
 * - «اخذ رأی پایانی»: انتخاب نتیجه → مودال متن رأی → ویرایش پیام پرونده به شکل رأی نهایی
 */

const {ActionRowBuilder, StringSelectMenuBuilder, MessageFlags } = require('discord.js');
const cases = require('../services/cases');
const vakils = require('../services/vakils');
const cfg = require('../config');
const fa = require('../fa');
const jalali = require('../jalali');
const embeds = require('../embeds');
const sessionsSvc = require('../services/sessions');
const { btn, modal } = require('../ui');

// ---------- منوی نوع جلسه ----------
function sessionTypeRow(caseNumber) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`paradise:judge:type:${caseNumber}`)
      .setPlaceholder('نوع جلسهٔ دادگاه را انتخاب کنید')
      .addOptions(
        { label: 'جلسهٔ خصوصی', description: 'رسیدگی محدود به طرفین و وکلای آن‌ها', value: 'private', emoji: '🔒' },
        { label: 'جلسهٔ عمومی', description: 'حضور شنوندگان مجاز است', value: 'public', emoji: '📢' },
      ),
  );
}

// ---------- منوی روز (۷ روز آینده با تاریخ شمسی) ----------
function dayMenuRow(caseNumber) {
  const opts = [];
  for (let i = 0; i < 7; i += 1) {
    const date = new Date(Date.now() + i * 86400000);
    opts.push({
      label: i === 0 ? 'امروز' : jalali.WEEKDAY_NAMES[date.getUTCDay()],
      description: jalali.formatJalali(date),
      value: `d${i}`,
    });
  }
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`paradise:judge:day:${caseNumber}`)
      .setPlaceholder('روز جلسه را انتخاب کنید')
      .addOptions(opts),
  );
}

// ---------- منوی ساعت (با روزِ انتخاب‌شده در شناسه) ----------
function hourMenuRow(caseNumber, dayOffset) {
  const opts = [];
  for (let h = cfg.sessionHourStart; h <= cfg.sessionHourEnd; h += 1) {
    opts.push({ label: `${fa.digits(String(h).padStart(2, '0'))}:۰۰`, value: String(h) });
  }
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`paradise:judge:hour:${caseNumber}:${dayOffset}`)
      .setPlaceholder('ساعت جلسه را انتخاب کنید')
      .addOptions(opts),
  );
}

function dayOffsetToJalali(offset) {
  const date = new Date(Date.now() + offset * 86400000);
  const j = jalali.dateToJalali(date);
  return [j.jy, j.jm, j.jd];
}

/** ثبت نهایی وقت جلسه و انتشار اطلاعیه در کانال جلسات */
async function commitSession(interaction, c, type, dayOffset, hour) {
  const at = jalali.jalaliToDate(...dayOffsetToJalali(dayOffset), hour, 0);
  const atText = `${jalali.jalaliWeekday(at)} ${jalali.formatJalaliDateTime(at)}`;

  cases.setSession(c, { type, at: at.getTime(), atText, judgeId: interaction.user.id });

  // ارسال اطلاعیه به کانال جلسات
  const ch = await interaction.client.channels.fetch(cfg.channels.sessions).catch(() => null);
  if (ch) {
    const embed = embeds.sessionAnnouncementEmbed(c);
    const msg = await ch.send({
      content: `<@${c.complainantId}> 🏛️ وقت رسیدگی پروندهٔ شمارهٔ ${fa.digits(c.number)} تعیین شد.`,
      embeds: [embed],
    });
    cases.setAnnouncementMsg(c, msg.id);
  }

  // DM جلسه به وکلای پذیرفته‌شده: وقت دادگاه + رونوشت کامل پرونده (شناسهٔ رونوشت ذخیره می‌شود تا پس از رأی ویرایش شود)
  const copy = sessionsSvc.caseCopyDM(c, { head: '🏛️ وقت دادگاه این پرونده تعیین شد.' });
  for (const [role, v] of [['plaintiffVakil', c.plaintiffVakil], ['defendantVakil', c.defendantVakil]]) {
    if (!v) continue;
    const vu = await interaction.client.users.fetch(v.discordId).catch(() => null);
    if (vu) {
      await vu.send(sessionsSvc.vakilSessionDM(c, v.name)).catch((e) => console.warn(`⚠️ DM jalase be vakil ${v.discordId} ersal nashod:`, e.message));
      const sent = await vu.send({ content: copy.content, embeds: [copy.embed] }).catch((e) => { console.warn(`⚠️ Roonevesht parvande be vakil ${v.discordId} ersal nashod:`, e.message); return null; });
      if (sent) cases.setCopyMsgIds(c, role, sent.id);
    }
  }

  // پیام خصوصی به شاکی: وقت دادگاه تعیین شد + رونوشت کامل پرونده
  const complainant = await interaction.client.users.fetch(c.complainantId).catch(() => null);
  if (complainant) {
    await complainant.send(sessionsSvc.sessionScheduledDM(c))
      .catch((e) => console.warn(`⚠️ DM taein-e vaght be shaki ersal nashod (${c.complainantId}):`, e.message));
    const sent = await complainant.send({ content: copy.content, embeds: [copy.embed] })
      .catch((e) => { console.warn(`⚠️ Roonevesht parvande be shaki ersal nashod (${c.complainantId}):`, e.message); return null; });
    if (sent) cases.setCopyMsgIds(c, 'complainant', sent.id);
  } else {
    console.warn(`⚠️ Shakie parvande-ye ${c.number} dar Discord peyda nashod:`, c.complainantId);
  }

  // به‌روزرسانی پیام پرونده در کانال شکایات
  await refreshCaseMessage(interaction.client, c);

  // نتیجه در خودِ پیام پرونده ویرایش می‌شود؛ اینجا فقط تأیید کوتاه
  return interaction.update({
    content: '✅ وقت دادگاه ثبت شد — پیام پرونده در کانال شکایات به‌روزرسانی گردید.',
    embeds: [], components: [],
  });
}

/** بازسازی و ویرایش پیام پرونده در کانال شکایات */
async function refreshCaseMessage(client, c) {
  if (!c.messageId) return null;
  const ch = await client.channels.fetch(cfg.channels.complaints).catch(() => null);
  if (!ch) return null;
  const msg = await ch.messages.fetch(c.messageId).catch(() => null);
  if (!msg) return null;  if (c.status === 'closed') {
    const out = await msg.edit({
      content: `بسمه‌تعالی\n⚖️ **رأی نهایی پروندهٔ شمارهٔ ${fa.digits(c.number)}**`,
      embeds: [embeds.finalRulingEmbed(c)],
      components: [],
    });
    // آینهٔ DM وکلا هم به شکل رأی نهایی ویرایش می‌شود (دکمه‌ها حذف)
    await require('../services/mirror').mirrorToVakils(client, c).catch((e) => console.warn('⚠️ Hamsaz-sazi ayene-ye DM vakilha namovafagh:', e.message));
    return out;
  }
  const sessionLine = c.session
    ? `\n🏛️ وقت دادگاه: **${c.session.atText}** — ${c.session.type === 'private' ? '🔒 جلسهٔ خصوصی' : '📢 جلسهٔ عمومی'}`
    : '';
  const out = await msg.edit({
    content: `📋 **پروندهٔ شکایت — شمارهٔ ثبت: ${fa.digits(c.number)}**${sessionLine}`,
    embeds: [embeds.caseEmbed(c)],
    components: [require('../ui').judgePanelRow(c.number, c), require('../ui').vakilPanelRow(c)],
  });
  // آینهٔ DM وکلا — همان محتوا و همان دکمه‌ها، همگام با کانال
  await require('../services/mirror').mirrorToVakils(client, c).catch((e) => console.warn('⚠️ Hamsaz-sazi ayene-ye DM vakilha namovafagh:', e.message));
  return out;
}

// ---------- رأی نهایی ----------
function outcomeRow(caseNumber) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`paradise:judge:outcome:${caseNumber}`)
      .setPlaceholder('نتیجهٔ پرونده را انتخاب کنید')
      .addOptions(
        { label: 'پرونده به نفع شاکی ختم شد', value: 'plaintiff', emoji: '✅' },
        { label: 'پرونده به نفع متشاکی(شکایت‌شده) ختم شد', value: 'defendant', emoji: '❌' },
        { label: 'پرونده مختومه شد — بدون نفع برای هیچ‌یک از طرفین', value: 'dismissed', emoji: '⚖️' },
      ),
  );
}

function rulingTextModal(caseNumber) {
  return modal(`paradise:judge:rule:modal:${caseNumber}`, 'متن رأی نهایی قاضی', [
    { id: 'ruling', label: 'رأی نهایی', required: true, max: 3000, paragraph: true },
  ]);
}

/**
 * ویرایش پیام رونوشت DM به شکل رأی نهایی — همان پیامی که هنگام تعیین وقت ارسال شده بود
 * اگر پیام پیدا نشد (پاک شده باشد)، رونوشت تازه ارسال می‌شود تا گیرنده بی‌نصیب نماند
 */
async function editCopyMessage(client, c, role, user, copy) {
  const msgId = c.copyMessages && c.copyMessages[role];
  if (msgId) {
    const dm = await user.createDM().catch(() => null);
    if (dm) {
      const msg = await dm.messages.fetch(msgId).catch(() => null);
      if (msg) {
        await msg.edit({ content: copy.content, embeds: [copy.embed] })
          .catch((e) => console.warn(`⚠️ Virayesh roonevesht-e ray (${role}) namovafagh:`, e.message));
        return;
      }
    }
  }
  // پیام اصلی پیدا نشد → رونوشت تازه می‌فرستیم
  await user.send({ content: copy.content, embeds: [copy.embed] })
    .catch((e) => console.warn(`⚠️ Ersal roonevesht-e ray (${role}) namovafagh:`, e.message));
}

/** بستن پرونده با رأی و به‌روزرسانی آمار وکلا */
async function commitRuling(interaction, c, outcome, text) {
  cases.closeWithRuling(c, { outcome, text, judgeId: interaction.user.id });

  // آمار برد/باخت هر دو وکیل بر اساس سمتِ وکالت
  const sides = [['plaintiff', c.plaintiffVakil], ['defendant', c.defendantVakil]];
  for (const [side, v] of sides) {
    if (v && outcome !== 'dismissed') {
      // پروندهٔ مختومه نه برد است نه باخت — شمار پرونده‌های قبول‌شدهٔ وکیل هنگام پذیرش ثبت شده است
      const won = side === 'plaintiff' ? outcome === 'plaintiff' : outcome === 'defendant';
      vakils.statInc(v.discordId, won ? 'wins' : 'losses');
    }
  }

  await refreshCaseMessage(interaction.client, c);

  // اطلاعیهٔ جلسه در کانال جلسات:
  // - جلسهٔ عمومی → همان پیام اعلامیه به شکل رأی نهایی ویرایش می‌شود (رأی در جلسهٔ عمومی علنی اعلام می‌شود)
  // - جلسهٔ خصوصی → اعلامیه دست‌نخورده می‌ماند (رأی در جلسهٔ خصوصی اعلام عمومی ندارد)
  if (c.session && c.session.type === 'public' && c.session.announcementMsgId) {
    const sCh = await interaction.client.channels.fetch(cfg.channels.sessions).catch(() => null);
    if (sCh) {
      const ann = await sCh.messages.fetch(c.session.announcementMsgId).catch(() => null);
      if (ann) {
        await ann.edit({
          content: `بسمه‌تعالی\n⚖️ **رأی نهایی پروندهٔ شمارهٔ ${fa.digits(c.number)}**`,
          embeds: [embeds.finalRulingEmbed(c)],
          components: [],
        }).catch((e) => console.warn('⚠️ Virayesh elamiye-ye jalase be soorate ray namovafagh:', e.message));
      }
    }
  }

  // DM نتیجه + ویرایش رونوشت‌های قبلی به شکل رأی نهایی (پیام جدید ارسال نمی‌شود)
  const copy = sessionsSvc.caseCopyDM(c, { asRuling: true });

  const complainant = await interaction.client.users.fetch(c.complainantId).catch(() => null);
  if (complainant) {
    await complainant.send(sessionsSvc.rulingDM(c)).catch(() => null);
    await editCopyMessage(interaction.client, c, 'complainant', complainant, copy);
  }

  for (const [role, v] of [['plaintiffVakil', c.plaintiffVakil], ['defendantVakil', c.defendantVakil]]) {
    if (!v) continue;
    const vu = await interaction.client.users.fetch(v.discordId).catch(() => null);
    if (vu) {
      await vu.send(sessionsSvc.rulingDM(c, { role: 'vakil', name: v.name })).catch(() => null);
      await editCopyMessage(interaction.client, c, role, vu, copy);
    }
  }

  // نتیجه در خودِ پیام پرونده (شکل رأی نهایی) ویرایش می‌شود؛ اینجا فقط تأیید کوتاه
  return interaction.update({
    content: '✅ رأی نهایی صادر شد — پیام پرونده به شکل رأی نهایی ویرایش و بسته شد.',
    embeds: [], components: [],
  });
}

module.exports = {
  /** دکمه‌ها و منوهای پنل قاضی */
  async onComponent(interaction) {
    const parts = interaction.customId.split(':'); // paradise:judge:<action>:<num>[:extra]
    const action = parts[2];
    const caseNumber = Number(parts[3]);
    // اول از شمارهٔ داخل شناسهٔ دکمه؛ اگر نبود (پیام‌های قدیمی) از روی ID پیام پرونده
    let c = Number.isFinite(caseNumber) && caseNumber > 0 ? cases.findByNumber(caseNumber) : null;
    if (!c) c = cases.caseByMessage(interaction.message.id);

    if (!c) return interaction.reply({ content: '⛔ پرونده یافت نشد.', flags: MessageFlags.Ephemeral });
    if (!cases.isJudge(interaction.member, cfg.roles)) {
      return interaction.reply({ content: '⛔ فقط **قاضی** به این بخش دسترسی دارد.', flags: MessageFlags.Ephemeral });
    }
    if (c.status === 'closed') {
      return interaction.reply({ content: '⛔ این پرونده بسته شده است.', flags: MessageFlags.Ephemeral });
    }

    switch (action) {
      case 'schedule':
        if (c.status !== 'registered') {
          return interaction.reply({ content: '⛔ وقت دادگاه این پرونده قبلاً تعیین شده است.', flags: MessageFlags.Ephemeral });
        }
        c._pendingType = null;
        return interaction.reply({
          content: `🏛️ **تنظیم قرار دادگاه — پروندهٔ ${fa.digits(c.number)}**\nنوع جلسه را انتخاب کنید:`,
          components: [sessionTypeRow(c.number)],
          flags: MessageFlags.Ephemeral,
        });

      case 'type': {
        const type = interaction.values[0] === 'private' ? 'private' : 'public';
        c._pendingType = type; // تا انتخاب روز و ساعت در حافظه می‌ماند
        return interaction.update({
          content: `نوع جلسه: **${type === 'private' ? 'خصوصی 🔒' : 'عمومی 📢'}**\nحالا **روز** جلسه را انتخاب کنید:`,
          components: [dayMenuRow(c.number)],
        });
      }

      case 'day': {
        const dayOffset = Number(interaction.values[0].slice(1));
        return interaction.update({
          content: 'روز انتخاب شد. حالا **ساعت** جلسه را تعیین کنید:',
          components: [hourMenuRow(c.number, dayOffset)],
        });
      }

      case 'hour': {
        const hour = Number(interaction.values[0]);
        const dayOffset = Number(parts[4] || 0);
        const type = c._pendingType === 'private' ? 'private' : 'public';
        return commitSession(interaction, c, type, dayOffset, hour);
      }

      case 'rule':
        c._pendingOutcome = null;
        return interaction.reply({
          content: '⚖️ **اخذ رأی پایانی**\nنتیجهٔ پرونده را انتخاب کنید:',
          components: [outcomeRow(c.number)],
          flags: MessageFlags.Ephemeral,
        });

      case 'outcome': {
        c._pendingOutcome = ['plaintiff', 'defendant', 'dismissed'].includes(interaction.values[0])
          ? interaction.values[0]
          : 'plaintiff';
        return interaction.showModal(rulingTextModal(c.number));
      }

      default:
        return interaction.reply({ content: '⛔ عملیات نامعتبر.', flags: MessageFlags.Ephemeral });
    }
  },

  /** مودال متن رأی */
  async onModal(interaction) {
    const parts = interaction.customId.split(':'); // paradise:judge:rule:modal:<num>
    const caseNumber = Number(parts[4]);
    const c = cases.findByNumber(caseNumber);
    if (!c) return interaction.reply({ content: '⛔ پرونده یافت نشد.', flags: MessageFlags.Ephemeral });
    if (!cases.isJudge(interaction.member, cfg.roles)) {
      return interaction.reply({ content: '⛔ فقط **قاضی** به این بخش دسترسی دارد.', flags: MessageFlags.Ephemeral });
    }
    if (!c._pendingOutcome) {
      return interaction.reply({ content: '⛔ ابتدا نتیجهٔ پرونده را از منوی «اخذ رأی پایانی» انتخاب کنید.', flags: MessageFlags.Ephemeral });
    }

    const text = interaction.fields.getTextInputValue('ruling')?.trim() || '—';
    const outcome = c._pendingOutcome;
    c._pendingOutcome = null;
    return commitRuling(interaction, c, outcome, text);
  },

  refreshCaseMessage,
};
