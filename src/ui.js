'use strict';

/**
 * سازندهٔ کامپوننت‌های مشترک UI (دکمه، منو، مودال)
 * پیشوند شناسه‌ها: paradise:
 */

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

function btn(customId, label, style, { disabled = false, emoji = null } = {}) {
  const b = new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
  if (disabled) b.setDisabled(true);
  if (emoji) b.setEmoji(emoji);
  return b;
}

/**
 * ردیف دکمه‌های پنل قاضی زیر پیام پرونده (شمارهٔ پرونده در شناسهٔ دکمه‌ها)
 * پس از تعیین وقت دادگاه، دکمهٔ «تنظیم قرار دادگاه» حذف می‌شود.
 */
function judgePanelRow(caseNumber, caseRec = null) {
  const n = caseNumber != null ? `:${caseNumber}` : '';
  const scheduled = caseRec && caseRec.status !== 'registered';
  const comps = [];
  if (!scheduled) comps.push(btn(`paradise:judge:schedule${n}`, '🏛️ تنظیم قرار دادگاه', ButtonStyle.Primary));
  comps.push(btn(`paradise:judge:rule${n}`, '⚖️ اخذ رأی پایانی', ButtonStyle.Danger));
  return new ActionRowBuilder().addComponents(comps);
}

/**
 * دکمه‌های وکیل زیر پیام پرونده
 * - پذیرش وکالت شاکی: تا وقتی وکیل شاکی پذیرفته/در انتظار پاسخ است غیرفعال یا مخفی؛
   پس از انقضای ۱۲ ساعته یا ردِ وکیلِ انتخابی، برای سایر وکلا باز می‌شود.
 * - پذیرش وکالت متشاکی(شکایت‌شده): تا وقتی وکیل متشاکی(شکایت‌شده) پذیرفته مخفی می‌شود.
 */
function vakilPanelRow(caseRec = null) {
  // شمارهٔ پرونده در شناسهٔ دکمه‌ها → دکمه‌ها هم در کانال و هم در «آینهٔ DM» وکلا کار می‌کنند
  const n = caseRec ? `:${caseRec.number}` : '';
  const comps = [btn(`paradise:vakil:read${n}`, '📂 مطالعهٔ پرونده', ButtonStyle.Secondary)];
  const closed = caseRec && caseRec.status === 'closed';
  if (!closed) {
    const pTaken = caseRec && caseRec.plaintiffVakil;
    const pending = caseRec && caseRec.pendingVakil;
    if (pTaken || pending) {
      // وکیل شاکی پذیرفته یا درخواستی در جریان است → دکمهٔ سمت شاکی کلاً پنهان می‌شود
    } else {
      comps.push(btn(`paradise:vakil:accept:plaintiff${n}`, '🧑‍⚖️ پذیرش وکالت شاکی', ButtonStyle.Success));
    }
    const dTaken = caseRec && caseRec.defendantVakil;
    if (!dTaken) {
      comps.push(btn(`paradise:vakil:accept:defendant${n}`, '🛡️ پذیرش وکالت متشاکی(شکایت‌شده)', ButtonStyle.Success));
    }
  }
  return new ActionRowBuilder().addComponents(comps);
}

/** ردیف دکمه‌های مرحله‌ای فرم شکایت */
function formNavRow(stage, { backTo = null, showConfirm = false } = {}) {
  const row = new ActionRowBuilder();
  if (backTo) {
    row.addComponents(btn(`paradise:form:back:${backTo}:${stage}`, 'قبلی', ButtonStyle.Secondary));
  }
  row.addComponents(btn(`paradise:form:next:${stage}`, 'مرحلهٔ بعد', ButtonStyle.Primary));
  if (showConfirm) {
    row.addComponents(btn('paradise:form:confirm', '✅ تأیید و ارسال', ButtonStyle.Success));
  }
  row.addComponents(btn('paradise:form:cancel', 'انصراف', ButtonStyle.Danger));
  return row;
}

/** منوی انتخاب وکیل (مرحلهٔ D) */
function vakilSelectMenu(vakils) {
  const options = [{ label: 'بدون وکیل', description: 'شکایت را بدون وکیل ثبت می‌کنم', value: 'novakil' }];
  for (const v of vakils.slice(0, 23)) {
    options.push({
      label: `${v.firstName} ${v.lastName}`,
      description: `پرونده‌های قبول‌شده: ${v.acceptedCases || 0}`,
      value: `vakil:${v.discordId}`,
    });
  }
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('paradise:form:vakil')
      .setPlaceholder('انتخاب وکیل یا نمایندهٔ قانونی')
      .addOptions(options),
  );
}

/** مودال چندفیلدی */
function modal(customId, title, fields) {
  const m = new ModalBuilder().setCustomId(customId).setTitle(title.slice(0, 45));
  for (const f of fields) {
    const input = new TextInputBuilder()
      .setCustomId(f.id)
      .setLabel(f.label.slice(0, 45))
      .setStyle(f.paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(Boolean(f.required));
    if (f.max) input.setMaxLength(Math.min(f.max, 4000));
    if (f.placeholder) input.setPlaceholder(String(f.placeholder).slice(0, 100));
    if (f.value) input.setValue(String(f.value).slice(0, f.max || 4000));
    m.addComponents(new ActionRowBuilder().addComponents(input));
  }
  return m;
}

/** مودال رأی نهایی */
function rulingModal() {
  return modal('paradise:judge:rule:modal', 'صدور رأی نهایی', [
    { id: 'outcome_note', label: 'یادداشت (اختیاری)', paragraph: false, required: false, placeholder: 'خلاصهٔ دلایل رأی' },
  ]);
}

module.exports = {
  btn,
  judgePanelRow,
  vakilPanelRow,
  formNavRow,
  vakilSelectMenu,
  modal,
  rulingModal,
};
