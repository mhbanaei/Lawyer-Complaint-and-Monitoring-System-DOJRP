'use strict';

/**
 * /announce — ارسال پیام خصوصی به همهٔ وکلای فعال (فقط معاونت قضایی)
 * 1) مودال: نوشتن متن اطلاعیه
 * 2) تأییدیه افی‌مرال با پیش‌نمایش متن + شمار گیرندگان
 * 3) دکمهٔ تأیید → DM به همهٔ وکلای فعال + گزارش موفق/ناموفق
 */

const { SlashCommandBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const cfg = require('../config');
const vakils = require('../services/vakils');
const fa = require('../fa');
const { modal } = require('../ui');

const MODAL_ID = 'paradise:announce:modal';
const CONFIRM_ID = 'paradise:announce:confirm';
const CANCEL_ID = 'paradise:announce:cancel';

/** متن اطلاعیهٔ در انتظار تأیید، به تفکیک کاربر معاونت (درون‌حافظه‌ای) */
const drafts = new Map(); // userId -> { text, at }
const DRAFT_TTL = 30 * 60 * 1000; // ۳۰ دقیقه

function draftGet(userId) {
  const d = drafts.get(userId);
  if (!d) return null;
  if (Date.now() - d.at > DRAFT_TTL) {
    drafts.delete(userId);
    return null;
  }
  return d;
}

function draftSet(userId, text) {
  drafts.set(userId, { text, at: Date.now() });
}

function draftDelete(userId) {
  drafts.delete(userId);
}

/** ردیف دکمه‌های تأیید/انصراف */
function confirmRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(CONFIRM_ID).setLabel(`📨 تأیید و ارسال به وکلا`).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(CANCEL_ID).setLabel('انصراف').setStyle(ButtonStyle.Danger),
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('announce')
    .setDescription('ارسال پیام خصوصی به همهٔ وکلای فعال (فقط معاونت قضایی)')
    .setDMPermission(false),

  async execute(interaction) {
    if (!interaction.member.roles.cache.has(cfg.roles.deputy)) {
      return interaction.reply({
        content: '⛔ این دستور فقط برای اعضای **معاونت قضایی** است.',
        flags: MessageFlags.Ephemeral,
      });
    }

    return interaction.showModal(modal(MODAL_ID, '📢 اطلاعیه به وکلا', [
      {
        id: 'text',
        label: 'متن اطلاعیه',
        required: true,
        min: 1,
        max: 2000,
        paragraph: true,
        placeholder: 'متن پیامی که برای همهٔ وکلا ارسال می‌شود...',
      },
    ]));
  },

  /** هندلر مودال (از index.js) */
  async onModal(interaction) {
    if (!interaction.member.roles.cache.has(cfg.roles.deputy)) {
      return interaction.reply({ content: '⛔ این دستور فقط برای اعضای **معاونت قضایی** است.', flags: MessageFlags.Ephemeral });
    }

    const text = interaction.fields.getTextInputValue('text').trim();
    const targets = vakils.activeVakils();

    if (!targets.length) {
      return interaction.reply({
        content: 'ℹ️ در حال حاضر **هیچ وکیل فعالی** ثبت نشده است — چیزی برای ارسال نیست.',
        flags: MessageFlags.Ephemeral,
      });
    }

    draftSet(interaction.user.id, text);

    await interaction.reply({
      content: [
        `📢 **اطلاعیه به ${fa.digits(targets.length)} وکیل فعال ارسال شود؟**`,
        '',
        '```',
        text.length > 900 ? `${text.slice(0, 900)}…` : text,
        '```',
        'فقط شما این پیام را می‌بینید. برای ارسال، دکمهٔ زیر را بزنید.',
      ].join('\n'),
      flags: MessageFlags.Ephemeral,
      components: [confirmRow()],
    });
  },

  /** هندلر دکمه‌های تأیید/انصراف (از index.js) */
  async onComponent(interaction) {
    if (!interaction.member.roles.cache.has(cfg.roles.deputy)) {
      return interaction.reply({ content: '⛔ این دستور فقط برای اعضای **معاونت قضایی** است.', flags: MessageFlags.Ephemeral });
    }

    if (interaction.customId === CANCEL_ID) {
      draftDelete(interaction.user.id);
      return interaction.update({ content: '❎ ارسال اطلاعیه لغو شد.', components: [] });
    }

    if (interaction.customId !== CONFIRM_ID) return;

    const draft = draftGet(interaction.user.id);
    if (!draft) {
      return interaction.update({
        content: '⌛ مهلت این پیش‌نویس منقضی شده است. دوباره /announce بزنید.',
        components: [],
      });
    }
    const message = draft.text;
    draftDelete(interaction.user.id);

    await interaction.update({ content: '⏳ در حال ارسال DM به وکلا...', components: [] });

    const targets = vakils.activeVakils();
    let okCount = 0;
    let failCount = 0;
    const failedNames = [];

    for (const v of targets) {
      // eslint-disable-next-line no-await-in-loop
      const u = await interaction.client.users.fetch(v.discordId).catch(() => null);
      if (!u) { failCount += 1; failedNames.push(`${v.firstName} ${v.lastName} (یافت نشد)`); continue; }
      // eslint-disable-next-line no-await-in-loop
      const sent = await u.send({ content: `📢 **اطلاعیه از معاونت قضایی**\n\n${message}` }).catch(() => null);
      if (sent) okCount += 1;
      else failCount += 1, failedNames.push(`${v.firstName} ${v.lastName} (DM بسته)`);
    }

    const lines = [
      `✅ **اطلاعیه ارسال شد** — ${fa.digits(okCount)} موفق، ${fa.digits(failCount)} ناموفق`,
    ];
    if (failedNames.length) {
      lines.push('', '⚠️ **ناموفق‌ها:**', failedNames.map((n) => `• ${n}`).join('\n'));
    }

    await interaction.editReply({ content: lines.join('\n'), components: [] }).catch(() => {});
  },
};
