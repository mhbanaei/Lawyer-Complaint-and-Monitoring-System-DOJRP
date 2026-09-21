'use strict';

/**
 * هندلر فرم چندمرحله‌ای شکایت:
 * - دریافت مودال هر مرحله و رفتن به مرحلهٔ بعد
 * - بازگشت به مرحلهٔ قبل (با حفظ داده‌ها)
 * - انتخاب وکیل (منو)
 * - پیش‌نمایش نهایی + تأیید و ارسال
 */

const {
  EmbedBuilder, ActionRowBuilder, ButtonStyle, MessageFlags,
} = require('discord.js');
const { modal, btn, vakilSelectMenu } = require('../ui');
const publisher = require('../services/casePublisher');
const STAGES = require('../commands/shekayat').STAGES;
const modalForStage = require('../commands/shekayat').modalForStage;
const drafts = require('../drafts');
const cases = require('../services/cases');
const vakils = require('../services/vakils');
const cfg = require('../config');
const jalali = require('../jalali');
const fa = require('../fa');
const embeds = require('../embeds');
const sessionsSvc = require('../services/sessions');

function stageAfter(stage) {
  const order = ['A', 'B', 'C', 'D', 'E'];
  return order[order.indexOf(stage) + 1] || null;
}

/**
 * صفحهٔ بین‌مرحله‌ای: چون discord.js اجازهٔ باز کردن مودال از داخل مودال دیگر
 * را نمی‌دهد، پس از هر مرحله یک تأیید با دکمهٔ «ادامه» نمایش داده می‌شود.
 */
function stepDone(interaction, stage) {
  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setDescription(`✅ بخش **${STAGES[stage].title}** با موفقیت ثبت شد.\nبرای رفتن به بخش بعدی، دکمهٔ «ادامه» را بزنید.`);
  return interaction.reply({
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(
      btn(`paradise:form:next:${stageAfter(stage)}`, '➡️ ادامه', ButtonStyle.Success),
      btn(`paradise:form:back:${stage}`, '✏️ ویرایش همین بخش', ButtonStyle.Secondary),
    )],
    flags: MessageFlags.Ephemeral,
  });
}

/** نمایش پیش‌نمایش نهایی پس از مرحلهٔ E */
function showPreview(interaction, draft) {
  const d = draft.data;
  const e = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('بسمه‌تعالی — پیش‌نمایش فرم ثبت شکایت / دادخواست')
    .setDescription('**به منظور پیگیری امور قضایی و حقوقی**\nدر صورت صحت اطلاعات، دکمهٔ «تأیید و ارسال» را بزنید.')
    .addFields(
      { name: '👤 نام و نام خانوادگی', value: `${d.plaintiff_firstName} ${d.plaintiff_lastName}`, inline: true },
      { name: 'نام پدر', value: d.plaintiff_fatherName || '—', inline: true },
      { name: 'شناسه / کد ملی', value: d.plaintiff_nationalId || '—', inline: true },
      { name: 'شماره تماس', value: d.plaintiff_phone, inline: true },
      { name: 'شغل / سمت', value: d.plaintiff_job || '—', inline: true },
      { name: 'وکیل / نمایندهٔ قانونی', value: draft.vakilName || 'انتخاب نشده', inline: true },
      { name: '⚠️ مشتکی‌عنه', value: `${d.def_firstName} ${d.def_lastName}`, inline: true },
      { name: '📌 موضوع شکایت', value: d.subject, inline: false },
      { name: '🕒 تاریخ و محل وقوع', value: `${d.occurredAt || '—'} — ${d.occurredPlace || '—'}`, inline: false },
      { name: '📝 شرح شکایت', value: clip(d.description), inline: false },
      { name: '🎯 خواسته', value: clip(d.demand), inline: false },
    )
    .setFooter({ text: `تاریخ ثبت: ${jalali.formatJalali(new Date())}` });

  const rows = [
    new ActionRowBuilder().addComponents(
      btn('paradise:form:submit', '✅ تأیید و ارسال', ButtonStyle.Success),
      btn('paradise:form:cancel', 'انصراف', ButtonStyle.Danger),
    ),
    new ActionRowBuilder().addComponents(
      btn('paradise:form:edit', '✏️ ویرایش اطلاعات', ButtonStyle.Secondary),
    ),
  ];
  return interaction.reply({ embeds: [e], components: rows, flags: MessageFlags.Ephemeral });
}

