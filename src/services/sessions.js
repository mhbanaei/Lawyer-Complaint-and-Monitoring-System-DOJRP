'use strict';

/**
 * قالب‌های متن از پیش آماده‌شده برای اطلاعیه‌های جلسهٔ دادگاه
 * (طبق درخواست: متن‌های آماده متفاوت برای جلسهٔ عمومی و خصوصی)
 */

const jalali = require('../jalali');
const fa = require('../fa');

const HEADER = 'بسمه‌تعالی';

function defendantNames(c) {
  return c.defendants.map((d) => `${d.firstName} ${d.lastName}`).join('، ');
}

/**
 * متن اطلاعیهٔ تنظیم قرار دادگاه
 * @param {object} c پرونده
 */
function sessionAnnouncement(c) {
  const s = c.session;
  const when = `${jalali.jalaliWeekday(new Date(s.at))} ${jalali.formatJalaliDateTime(new Date(s.at))}`;
  const kind = s.type === 'private'
    ? ' **جلسهٔ دادگاه به‌صورت خصوصی** برگزار خواهد شد.'
    : ' **جلسهٔ دادگاه به‌صورت عمومی** برگزار خواهد شد و حضور شنوندگان بلامانع است.';

  // طرفین دعوا با منشن + وکلا با منشن و نام کامل
  const plaintiffLine = `👤 **شاکی:** <@${c.complainantId}> (${c.plaintiff.firstName} ${c.plaintiff.lastName})`;
  const defendantLine = `⚠️ **مشتکی‌عنه:** ${defendantNames(c)}`;
  const vakilLines = [];
  const phoneOf = (id) => {
    try { const v = require('../services/vakils').findByDiscord(id); return v && v.phone ? ` — 📞 ${fa.digits(String(v.phone))}` : ''; } catch (_) { return ''; }
  };
  // اولویت شمارهٔ ثبت‌شده در پرونده، سپس رجیستری /addvakil
  const inline = (stored, id) => (stored ? ` — 📞 ${fa.digits(String(stored))}` : phoneOf(id));
  if (c.plaintiffVakil) vakilLines.push(`🧑‍⚖️ **وکیل شاکی:** <@${c.plaintiffVakil.discordId}> (${c.plaintiffVakil.name}${inline(c.plaintiffVakil.phone, c.plaintiffVakil.discordId)})`);
  if (c.defendantVakil) vakilLines.push(`🛡️ **وکیل مشتکی‌عنه:** <@${c.defendantVakil.discordId}> (${c.defendantVakil.name}${inline(c.defendantVakil.phone, c.defendantVakil.discordId)})`);

  const lines = [
    HEADER,
    '',
    '**اعلام وقت رسیدگی دادگاه**',
    '',
    `📌 **شمارهٔ پرونده:** ${fa.digits(c.number)}`,
    '**⚖️ طرفین دعوا:**',
    plaintiffLine,
    defendantLine,
    ...(vakilLines.length ? ['', '**🧑‍⚖️ وکلای پرونده:**', ...vakilLines] : []),
    `⚖️ **موضوع:** ${c.subject}`,
    '',
    `🕒 **زمان جلسه:** ${when}`,
    `🏛️ **نوع جلسه:** ${s.type === 'private' ? 'خصوصی' : 'عمومی'}`,
    kind,
    '',
    s.type === 'private'
      ? '🔔 حضور سایر اشخاص در جلسه مجاز نیست و محدودهٔ رسیدگی صرفاً به طرفین دعوا و وکلای آن‌ها خواهد بود.'
      : '🔔 حضور شهروندان به‌عنوان شنونده آزاد است؛ نظم جلسه زیر نظر قاضی محترم حفظ خواهد شد.',
    '',
    '🔔 طرفین موظف‌اند در زمان مقرر در جلسه حاضر باشند. در صورت عدم حضور بدون عذر موجه، تصمیم دادگاه در خصوص غیاب مطابق مقررات اتخاذ خواهد شد.',
    '',
    '— معاونت قضایی ParadiseRP',
  ];
  return lines.join('\n');
}

