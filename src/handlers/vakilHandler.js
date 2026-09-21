'use strict';

/**
 * پنل وکیل:
 * - پاسخ به پیشنهاد وکالت شاکی (در DM وکیلِ انتخابی): قبول / رد — مهلت ۱۲ ساعت (رد خودکار)
 * - پذیرش عمومی وکالت شاکی (پس از انقضای مهلت یا ردِ وکیلِ انتخابی)
 * - پذیرش وکالت مشتکی‌عنه (تا وقتی وکیل آن سمت پذیرفته مخفی می‌شود)
 * - مطالعهٔ پرونده: فقط وکیل پذیرنده (یا قاضی/معاونت)
 */

const { EmbedBuilder, MessageFlags } = require('discord.js');
const cases = require('../services/cases');
const vakils = require('../services/vakils');
const cfg = require('../config');
const fa = require('../fa');
const embeds = require('../embeds');
const sessionsSvc = require('../services/sessions');

function findVakilRec(user) {
  const v = vakils.findByDiscord(user.id);
  return vakils.termActive(v) ? v : null; // رکورد وکیل یا null — هرگز بولی!
}

/**
 * نام نمایشی وکیل — همیشه مستقیم از رجیستری /addvakil خوانده می‌شود
 * تا اگر نام ذخیره‌شده در پرونده خراب بود (مثل «undefined undefined»)، نام درست جایگزین شود
 */
function displayNameOf(discordId, fallback) {
  const v = vakils.findByDiscord(discordId);
  if (v && v.firstName && v.lastName) return `${v.firstName} ${v.lastName}`;
  if (fallback && !String(fallback).includes('undefined')) return fallback;
  return `کاربر <@${discordId}>`;
}

function isStaff(member) {
  return cases.isJudge(member, cfg.roles) || cases.isDeputy(member, cfg.roles);
}

/** ویرایش پیام DM پیشنهاد برای غیرفعال‌کردن دکمه‌ها */
async function closeDmButtons(client, pending, note) {
  if (!pending || !pending.dmMessageId) return;
  try {
    const dm = await client.users.createDM(pending.discordId);
    const m = await dm.messages.fetch(pending.dmMessageId);
    await m.edit({
      content: note || undefined,
      components: [],
    });
  } catch (_) { /* DM ممکن است پاک شده باشد */ }
}

/** ردیف دکمه‌های تأیید/رد در DM شاکی */
function confirmRow(caseNumber) {
  const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`paradise:vakil:confirm:accept:${caseNumber}`).setLabel('✅ این وکیل را می‌پذیرم').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`paradise:vakil:confirm:reject:${caseNumber}`).setLabel('❌ نمی‌پذیرم').setStyle(ButtonStyle.Danger),
  );
}

/** منوی انتخاب مجدد وکیل برای شاکی (در DM) */
function repickRow(caseNumber, vakilList) {
  const { ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
  const opts = vakilList.slice(0, 24).map((v) => ({
    label: `${v.firstName} ${v.lastName}`.slice(0, 100),
    description: `پرونده‌های قبول‌شده: ${v.acceptedCases || 0} | 🏆 ${v.wins || 0} | 📉 ${v.losses || 0}`.slice(0, 100),
    value: v.discordId,
  }));
  if (!opts.length) {
    opts.push({ label: 'وکیل قابل انتخابی نیست', description: 'همهٔ وکلا رد شده‌اند یا درخواست در جریان است', value: 'none', default: false });
  }
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`paradise:vakil:repick:${caseNumber}`)
      .setPlaceholder('وکیل دیگری برای پروندهٔ خود انتخاب کنید')
      .addOptions(opts),
  );
}

/** خط آمار وکیل برای نمایش به شاکی */
function vakilStatsLine(discordId) {
  const v = vakils.findByDiscord(discordId);
  if (!v) return '—';
  const phone = v.phone ? ` | 📞 تماس: ${fa.digits(String(v.phone))}` : '';
  return `${fa.num(v.acceptedCases || 0)} پرونده قبول‌شده | 🏆 ${fa.num(v.wins || 0)} برد | 📉 ${fa.num(v.losses || 0)} باخت${phone}`;
}

