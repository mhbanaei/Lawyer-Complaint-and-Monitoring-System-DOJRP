'use strict';

/**
 * کامند /shekayat — شروع ثبت شکایت (برای همهٔ اعضای سرور)
 * فرم رسمی به‌صورت صفحهٔ وب ارائه می‌شود (فرم کامل با متشاکی(شکایت‌شده) ۱ تا ۱۰ نفر،
 * چاپ فرم و …). لینک صفحه با توکن امضاشدهٔ اختصاصیِ همین کاربر ساخته می‌شود.
 *
 * مودال‌های مرحله‌ای دیسکورد هنوز پشتیبانی می‌شوند (STAGES / modalForStage
 * برای فرم‌های قدیمی و ویرایش دستی نگه داشته شده‌اند).
 */

const crypto = require('crypto');
const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
} = require('discord.js');
const cfg = require('../config');
const cases = require('../services/cases');

const STAGES = {
  A: {
    title: 'اطلاعات شاکی (۱ از ۵)',
    fields: [
      { id: 'plaintiff_firstName', label: 'نام *', required: true, max: 100 },
      { id: 'plaintiff_lastName', label: 'نام خانوادگی *', required: true, max: 100 },
      { id: 'plaintiff_fatherName', label: 'نام پدر', required: false, max: 100 },
      { id: 'plaintiff_nationalId', label: 'شناسه / کد ملی', required: false, max: 20 },
      { id: 'plaintiff_phone', label: 'شماره تماس *', required: true, max: 20 },
    ],
  },
  B: {
    title: 'اقامت و متشاکی(شکایت‌شده) (۲ از ۵)',
    fields: [
      { id: 'plaintiff_job', label: 'شغل / سمت', required: false, max: 100 },
      { id: 'plaintiff_residence', label: 'محل اقامت (شهر، استان، آدرس، کدپستی)', required: false, max: 300 },
      { id: 'def_firstName', label: 'متشاکی(شکایت‌شده): نام *', required: true, max: 100 },
      { id: 'def_lastName', label: 'متشاکی(شکایت‌شده): نام خانوادگی *', required: true, max: 100 },
      { id: 'def_fatherName', label: 'متشاکی(شکایت‌شده): نام پدر', required: false, max: 100 },
    ],
  },
  C: {
    title: 'متشاکی(شکایت‌شده) و موضوع (۳ از ۵)',
    fields: [
      { id: 'def_phone', label: 'متشاکی(شکایت‌شده): شماره تماس', required: false, max: 20 },
      { id: 'def_job', label: 'متشاکی(شکایت‌شده): شغل / سمت', required: false, max: 100 },
      { id: 'def_relation', label: 'نوع ارتباط با شاکی', required: false, max: 100 },
      { id: 'def_place', label: 'محل اقامت / محل فعالیت', required: false, max: 300 },
      { id: 'subject', label: 'موضوع شکایت / دادخواست *', required: true, max: 200 },
    ],
  },
  D: {
    title: 'وقوع و شرح شکایت (۴ از ۵)',
    fields: [
      { id: 'occurredAt', label: 'تاریخ وقوع موضوع', required: false, max: 40, placeholder: 'مثلاً ۱۴۰۵/۰۶/۲۸' },
      { id: 'occurredPlace', label: 'محل وقوع موضوع', required: false, max: 200 },
      { id: 'occurredDetail', label: 'زمان و نشانی محل وقوع', required: false, max: 300 },
      { id: 'evidence', label: 'دلایل و شواهد', required: false, max: 500 },
      { id: 'description', label: 'شرح کامل شکایت / دادخواست *', required: true, max: 1000 },
    ],
  },
  E: {
    title: 'خواسته (۵ از ۵)',
    fields: [
      { id: 'demand', label: 'خواسته / درخواست شاکی *', required: true, max: 1000 },
    ],
  },
};

/** مودال مرحلهٔ مشخص با پیش‌پر کردن از پیش‌نویس */
function modalForStage(stage, data) {
  const { modal } = require('../ui');
  const s = STAGES[stage];
  return modal(`paradise:form:modal:${stage}`, s.title,
    s.fields.map((f) => ({ ...f, value: data[f.id] || undefined })));
}

module.exports = {
  STAGES,
  modalForStage,

  data: new SlashCommandBuilder()
    .setName('shekayat')
    .setDescription('ثبت شکایت / دادخواست جدید')
    .setDMPermission(false),

  async execute(interaction) {

    // کول‌داون: یک پروندهٔ باز در هر لحظه
    const open = cases.openCaseOf(interaction.user.id);
    if (open) {
      return interaction.reply({
        content: `⛔ شما یک پروندهٔ باز دارید (شمارهٔ ثبت: **${open.number}**).\n`
          + 'تا بسته‌شدن آن و صدور رأی نهایی، امکان ثبت شکایت جدید وجود ندارد.',
        flags: MessageFlags.Ephemeral,
      });
    }

    // توکن امضاشدهٔ اختصاصی کاربر برای صفحهٔ فرم
    const token = crypto.createHmac('sha256', cfg.token).update(interaction.user.id).digest('hex').slice(0, 32);
    const url = `${cfg.webPublicUrl}/Shekayat?u=${interaction.user.id}&t=${token}`;

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('بسمه‌تعالی — فرم ثبت شکایت / دادخواست')
      .setDescription('**به منظور پیگیری امور قضایی و حقوقی**\n\n'
        + 'برای تکمیل فرم رسمی (اطلاعات شاکی، متشاکی(شکایت‌شده) ۱ تا ۱۰ نفر، موضوع و خواسته) دکمهٔ زیر را بزنید.\n'
        + 'شمارهٔ ثبت و تاریخ ثبت به‌صورت خودکار درج می‌شود.\n\n'
        + '📋 پس از ثبت، پرونده در کانال شکایات منتشر شده و شمارهٔ ثبت به شما اعلام می‌شود.');

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('🏛️ تکمیل فرم شکایت / دادخواست')
        .setStyle(ButtonStyle.Link)
        .setURL(url),
    );

    return interaction.reply({
      embeds: [embed],
      components: [row],
      flags: MessageFlags.Ephemeral,
    });
  },
};