/** متن پیام خصوصی به شاکی پس از ثبت شکایت */
function complaintReceivedDM(c) {
  const lines = [
    '✅ **درخواست شما با موفقیت ثبت شد.**',
    '',
    `📋 شمارهٔ ثبت: **${fa.digits(c.number)}**`,
    `📚 موضوع: ${c.subject}`,
    '',
  ];
  if (c.pendingVakil) {
    lines.push(`🧑‍⚖️ درخواست وکالت برای **${c.pendingVakil.name}** ارسال شد (مهلت پاسخ: ۱۲ ساعت).`,
      'در صورت انقضای مهلت یا ردِ وکیل، امکان انتخاب وکیل دیگر برای سایر وکلا باز می‌شود.', '');
  }
  lines.push(
    '⏳ تا تعیین وقت دادگاه از طرف قاضی محترم، شکیبا باشید.',
    '🔔 در صورتی که وقت دادگاه شما تعیین شود، از همین طریق اطلاع‌رسانی خواهد شد.',
  );
  return lines.join('\n');
}

/** پیام خصوصی به شاکی: وکیلِ پذیرندهٔ سمت او مشخص شد */
function vakilAcceptedDM(c, vakilName, statsLine) {
  return [
    '🧑‍⚖️ **درخواست وکالت جدید برای پروندهٔ شما ثبت شد**',
    '',
    `👤 وکیلِ درخواست‌دهنده: **${vakilName}**`,
    `📋 شمارهٔ پرونده: **${fa.digits(c.number)}**`,
    `📚 موضوع: ${c.subject}`,
    '',
    '📊 سوابق این وکیل:',
    statsLine || '—',
    '',
    '🔔 در صورت تأیید، دکمهٔ **«✅ این وکیل را می‌پذیرم»** را بزنید تا به‌عنوان وکیل شما در پرونده ثبت شود.',
    'در غیر این صورت دکمهٔ **«❌ نمی‌پذیرم»** را بزنید؛ آن وکیل دیگر برای این پرونده نمی‌تواند درخواست دهد و انتخاب وکیل دیگر برایتان باز می‌شود.',
    '⌛ مهلت پاسخ: ۱۲ ساعت — پس از آن درخواست به‌صورت خودکار رد می‌شود.',
  ].filter(Boolean).join('\n');
}

/** خط پایان دورهٔ وکالت وکیل (برای نمایش سابقه به شاکی) — از روی نام و نام‌خانوادگی */
function statsTermLine(vakilName) {
  const vakils = require('../services/vakils');
  const found = vakils.all().find((v) => `${v.firstName} ${v.lastName}` === vakilName);
  if (!found || !found.termEndsAt) return '—';
  const jalali = require('../jalali');
  return `دورهٔ وکالت تا ${jalali.formatJalali(new Date(found.termEndsAt))} ادامه دارد`;
}

/** شماره تماس وکیل از رجیستری (اگر ثبت شده باشد) */
function phoneOf(discordId) {
  try {
    const v = require('../services/vakils').findByDiscord(discordId);
    if (v && v.phone) return ` — 📞 ${fa.digits(String(v.phone))}`;
  } catch (_) { /* noop */ }
  return '';
}

/** پیام خصوصی به وکیل: شاکی وکیل را تأیید کرد */
function vakilConfirmedByPlaintiffDM(c, vakilName) {
  return [
    '✅ **وکالت شما از سوی شاکی تأیید شد!**',
    '',
    `📋 شمارهٔ پرونده: **${fa.digits(c.number)}**`,
    `👤 شاکی: <@${c.complainantId}>`,
    '',
    '🔔 اکنون وکیل رسمی سمت شاکی هستید؛ متن کامل پرونده از دکمهٔ «مطالعهٔ پرونده» در کانال شکایات در دسترس شماست.',
  ].join('\n');
}