/** ارسال DM تأیید به شاکی و ذخیرهٔ شناسهٔ پیام */
async function sendConfirmDm(client, c, pending) {
  const complainant = await client.users.fetch(c.complainantId).catch((e) => {
    console.warn(`⚠️ کاربر شاکی (${c.complainantId}) برای DM تأیید وکیل یافت نشد:`, e.message);
    return null;
  });
  if (!complainant) return;
  const dm = await complainant.send({
    content: sessionsSvc.vakilAcceptedDM(c, displayNameOf(pending.discordId, pending.name), vakilStatsLine(pending.discordId)),
    components: [confirmRow(c.number)],
  }).then((m) => { console.log(`📨 DM تأیید وکیل (${pending.name}) با دکمه‌های قبول/رد به شاکی پروندهٔ ${c.number} ارسال شد.`); return m; })
    .catch((e) => { console.warn('⚠️ DM تأیید وکیل به شاکی ارسال نشد (احتمالاً DM کاربر بسته است):', e.message); return null; });
  if (dm) {
    if (c.pendingVakil) {
      c.pendingVakil.confirmDmMessageId = dm.id;
      c.pendingVakil.confirmExpiresAt = Date.now() + (cases.REQUEST_HOURS * 3600000);
    }
    cases.save();
  }
}

/** DM «انتخاب وکیل دیگر» به شاکی پس از رد/انقضا — همراه با علت */
async function sendRepickDm(client, c, headLine) {
  const complainant = await client.users.fetch(c.complainantId).catch(() => null);
  if (!complainant) return;
  const list = cases.listAvailablePlaintiffVakils(c, vakils.availableForCitizen());
  await complainant.send({
    content: `${headLine || `🔄 وکیلِ پروندهٔ ${fa.digits(c.number)} تأیید نشد.`}\nاگر مایلید از فهرست زیر وکیل دیگری انتخاب کنید؛ پس از انتخاب، درخواست برای او ارسال می‌شود (و تأیید شما برای ثبتش لازم است).`,
    components: [repickRow(c.number, list)],
  }).catch((e) => console.warn('⚠️ DM انتخاب مجدد وکیل ارسال نشد:', e.message));
}

/** بستن دکمه‌های DM تأیید شاکی پس از پاسخ/انقضا */
async function closeConfirmDm(client, complainantId, pending, note) {
  if (!pending || !pending.confirmDmMessageId) return;
  try {
    const dm = await client.users.createDM(await client.users.fetch(complainantId));
    const m = await dm.messages.fetch(pending.confirmDmMessageId);
    await m.edit({ content: note || undefined, components: [] });
  } catch (_) { /* DM ممکن است بسته یا پاک شده باشد */ }
}

/** پذیرش سمتِ مشخص + اطلاع‌رسانی‌ها — در صورت موفقیت رکورد وکیل برمی‌گرداند */
async function doAcceptSide(interaction, c, side, rec) {
  const name = rec ? `${rec.firstName} ${rec.lastName}` : `کاربر <@${interaction.user.id}>`;

  // سمت شاکی: هرگز مستقیم ثبت نمی‌شود — درخواستِ خودِ وکیل مستقیم وارد مرحلهٔ تأیید شاکی می‌شود
  if (side === 'plaintiff') {
    const p = cases.setPendingVakilAwaitingConfirm(c, { discordId: interaction.user.id, name, phone: rec ? rec.phone : null });
    if (!p) return false;
    // DM تأیید مستقیماً برای شاکی می‌رود (دو دکمهٔ تأیید/رد + سوابق وکیل)
    await sendConfirmDm(interaction.client, c, p);
    await require('./judgeHandler').refreshCaseMessage(interaction.client, c);
    return { name, pending: true };
  }

  // سمت مشتکی‌عنه: مستقیم ثبت می‌شود (شماره تماس از رجیستری /addvakil)
  const ok = cases.acceptSideVakil(c, { discordId: interaction.user.id, name, phone: rec ? rec.phone : null, side });
  if (!ok) return false;
  if (rec) vakils.statInc(rec.discordId, 'acceptedCases');

  const vakilUser = await interaction.client.users.fetch(interaction.user.id).catch(() => null);
  if (vakilUser) await vakilUser.send(sessionsSvc.defendantVakilAcceptedDM(c, name)).catch((e) => console.warn('⚠️ DM پذیرش وکالت مشتکی‌عنه ارسال نشد:', e.message));

  await require('./judgeHandler').refreshCaseMessage(interaction.client, c);
  return { name };
}

