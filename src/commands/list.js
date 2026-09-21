'use strict';

/**
 * /list — جزئیات وکلا: وضعیت آنلاین لحظه‌ای، باقی‌ماندهٔ دوره،
 * پرونده‌های قبول‌شده، برد/باخت و شماره تماس — فقط برای خودِ کاربر (Ephemeral)
 */

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const vakils = require('../services/vakils');
const players = require('../services/players');
const embeds = require('../embeds');
const fa = require('../fa');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('list')
    .setDescription('فهرست وکلا با جزئیات (فقط خودتان می‌بینید)')
    .setDMPermission(false),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    vakils.sweepExpired();
    const rows = vakils.leaderboard();

    // وضعیت آنلاین فعلی: تطبیق هر وکیل با فهرست بازیکنان (id + نام درون‌بازی ذخیره‌شده + لایسنس‌ها)
    const onlineMap = {};
    let playerList = null;
    try {
      playerList = await players.getPlayers(true);
    } catch (_) { playerList = null; }

    const enriched = rows.map((v) => {
      const copy = { ...v };
      copy._onlineSeconds = players.currentOnlineSeconds(v);
      onlineMap[v.discordId] = playerList
        ? players.matchesPlayer(v, playerList)
        : players.isCurrentlyOnline(v); // خطای شبکه → وضعیت پایش داخلی
      return copy;
    });

    const embed = embeds.vakilListEmbed(enriched, { onlineMap });

    // ردیف دوم: آمار پرونده‌ها
    const s = require('../services/cases').stats();
    embed.addFields({
      name: '📊 آمار پرونده‌ها',
      value: `کل: **${fa.num(s.total)}** — باز: **${fa.num(s.open)}** — بسته: **${fa.num(s.closed)}**`,
      inline: false,
    });

    return interaction.editReply({ embeds: [embed] });
  },
};