/** پیام خصوصی به وکیل: شاکی وکیل را رد کرد */
function vakilRejectedByPlaintiffDM(c, vakilName) {
  return [
    '❌ **درخواست وکالت شما از سوی شاکی رد شد.**',
    '',
    `📋 شمارهٔ پرونده: **${fa.digits(c.number)}**`,
    '',
    '🔔 در این پرونده دیگر نمی‌توانید درخواست وکالت بدهید.',
  ].join('\n');
}

/** پیام خصوصی به وکیلِ پذیرفته‌شده: وقت دادگاه تعیین شد */

/** پیام خصوصی به وکیلِ پذیرندهٔ سمت مشتکی‌عنه */
function defendantVakilAcceptedDM(c, vakilName) {
  return [
    '🛡️ **وکالت شما پذیرفته شد.**',
    '',
    `📋 شمارهٔ پرونده: **${fa.digits(c.number)}**`,
    `⚠️ سمت شما: **وکیل مشتکی‌عنه**`,
    '',
    '📌 در نظر داشته باشید: چون وکیل مشتکی‌عنه هستید، احتمال دارد وکیل دیگری نیز به انتخاب مشتکی‌عنه در پرونده اضافه شود؛',
    '**اما مسئولیت پرونده با شما خواهد بود.**',
    '',
    '🔔 متن کامل پرونده از دکمهٔ «مطالعهٔ پرونده» در کانال شکایات قابل مشاهده است.',
  ].join('\n');
}

/** متن پیام خصوصی به شاکی پس از تعیین وقت دادگاه */
function sessionScheduledDM(c) {
  const s = c.session;
  const when = `${jalali.jalaliWeekday(new Date(s.at))} ${jalali.formatJalaliDateTime(new Date(s.at))}`;
  const vakilLine = c.plaintiffVakil
    ? `🧑‍⚖️ وکیل شما: **${c.plaintiffVakil.name}**${phoneOf(c.plaintiffVakil.discordId)}`
    : null;
  return [
    '🏛️ **وقت دادگاه پروندهٔ شما تعیین شد.**',
    '',
    `📋 شمارهٔ پرونده: **${fa.digits(c.number)}**`,
    `📚 موضوع: ${c.subject}`,
    `🕒 زمان جلسه: **${when}**`,
    `🏛️ نوع جلسه: **${s.type === 'private' ? 'خصوصی' : 'عمومی'}**`,
    ...(vakilLine ? [vakilLine] : []),
    '',
    '🔔 در زمان مقرر در جلسه حاضر باشید. عدم حضور بدون عذر موجه، پیامد قانونی خواهد داشت.',
    '🧑‍⚖️ وکلا نیز تا شروع جلسه می‌توانند وکالت یکی از طرفین را بپذیرند.',
  ].join('\n');
}

/** متن پیام خصوصی پس از صدور رأی نهایی */
function rulingDM(c, opts = {}) {
  const out = c.finalRuling.outcome === 'plaintiff'
    ? 'به نفع شاکی'
    : c.finalRuling.outcome === 'defendant'
      ? 'به نفع مشتکی‌عنه'
      : 'مختومه — بدون نفع برای هیچ‌یک از طرفین';
  const role = opts.role === 'vakil'
    ? (c.plaintiffVakil && c.plaintiffVakil.name === opts.name ? 'شاکی' : 'مشتکی‌عنه')
    : 'شاکی';
  const head = opts.role === 'vakil'
    ? '⚖️ **رأی نهایی پرونده‌ای که وکالت آن را دارید صادر شد.**'
    : '⚖️ **رأی نهایی پروندهٔ شما صادر شد.**';
  return [
    head,
    '',
    `📋 شمارهٔ پرونده: **${fa.digits(c.number)}**`,
    opts.role === 'vakil' ? `🧑‍⚖️ سمت شما: **وکیل ${role}**` : null,
    `🏛️ نتیجه: **${out}**`,
    '',
    '🗂️ پرونده بسته شد. جزئیات کامل پرونده و رأی در پیام بعدی ارسال شده است.',
  ].filter(Boolean).join('\n');
}