module.exports = {
  /**
   * پاسخ وکیلِ انتخابی به پیشنهاد وکالت (دکمه‌های DM) + پنل وکیل روی پیام پرونده
   * @param {ButtonInteraction} interaction
   */
  async onComponent(interaction) {
    const parts = interaction.customId.split(':'); // paradise:vakil:<action>[:side|verb][:num]
    const action = parts[2];

    // ---------- پاسخ به پیشنهاد وکالت (داخل DM وکیل) ----------
    if (action === 'respond') {
      const verb = parts[3]; // accept | reject
      const c = cases.findByNumber(Number(parts[4]));

      if (!c || !c.pendingVakil) {
        return interaction.update({ content: '⛔ این پیشنهاد دیگر معتبر نیست (قبلاً پاسخ داده شده یا منقضی شده است).', components: [] }).catch(() => {});
      }
      if (c.pendingVakil.discordId !== interaction.user.id) {
        return interaction.reply({ content: '⛔ این پیشنهاد فقط برای وکیلِ انتخابیِ پرونده قابل پاسخ است.', flags: MessageFlags.Ephemeral }).catch(() => {});
      }
      if (Date.now() > c.pendingVakil.expiresAt) {
        cases.respondPending(c, 'expired');
        await closeDmButtons(interaction.client, { discordId: interaction.user.id, dmMessageId: interaction.message.id }, '⌛ مهلت ۱۲ ساعته پاسخ منقضی شده بود — وکالت به‌صورت خودکار رد شد.');
        await require('./judgeHandler').refreshCaseMessage(interaction.client, c);
        return interaction.update({ content: '⌛ مهلت ۱۲ ساعته گذشته بود — پیشنهاد به‌صورت خودکار رد شد.', components: [] });
      }

      const pending = { ...c.pendingVakil };

      // ---------- وکیل پیشنهاد را پذیرفت → منتظر تأیید شاکی ----------
      if (verb === 'accept') {
        const p = cases.acceptPendingByVakil(c);
        if (!p) {
          return interaction.update({ content: '⛔ این پیشنهاد دیگر معتبر نیست.', components: [] }).catch(() => {});
        }
        await sendConfirmDm(interaction.client, c, p);
        await require('./judgeHandler').refreshCaseMessage(interaction.client, c);
        return interaction.update({
          content: `✅ وکالت پروندهٔ ${fa.digits(c.number)} را پذیرفتید.\n⏳ اکنون **شاکی** باید شما را تأیید کند (مهلت ۱۲ ساعته). پس از تأیید، پیام اطلاع‌رسانی دریافت می‌کنید.`,
          components: [],
        });
      }

      // ---------- وکیل پیشنهاد را رد کرد ----------
      if (verb === 'reject') {
        cases.respondPending(c, 'rejected');
        await require('./judgeHandler').refreshCaseMessage(interaction.client, c);
        await sendRepickDm(interaction.client, c,
          `❌ وکیلِ انتخابی شما (**${pending.name}**) وکالت پروندهٔ ${fa.digits(c.number)} را **رد کرد**.\n💡 در فهرست زیر می‌توانید وکیل دیگری انتخاب کنید تا درخواست برای او ارسال شود.`);
        return interaction.update({
          content: `❌ وکالت پروندهٔ ${fa.digits(c.number)} را رد کردید. پیشنهاد برای سایر وکلا باز شد.`,
          components: [],
        });
      }

      return interaction.update({ content: '⛔ عملیات نامعتبر.', components: [] }).catch(() => {});
    }

    // ---------- تأیید/رد شاکی (داخل DM شاکی) ----------
    if (action === 'confirm') {
      const verb = parts[3]; // accept | reject
      const c = cases.findByNumber(Number(parts[4]));

      if (!c || !c.pendingVakil || c.pendingVakil.status !== 'awaiting_confirm') {
        return interaction.update({ content: '⛔ این درخواست تأیید دیگر معتبر نیست (پاسخ داده شده یا منقضی شده است).', components: [] }).catch(() => {});
      }
      if (c.complainantId !== interaction.user.id) {
        return interaction.reply({ content: '⛔ فقط **شاکی** این پرونده می‌تواند وکیل را تأیید کند.', flags: MessageFlags.Ephemeral }).catch(() => {});
      }

      const pending = { ...c.pendingVakil };
      pending.name = displayNameOf(pending.discordId, pending.name); // نام سالم از رجیستری
      c.pendingVakil.name = pending.name; // تا در ثبت نهایی هم نام سالم ذخیره شود

      if (verb === 'accept') {
        cases.confirmPendingByPlaintiff(c);
        vakils.statInc(pending.discordId, 'acceptedCases');

        // DM به وکیل تأییدشده
        const vakilUser = await interaction.client.users.fetch(pending.discordId).catch(() => null);
        if (vakilUser) await vakilUser.send(sessionsSvc.vakilConfirmedByPlaintiffDM(c, pending.name)).catch((e) => console.warn('⚠️ DM تأیید وکالت به وکیل ارسال نشد:', e.message));

        await closeConfirmDm(interaction.client, c.complainantId, pending, '✅ وکیل تأیید شد.');
        await require('./judgeHandler').refreshCaseMessage(interaction.client, c);
        return interaction.update({
          content: `✅ **${pending.name}** به‌عنوان وکیل شما در پروندهٔ ${fa.digits(c.number)} ثبت شد.`,
          components: [],
        });
      }

      if (verb === 'reject') {
        cases.rejectPendingByPlaintiff(c);

        // DM به وکیل ردشده
        const vakilUser = await interaction.client.users.fetch(pending.discordId).catch(() => null);
        if (vakilUser) await vakilUser.send(sessionsSvc.vakilRejectedByPlaintiffDM(c, pending.name)).catch((e) => console.warn('⚠️ DM رد وکالت به وکیل ارسال نشد:', e.message));

        await closeConfirmDm(interaction.client, c.complainantId, pending, '❌ این وکیل را نپذیرفتید.');
        await require('./judgeHandler').refreshCaseMessage(interaction.client, c);
        await sendRepickDm(interaction.client, c,
          `❌ شما درخواست وکالت **${pending.name}** را رد کردید — دیگر نمی‌تواند برای همین پرونده درخواست دهد.\n💡 در DM بعدی می‌توانید وکیل دیگری انتخاب کنید؛ سایر وکلا هم می‌توانند درخواست بدهند.`);
        return interaction.update({
          content: `❌ درخواست **${pending.name}** را رد کردید. در DM بعدی می‌توانید وکیل دیگری انتخاب کنید؛ سایر وکلا هم می‌توانند درخواست بدهند.`,
          components: [],
        });
      }

      return interaction.update({ content: '⛔ عملیات نامعتبر.', components: [] }).catch(() => {});
    }

    // ---------- پنل وکیل روی پیام پرونده ----------
    const msgId = interaction.message.id;
    const customNum = Number(parts[3]) || Number(parts[4]);
    const c = cases.caseByMessage(msgId)
      || cases.all().find((x) => x.messageId === msgId)
      || (Number.isFinite(customNum) && customNum > 0 ? cases.findByNumber(customNum) : null);

    if (!c) return interaction.reply({ content: '⛔ این پیام به پرونده‌ای متصل نیست.', flags: MessageFlags.Ephemeral });

    // ---------- منوی انتخاب مجدد وکیل (فقط شاکی، در DM) ----------
    if (action === 'repick') {
      const c2 = cases.findByNumber(Number(parts[3]));
      if (!c2) return interaction.update({ content: '⛔ این پرونده دیگر معتبر نیست.', components: [] }).catch(() => {});
      if (c2.complainantId !== interaction.user.id) {
        return interaction.reply({ content: '⛔ فقط **شاکی** می‌تواند وکیل پرونده را انتخاب کند.', flags: MessageFlags.Ephemeral }).catch(() => {});
      }
      const picked = interaction.values[0];
      if (picked === 'none') return interaction.deferUpdate().catch(() => {});
      if (!cases.requestPlaintiffVakilByCitizen(c2, (function () {
        const v = vakils.findByDiscord(picked);
        return v ? { discordId: v.discordId, name: `${v.firstName} ${v.lastName}`, origin: 'citizen_pick' } : null;
      })() || {})) {
        return interaction.update({ content: '⛔ این انتخاب ممکن نیست (وکیل مسدود است یا درخواست دیگری در جریان است).', components: [] }).catch(() => {});
      }
      const v = vakils.findByDiscord(picked);
      if (v && vakils.termActive(v)) {
        const vu = await interaction.client.users.fetch(v.discordId).catch(() => null);
        if (vu) {
          const { publishDmForPending } = require('../services/casePublisher');
          await publishDmForPending(interaction.client, c2);
        }
      }
      await require('./judgeHandler').refreshCaseMessage(interaction.client, c2);
      return interaction.update({
        content: `📨 درخواست وکالت برای **${c2.pendingVakil ? c2.pendingVakil.name : picked}** ارسال شد؛ پس از پاسخ وکیل، تأیید شما برای ثبت نهایی لازم است.`,
        components: [],
      });
    }

    // نقش وکیل: کاربر باید در فهرست وکلای فعال باشد
    const rec = findVakilRec(interaction.user);
    const staff = isStaff(interaction.member);

    if (!rec && !staff) {
      return interaction.reply({
        content: '⛔ شما در فهرست وکلای فعال نیستید. برای وکالت با معاونت قضایی تماس بگیرید.',
        flags: MessageFlags.Ephemeral,
      });
    }

    switch (action) {
      case 'read': {
        // قاعده: فقط وکیل پذیرنده + قاضی/معاونت می‌توانند متن را ببینند
        if (!staff && !cases.isAcceptedVakil(interaction.user, c)) {
          return interaction.reply({
            content: '⛔ شما وکیلِ پذیرندهٔ این پرونده نیستید. برای مطالعه، ابتدا وکالت یکی از طرفین را بپذیرید.',
            flags: MessageFlags.Ephemeral,
          });
        }
        const e = embeds.caseEmbed(c, { full: true }); // قاضی/معاونت/وکیل پذیرنده: متن کامل
        return interaction.reply({ embeds: [e], flags: MessageFlags.Ephemeral });
      }

      case 'accept': {
        const side = parts[3] === 'defendant' ? 'defendant' : 'plaintiff';
        if (c.status === 'closed') {
          return interaction.reply({ content: '⛔ این پرونده با صدور رأی نهایی بسته شده است.', flags: MessageFlags.Ephemeral });
        }
        const taken = side === 'defendant' ? c.defendantVakil : c.plaintiffVakil;
        if (taken) {
          return interaction.reply({
            content: `⛔ وکالت ${side === 'plaintiff' ? '**شاکی**' : '**مشتکی‌عنه**'} قبلاً توسط **${taken.name}** پذیرفته شده است.`,
            flags: MessageFlags.Ephemeral,
          });
        }
        if (side === 'plaintiff' && c.pendingVakil) {
          const st = c.pendingVakil.status;
          return interaction.reply({
            content: st === 'awaiting_confirm'
              ? `⏳ **${c.pendingVakil.name}** وکالت را پذیرفته و اکنون در انتظار تأیید شاکی است (مهلت ۱۲ ساعته).`
              : `⏳ درخواست وکالت برای **${c.pendingVakil.name}** در جریان است (مهلت ۱۲ ساعته).`,
            flags: MessageFlags.Ephemeral,
          });
        }
        if (side === 'plaintiff' && (c.rejectedVakils || []).includes(interaction.user.id)) {
          return interaction.reply({
            content: '⛔ درخواست وکالت شما در این پرونده قبلاً از سوی شاکی رد شده و امکان درخواست مجدد ندارید.',
            flags: MessageFlags.Ephemeral,
          });
        }
        if (c.complainantId === interaction.user.id) {
          return interaction.reply({ content: '⛔ شاکی نمی‌تواند وکیل خود باشد.', flags: MessageFlags.Ephemeral });
        }

        const res = await doAcceptSide(interaction, c, side, rec);
        if (!res) {
          return interaction.reply({ content: '⛔ وکالت قبلاً پذیرفته شده است.', flags: MessageFlags.Ephemeral });
        }

        return interaction.reply({
          content: side === 'plaintiff'
            ? `✅ درخواست وکالت شما ثبت شد — **${res.name}**.\n⏳ اکنون **شاکی** باید شما را تأیید کند؛ پس از تأیید، وکیل رسمی پرونده می‌شوید.`
            : `✅ وکالت **مشتکی‌عنه** توسط **${res.name}** پذیرفته شد.\n📌 توجه: ممکن است وکیل دیگری نیز به انتخاب مشتکی‌عنه اضافه شود؛ مسئولیت پرونده با شماست.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      default:
        return interaction.reply({ content: '⛔ عملیات نامعتبر.', flags: MessageFlags.Ephemeral });
    }
  },

  /**
   * رد خودکار پیشنهادهای ۱۲ ساعتهٔ منقضی‌شده:
   * پاک‌کردن pending، بستن دکمه‌های DM و بازکردن دکمهٔ پذیرش در پیام پرونده
   */
  async sweepPendingRequests(client) {
    const swept = cases.sweepExpiredPending();
    for (const { case: c, pending, kind } of swept) {
      console.log(`⌛ پیشنهاد وکالت پروندهٔ ${c.number} (${pending.name}) منقضی شد — ${kind === 'confirm_expired' ? 'تأیید شاکی نیامد' : 'پاسخ وکیل نیامد'}.`);
      if (kind === 'confirm_expired') {
        // شاکی تأیید نکرد → وکیل از سمت شاکی مسدود و گزینه برای بقیه باز می‌شود
        await closeConfirmDm(client, c.complainantId, pending, '⌛ مهلت ۱۲ ساعته تأیید به پایان رسید — درخواست به‌صورت خودکار رد شد.');
      } else {
        await closeDmButtons(client, pending, '⌛ مهلت ۱۲ ساعته پاسخ به پایان رسید — وکالت به‌صورت خودکار رد شد.');
      }
      await sendRepickDm(client, c, kind === 'confirm_expired'
        ? `⌛ مهلت ۱۲ ساعتهٔ تأیید وکیلِ **${pending.name}** به پایان رسید و درخواست خودکار رد شد (وکیل مسدود نشده و می‌تواند دوباره درخواست دهد).\n💡 می‌توانید از فهرست زیر وکیل دیگری انتخاب کنید.`
        : `⌛ وکیلِ انتخابی شما (**${pending.name}**) در مهلت ۱۲ ساعته به پیشنهاد وکالت پاسخ نداد و درخواست خودکار رد شد.\n💡 در فهرست زیر می‌توانید وکیل دیگری انتخاب کنید.`);
      await require('./judgeHandler').refreshCaseMessage(client, c);
    }
    return swept.length;
  },
};