function clip(t, max = 1000) {
  const s = String(t || '').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** انتشار پرونده در کانال شکایات + پیام خصوصی به شاکی */
async function publishCase(interaction, draft) {
  let rec;
  try {
    rec = await publisher.publishCase(interaction.client, {
      complainantId: interaction.user.id,
      form: draft.data,
      vakilId: draft.vakilId,
    });
  } catch (e) {
    return interaction.update({
      content: `⛔ انتشار پرونده ناموفق بود: ${e.message}`,
      embeds: [], components: [],
    });
  }

  drafts.remove(interaction.user.id);

  return interaction.update({
    content: `✅ **درخواست شما ثبت شد.** شمارهٔ ثبت: **${fa.digits(rec.number)}**\n`
      + '⏳ تا تعیین وقت دادگاه از طرف قاضی شکیبا باشید. در صورت تعیین وقت، از طریق پیام خصوصی اطلاع داده می‌شود.',
    embeds: [], components: [],
  });
}

module.exports = {
  /** @param {ModalSubmitInteraction} interaction */
  async onModal(interaction) {
    const stage = interaction.customId.split(':').pop();
    const stageDef = STAGES[stage];
    if (!stageDef) return;

    const fields = {};
    for (const f of stageDef.fields) fields[f.id] = interaction.fields.getTextInputValue(f.id)?.trim() || '';
    const draft = drafts.update(interaction.user.id, stage, fields);

    const next = stageAfter(stage);
    if (next) {
      return stepDone(interaction, stage);
    }
    // مرحلهٔ E تمام شد → انتخاب وکیل
    const list = vakils.availableForCitizen();
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🧑‍⚖️ انتخاب وکیل / نمایندهٔ قانونی')
      .setDescription('وکیل موردنظر خود را از فهرست زیر انتخاب کنید. در صورت نداشتن وکیل، گزینهٔ «بدون وکیل» را انتخاب کنید.');

    const rows = [];
    if (list.length) rows.push(vakilSelectMenu(list));
    rows.push(new ActionRowBuilder().addComponents(
      btn('paradise:form:skipvakil', 'پردردن از انتخاب وکیل (بدون وکیل)', ButtonStyle.Secondary),
    ));

    return interaction.reply({ embeds: [embed], components: rows, flags: MessageFlags.Ephemeral });
  },

  /** دکمه‌ها و منوهای فرم @param {ButtonInteraction|SelectMenuInteraction} interaction */
  async onComponent(interaction) {
    const parts = interaction.customId.split(':'); // paradise:form:<action>[:extra]
    const action = parts[2];
    const draft = drafts.get(interaction.user.id);

    if (!draft && ['submit', 'edit', 'back', 'next'].includes(action)) {
      return interaction.reply({ content: '⌛ مهلت فرم منقضی شده است. دوباره /shekayat بزنید.', flags: MessageFlags.Ephemeral });
    }

    switch (action) {
      case 'vakil': { // منوی انتخاب وکیل
        const value = interaction.values[0];
        draft.vakilId = value.startsWith('vakil:') ? value.slice(6) : 'novakil';
        if (draft.vakilId !== 'novakil') {
          const v = vakils.findByDiscord(draft.vakilId);
          draft.vakilName = v ? `${v.firstName} ${v.lastName}` : null;
        } else {
          draft.vakilName = 'بدون وکیل';
        }
        return showPreview(interaction, draft);
      }
      case 'skipvakil':
        draft.vakilId = 'novakil';
        draft.vakilName = 'بدون وکیل';
        return showPreview(interaction, draft);
      case 'next': { // دکمهٔ ادامه → باز کردن مودال مرحلهٔ بعد (از روی دکمه مجاز است)
        const target = parts[3];
        if (!target || !STAGES[target]) {
          return interaction.reply({ content: '⛔ مرحلهٔ نامعتبر.', flags: MessageFlags.Ephemeral });
        }
        return interaction.showModal(modalForStage(target, draft.data));
      }
      case 'back': { // ویرایش یک بخش قبلی
        const target = parts[3] || draft.stage;
        if (!STAGES[target]) {
          return interaction.reply({ content: '⛔ مرحلهٔ نامعتبر.', flags: MessageFlags.Ephemeral });
        }
        return interaction.showModal(modalForStage(target, draft.data));
      }
      case 'edit': {
        drafts.touch(interaction.user.id, 'A');
        return interaction.showModal(modalForStage('A', draft.data));
      }
      case 'submit':
        return publishCase(interaction, draft);
      case 'cancel':
        drafts.remove(interaction.user.id);
        return interaction.update({ content: '❎ ثبت شکایت لغو شد.', embeds: [], components: [] });
      default:
        return interaction.reply({ content: '⛔ عملیات نامعتبر.', flags: MessageFlags.Ephemeral });
    }
  },
};