/**
 * DM «کل پرونده» برای شاکی و وکلا پس از تعیین وقت دادگاه یا صدور رأی.
 * چون گیرندگان مورد تأیید قضایی‌اند، متن کامل (شرح و شواهد) برایشان ارسال می‌شود.
 * @param {object} opts - head: خط توضیح | asRuling: به شکل رأی نهایی رندر کن
 */
function caseCopyDM(c, opts = {}) {
  const embeds = require('../embeds');
  const embed = opts.asRuling ? embeds.finalRulingEmbed(c) : embeds.caseEmbed(c, { full: true });
  const content = opts.asRuling
    ? `بسمه‌تعالی\n⚖️ **رأی نهایی پروندهٔ شمارهٔ ${fa.digits(c.number)}**`
    : [
      `📄 **رونوشت کامل پروندهٔ شمارهٔ ${fa.digits(c.number)}**`,
      opts.head || null,
      c.session ? `🕒 **زمان جلسه: ${c.session.atText}** — ${c.session.type === 'private' ? 'خصوصی' : 'عمومی'}` : null,
    ].filter(Boolean).join('\n');
  return { content, embed };
}

/** DM جلسه به هر وکیل پذیرفته‌شده: وقت دادگاه + جزئیات پرونده */
function vakilSessionDM(c, vakilName) {
  const s = c.session;
  const when = `${jalali.jalaliWeekday(new Date(s.at))} ${jalali.formatJalaliDateTime(new Date(s.at))}`;
  const side = (c.plaintiffVakil && c.plaintiffVakil.discordId === vakilName) ? 'شاکی' : 'مشتکی‌عنه';
  const desc = String(c.description || '');
  const counterpart = side === 'شاکی'
    ? (c.defendantVakil ? `🛡️ وکیل طرف مقابل: **${c.defendantVakil.name}**${phoneOf(c.defendantVakil.discordId)}` : null)
    : (c.plaintiffVakil ? `🧑‍⚖️ وکیل طرف مقابل: **${c.plaintiffVakil.name}**${phoneOf(c.plaintiffVakil.discordId)}` : null);
  return [
    '🏛️ **وقت دادگاه پرونده‌ای که وکالت آن را دارید تعیین شد**',
    '',
    `📋 **شمارهٔ پرونده:** ${fa.digits(c.number)}`,
    `🧑‍⚖️ سمت شما: **وکیل ${side}**`,
    `👤 شاکی: ${c.plaintiff.firstName} ${c.plaintiff.lastName}`,
    `⚠️ مشتکی‌عنه: ${defendantNames(c)}`,
    `📚 موضوع: ${c.subject}`,
    `📝 شرح: ${desc.slice(0, 300)}${desc.length > 300 ? '…' : ''}`,
    `🎯 خواستهٔ شاکی: ${String(c.demand || '—').slice(0, 200)}`,
    '',
    `🕒 **زمان جلسه: ${when}**`,
    `🏛️ نوع جلسه: **${s.type === 'private' ? 'خصوصی' : 'عمومی'}**`,
    ...(counterpart ? [counterpart] : []),
    '',
    '🔔 در زمان مقرر در جلسه حاضر باشید. متن کامل پرونده از دکمهٔ «مطالعهٔ پرونده» در کانال شکایات در دسترس شماست.',
  ].join('\n');
}

module.exports = {
  sessionAnnouncement,
  complaintReceivedDM,
  sessionScheduledDM,
  vakilAcceptedDM,
  vakilConfirmedByPlaintiffDM,
  vakilRejectedByPlaintiffDM,
  vakilSessionDM,
  defendantVakilAcceptedDM,
  rulingDM,
  caseCopyDM,
  defendantNames,
};
