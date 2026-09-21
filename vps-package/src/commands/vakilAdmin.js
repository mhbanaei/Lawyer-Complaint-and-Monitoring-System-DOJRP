'use strict';

/**
 * کامندهای مدیریتی وکلا — فقط نقش معاونت قضایی
 * /addvakil  → افزودن وکیل با یافتن بازیکن از players.json سرور
 * /removevakil → حذف وکیل با نام و نام خانوادگی
 */

const {SlashCommandBuilder, MessageFlags } = require('discord.js');
const cfg = require('../config');
const vakils = require('../services/vakils');
const players = require('../services/players');
const fa = require('../fa');

module.exports = [
  {
    data: new SlashCommandBuilder()
      .setName('addvakil')
      .setDescription('افزودن وکیل جدید (فقط معاونت قضایی)')
      .addUserOption((o) => o
        .setName('کاربر')
        .setDescription('کاربر دیسکورد که وکیل می‌شود')
        .setRequired(true))
      .addIntegerOption((o) => o
        .setName('مدت_روز')
        .setDescription('مدت دورهٔ وکالت به روز (مثلاً ۳۰)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(365))
      .addIntegerOption((o) => o
        .setName('شناسه_بازی')
        .setDescription('شناسهٔ درون‌بازی (gameId) کاربر در سرور')
        .setRequired(true))
      .addStringOption((o) => o
        .setName('شماره_تماس')
        .setDescription('شماره تماس وکیل (برای نمایش در /list)')
        .setRequired(true))
      .addStringOption((o) => o
        .setName('نام')
        .setDescription('نام وکیل (برای درج در پرونده‌ها)')
        .setRequired(true))
      .addStringOption((o) => o
        .setName('نام_خانوادگی')
        .setDescription('نام خانوادگی وکیل')
        .setRequired(true))
      .setDMPermission(false),

    async execute(interaction) {
      if (!interaction.member.roles.cache.has(cfg.roles.deputy)) {
        return interaction.reply({ content: '⛔ این دستور فقط برای اعضای **معاونت قضایی** است.', flags: MessageFlags.Ephemeral });
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const user = interaction.options.getUser('کاربر', true);
      const days = interaction.options.getInteger('مدت_روز', true);
      const gameId = interaction.options.getInteger('شناسه_بازی', true);
      const firstName = interaction.options.getString('نام', true).trim();
      const lastName = interaction.options.getString('نام_خانوادگی', true).trim();
      const phone = (interaction.options.getString('شماره_تماس') || '').trim();

      // عضویت سرور
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!member) {
        return interaction.editReply('⛔ کاربر موردنظر در سرور یافت نشد.');
      }

      // پیش از افزودن، دوره‌های منقضی را علامت بزن
      vakils.sweepExpired();

      // جلوگیری از ثبت هم‌نام
      const dup = vakils.findByName(firstName, lastName);
      if (dup && vakils.termActive(dup)) {
        return interaction.editReply(
          `⛔ وکیلی با نام **${firstName} ${lastName}** در حال حاضر فعال است (Discord: <@${dup.discordId}>).`,
        );
      }

      // یافتن بازیکن از سرور FiveM
      let player = null;
      try {
        player = await players.findByGameId(gameId);
      } catch (e) {
        return interaction.editReply(`⚠️ خطا در اتصال به سرور بازیکنان: ${e.message}\nدوباره تلاش کنید.`);
      }
      if (!player) {
        return interaction.editReply(
          `⛔ بازیکنی با شناسهٔ درون‌بازی **${gameId}** در سرور یافت نشد. باید بازیکن آنلاین باشد تا بتوان او را یافت.`,
        );
      }

      const rec = vakils.create({
        discordId: user.id,
        gameId,
        firstName,
        lastName,
        phone,
        // نام درون‌بازی ذخیره می‌شود تا تشخیص آنلاین بعد از DC و برگشتن (که id عوض می‌شود) بر اساس نام انجام شود
        inGameName: (player.name || `${firstName} ${lastName}`).trim(),
        days,
        identifiers: Array.isArray(player.identifiers) ? player.identifiers : [],
      });

      // اعطای نقش وکیل (اگر نقش جدا تعریف شده باشد — اختیاری)
      // در صورت نیاز نقش وکیل را در سرور بسازید و در اینجا اضافه کنید.

      return interaction.editReply(
        `✅ **${firstName} ${lastName}** به‌عنوان وکیل ثبت شد.\n`
        + `👤 دیسکورد: <@${user.id}>\n`
        + `🎮 نام درون‌بازی: **${rec.inGameName}** — این نام ملاک تشخیص آنلاین است\n`
        + `📅 دورهٔ وکالت: ${fa.digits(days)} روز — تا ${fa.digits(Math.ceil(days))} روز دیگر منقضی می‌شود.\n`
        + '📊 پایش آنلاین‌بودن و روزشمار دوره از همین لحظه آغاز شد (بعد از DC و برگشتن هم به‌درستی تشخیص داده می‌شود).',
      );
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('removevakil')
      .setDescription('حذف وکیل با نام و نام خانوادگی (فقط معاونت قضایی)')
      .addStringOption((o) => o
        .setName('نام')
        .setDescription('نام وکیل')
        .setRequired(true))
      .addStringOption((o) => o
        .setName('نام_خانوادگی')
        .setDescription('نام خانوادگی وکیل')
        .setRequired(true))
      .setDMPermission(false),

    async execute(interaction) {
      if (!interaction.member.roles.cache.has(cfg.roles.deputy)) {
        return interaction.reply({ content: '⛔ این دستور فقط برای اعضای **معاونت قضایی** است.', flags: MessageFlags.Ephemeral });
      }

      const firstName = interaction.options.getString('نام', true).trim();
      const lastName = interaction.options.getString('نام_خانوادگی', true).trim();
      const rec = vakils.findByName(firstName, lastName);

      if (!rec) {
        return interaction.reply({
          content: `⛔ وکیلی با نام **${firstName} ${lastName}** یافت نشد. با /list نام‌ها را ببینید.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      vakils.remove(rec);
      return interaction.reply({
        content: `✅ وکیل **${rec.firstName} ${rec.lastName}** حذف شد.\n`
          + `📊 آمار نهایی: آنلاین ${fa.duration(rec.onlineSeconds || 0)} — پرونده‌های قبول‌شده: ${rec.acceptedCases || 0} — برد: ${rec.wins || 0} — باخت: ${rec.losses || 0}`,
        flags: MessageFlags.Ephemeral,
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('editvakil')
      .setDescription('به‌روزرسانی شماره تماس یا تمدید دورهٔ وکیل بدون حذف (فقط معاونت قضایی)')
      .addStringOption((o) => o
        .setName('نام')
        .setDescription('نام وکیل')
        .setRequired(true))
      .addStringOption((o) => o
        .setName('نام_خانوادگی')
        .setDescription('نام خانوادگی وکیل')
        .setRequired(true))
      .addStringOption((o) => o
        .setName('شماره_تماس')
        .setDescription('شماره تماس جدید وکیل')
        .setRequired(false))
      .addIntegerOption((o) => o
        .setName('تمدید_روز')
        .setDescription('تمدید دورهٔ وکالت به روز (از امروز)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(365))
      .setDMPermission(false),

    async execute(interaction) {
      if (!interaction.member.roles.cache.has(cfg.roles.deputy)) {
        return interaction.reply({ content: '⛔ این دستور فقط برای اعضای **معاونت قضایی** است.', flags: MessageFlags.Ephemeral });
      }

      const firstName = interaction.options.getString('نام', true).trim();
      const lastName = interaction.options.getString('نام_خانوادگی', true).trim();
      const phone = (interaction.options.getString('شماره_تماس') || '').trim();
      const extendDays = interaction.options.getInteger('تمدید_روز');

      const rec = vakils.findByName(firstName, lastName);
      if (!rec) {
        return interaction.reply({ content: `⛔ وکیلی با نام **${firstName} ${lastName}** یافت نشد. با /list نام‌ها را ببینید.`, flags: MessageFlags.Ephemeral });
      }

      if (!phone && !extendDays) {
        return interaction.reply({ content: 'ℹ️ حداقل یکی از گزینه‌های «شماره_تماس» یا «تمدید_روز» را وارد کنید.', flags: MessageFlags.Ephemeral });
      }

      if (phone) rec.phone = phone;
      if (extendDays) rec.termEndsAt = Date.now() + extendDays * 86400000;
      if (rec.active === false && extendDays) rec.active = true; // تمدید دورهٔ پایان‌یافته → دوباره فعال
      vakils.save();

      return interaction.reply({
        content: `✅ وکیل **${rec.firstName} ${rec.lastName}** به‌روزرسانی شد.\n`
          + (phone ? `📞 شماره تماس: ${fa.digits(phone)}\n` : '')
          + (extendDays ? `📅 دورهٔ وکالت تا ${fa.num(extendDays)} روز دیگر تمدید شد.\n` : ''),
        flags: MessageFlags.Ephemeral,
      });
    },
  },
];
