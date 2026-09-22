'use strict';

/**
 * انتشار پروندهٔ جدید در کانال شکایات:
 * - ساخت رکورد پرونده
 * - ارسال پیام پرونده با پنل قاضی و پنل وکیل
 * - اگر شاکی وکیل انتخاب کرده: DM پیشنهاد وکالت به آن وکیل (مهلت ۱۲ ساعته قبول/رد)
 * - پیام خصوصی رسید به شاکی
 */

const cases = require('./cases');
const vakils = require('./vakils');
const cfg = require('../config');
const fa = require('../fa');
const embeds = require('../embeds');
const sessionsSvc = require('./sessions');
const { judgePanelRow, vakilPanelRow } = require('../ui');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

/** دکمه‌های قبول/رد پیشنهاد وکالت (در DM وکیل) */
function respondRow(caseNumber) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`paradise:vakil:respond:accept:${caseNumber}`).setLabel('✅ قبول وکالت').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`paradise:vakil:respond:reject:${caseNumber}`).setLabel('❌ رد وکالت').setStyle(ButtonStyle.Danger),
  );
}

/**
 * ارسال DM پیشنهاد/درخواست وکالت به وکیلِ در انتظار پاسخ (پیشنهاد اولیه یا انتخاب مجدد شاکی)
 * @returns {Promise<boolean>} آیا DM ارسال شد؟
 */
async function publishDmForPending(client, c) {
  const pending = c.pendingVakil;
  if (!pending || pending.status !== 'pending') return false;
  const vu = await client.users.fetch(pending.discordId).catch(() => null);
  if (!vu) {
    console.warn(`⚠️ Vakil ${pending.discordId} dar Discord peyda nashod — darkhast batel mishavad.`);
    cases.respondPending(c, 'expired');
    return false;
  }
  const originTxt = pending.origin === 'citizen_pick'
    ? 'شاکیِ پروندهٔ زیر شما را به‌عنوان وکیل انتخاب کرده است.'
    : 'درخواست وکالت شاکیِ پروندهٔ زیر ثبت شده است (پذیرش عمومی).';
  const dmMsg = await vu.send({
    content: `🧑‍⚖️ **درخواست وکالت جدید برای شما ثبت شد** — پروندهٔ ${fa.digits(c.number)}`,
    embeds: [embeds.vakilRequestEmbed(c, originTxt)],
    components: [respondRow(c.number)],
  }).catch((e) => { console.warn(`⚠️ DM pishnhade vekalat be vakil ${pending.discordId} ersal nashod:`, e.message); return null; });
  if (dmMsg) cases.setPendingDmMessage(c, dmMsg.id);
  return Boolean(dmMsg);
}

/**
 * @param {Client} client کلاینت دیسکورد
 * @param {{complainantId: string, form: object, vakilId?: string}} p
 * @returns {Promise<object>} رکورد پروندهٔ ساخته‌شده
 */
async function publishCase(client, { complainantId, form, vakilId }) {
  const rec = cases.create({ complainantId, form, vakilPick: null });

  const channel = await client.channels.fetch(cfg.channels.complaints).catch(() => null);
  if (!channel) throw new Error('کانال شکایات یافت نشد. با معاونت قضایی تماس بگیرید.');

  const msg = await channel.send({
    content: `📋 **پروندهٔ شکایت جدید — شمارهٔ ثبت: ${fa.digits(rec.number)}**`,
    embeds: [embeds.caseEmbed(rec)],
    components: [judgePanelRow(rec.number, rec), vakilPanelRow(rec)],
  });

  cases.indexMessage(msg.id, rec.number);
  rec.messageId = msg.id;
  cases.save();

  // آینهٔ DM پرونده برای همهٔ وکلای فعال — همان پیام و همان دکمه‌ها، همگام با کانال
  await require('./mirror').mirrorToVakils(client, rec)
    .catch((e) => console.warn('⚠️ Ersale ayene-ye DM vakilha namovafagh:', e.message));

  // پیشنهاد وکالت شاکی به وکیلِ انتخابی (DM + مهلت ۱۲ ساعته)
  if (vakilId && vakilId !== 'novakil') {
    const v = vakils.findByDiscord(vakilId);
    if (v && vakils.termActive(v)) {
      cases.setPendingVakil(rec, { discordId: v.discordId, name: `${v.firstName} ${v.lastName}`, origin: 'citizen_pick' });
      await publishDmForPending(client, rec);
    }
  }

  const user = await client.users.fetch(complainantId).catch(() => null);
  if (user) {
    await user.send(sessionsSvc.complaintReceivedDM(rec))
      .catch((e) => console.warn(`⚠️ DM sabte shekayat be ${complainantId} ersal nashod:`, e.message));
  }

  return rec;
}

module.exports = { publishCase, publishDmForPending, respondRow };
