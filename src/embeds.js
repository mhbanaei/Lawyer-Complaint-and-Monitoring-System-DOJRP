'use strict';

/**
 * سازندهٔ Embedها: نمایش پرونده، رأی نهایی، اطلاعیهٔ جلسه و لیدربورد وکلا
 */

const { EmbedBuilder } = require('discord.js');
const fa = require('./fa');
const jalali = require('./jalali');
const sessions = require('./services/sessions');

const COLORS = {
  registered: 0x5865f2,   // بنفش دیسکورد
  scheduled: 0xf1c40f,    // زرد
  closed: 0x2ecc71,       // سبز
  private: 0xe67e22,      // نارنجی
  public: 0x3498db,       // آبی
  list: 0x9b59b6,
};

const STATUS_FA = {
  registered: 'ثبت‌شده — در انتظار تعیین وقت دادگاه',
  scheduled: 'وقت دادگاه تعیین شده',
  closed: 'بسته‌شده — رأی نهایی صادر شده',
};

/** سازندهٔ مشترک سربرگ پرونده */
function baseCaseEmbed(c) {
  return new EmbedBuilder()
    .setColor(COLORS[c.status] || COLORS.registered)
    .setTitle(`بسمه‌تعالی — فرم ثبت شکایت / دادخواست (شمارهٔ ثبت: ${fa.digits(c.number)})`)
    .setDescription(
      '**به منظور پیگیری امور قضایی و حقوقی**\n'
      + `📅 تاریخ ثبت: **${c.createdAt ? jalali.formatJalali(new Date(c.createdAt)) : '—'}**`
      + `  |  📌 شمارهٔ ثبت: **${fa.digits(c.number)}**`,
    );
}

/** وضعیت وکالت دو-طرفه برای نمایش در embed */
/** شماره تماس وکیل از رجیستری /addvakil (اگر ثبت شده باشد) */
function vakilPhoneLine(discordId) {
  try {
    const v = require('../services/vakils').findByDiscord(discordId);
    if (v && v.phone) return ` — 📞 ${fa.digits(String(v.phone))}`;
  } catch (_) { /* noop */ }
  return '';
}

/** شماره تماس وکیل — اولویت با شمارهٔ ثبت‌شده در پرونده، سپس رجیستری /addvakil */
function phoneInline(storedPhone, discordId) {
  if (storedPhone) return ` — 📞 ${fa.digits(String(storedPhone))}`;
  return vakilPhoneLine(discordId);
}

function vakilStatusText(c) {
  const parts = [];
  if (c.plaintiffVakil) {
    parts.push(`🧑‍⚖️ وکیل شاکی: **${c.plaintiffVakil.name}**${phoneInline(c.plaintiffVakil.phone, c.plaintiffVakil.discordId)}`);
  } else if (c.pendingVakil) {
    const until = c.pendingVakil.status === 'awaiting_confirm'
      ? (c.pendingVakil.confirmExpiresAt || c.pendingVakil.expiresAt)
      : c.pendingVakil.expiresAt;
    const who = c.pendingVakil.status === 'awaiting_confirm'
      ? `در انتظار تأیید شاکی برای وکیل **${c.pendingVakil.name}**`
      : `در انتظار پاسخ وکیل **${c.pendingVakil.name}**`;
    parts.push(`⏳ ${who} (مهلت تا ${jalali.formatJalaliDateTime(new Date(until))})`);
  } else {
    parts.push('⏳ وکیل شاکی: در انتظار پذیرش وکالت');
  }
  parts.push(c.defendantVakil
    ? `🛡️ وکیل متشاکی(شکایت‌شده): **${c.defendantVakil.name}**${phoneInline(c.defendantVakil.phone, c.defendantVakil.discordId)}`
    : '🛡️ وکیل متشاکی(شکایت‌شده): در انتظار پذیرش وکالت');
  return parts.join('\n');
}

/** Embed پیشنهاد وکالت برای DM وکیلِ انتخابی */
function vakilRequestEmbed(c) {
  const e = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`🧑‍⚖️ درخواست وکالت — پروندهٔ شمارهٔ ${fa.digits(c.number)}`)
    .setDescription(
      '**بسمه‌تعالی**\nشاکیِ پروندهٔ زیر شما را به‌عنوان وکیل انتخاب کرده است.\n'
      + `⏳ مهلت پاسخ: **${c.pendingVakil ? jalali.formatJalaliDateTime(new Date(c.pendingVakil.expiresAt)) : '—'}** (۱۲ ساعت)\n\n`
      + 'پس از پذیرش، متن کامل پرونده از دکمهٔ «مطالعهٔ پرونده» در کانال شکایات قابل مشاهده است.',
    );
  e.addFields(
    { name: '👤 شاکی', value: `${c.plaintiff.firstName} ${c.plaintiff.lastName}`, inline: true },
    { name: '⚠️ متشاکی(شکایت‌شده)', value: sessions.defendantNames(c), inline: true },
    { name: '📌 موضوع', value: clipField(c.subject, 1020), inline: false },
    { name: '🕒 تاریخ و محل وقوع', value: `${c.occurredAt} — ${c.occurredPlace}`, inline: false },
    { name: '🎯 خواستهٔ شاکی', value: clipField(c.demand, 1020), inline: false },
  );
  return e;
}

/**
 * Embed کامل پرونده
 * @param {object} c پرونده
 * @param {object} opts گزینه‌ها — full: نمایش متن محرمانه (برای قاضی/معاونت/وکیل پذیرنده)
 */
function caseEmbed(c, opts = {}) {
  const e = baseCaseEmbed(c);
  const p = c.plaintiff;
  e.addFields(
    { name: '👤 اطلاعات شاکی', value: 'نام و نام خانوادگی و مشخصات شاکی در پرونده ثبت شده است.', inline: false },
    { name: 'نام', value: p.firstName, inline: true },
    { name: 'نام خانوادگی', value: p.lastName, inline: true },
    { name: 'نام پدر', value: p.fatherName, inline: true },
    { name: 'شناسه / کد ملی', value: p.nationalId, inline: true },
    { name: 'شماره تماس', value: p.phone, inline: true },
    { name: 'شغل / سمت', value: p.job, inline: true },
    { name: 'محل اقامت', value: p.residence, inline: false },
    { name: 'وکیل / نمایندهٔ قانونی', value: vakilStatusText(c), inline: false },
    { name: '⚠️ متشاکی(شکایت‌شده)', value: clipField(defendantBlock(c), 1020), inline: false },
    { name: '📌 موضوع شکایت / دادخواست', value: clipField(c.subject, 1020), inline: false },
    { name: '🕒 تاریخ وقوع موضوع', value: c.occurredAt, inline: true },
    { name: '📍 محل وقوع موضوع', value: c.occurredPlace, inline: true },
    { name: '🗺️ زمان و نشانی محل وقوع', value: c.occurredDetail, inline: false },
    { name: '🗂️ دلایل و شواهد', value: clipField(c.evidence), inline: false },
    { name: '📝 شرح کامل شکایت / دادخواست', value: opts.full ? clipField(c.description) : descriptionField(c), inline: false },
    { name: '🎯 خواسته / درخواست شاکی', value: c.demand, inline: false },
  );

  if (c.status === 'scheduled' && c.session) {
    e.addFields(
      {
        name: '⚖️ وقت دادگاه',
        value: `${c.session.type === 'private' ? 'جلسهٔ خصوصی' : 'جلسهٔ عمومی'} — ${c.session.atText}`,
        inline: false,
      },
    );
  }

  e.setFooter({ text: `وضعیت: ${STATUS_FA[c.status] || c.status}` });
  e.setTimestamp(c.createdAt ? new Date(c.createdAt) : undefined);
  return e;
}

/** Embed رأی نهایی (شکل تمیز برای پیام ویرایش‌شده) */
function finalRulingEmbed(c) {
  const e = new EmbedBuilder()
    .setColor(COLORS.closed)
    .setTitle(`بسمه‌تعالی — رأی نهایی پروندهٔ شمارهٔ ${fa.digits(c.number)}`)
    .setDescription(
      '**به منظور پیگیری امور قضایی و حقوقی**\n'
      + 'پروندهٔ زیر با صدور رأی نهایی بسته شد.',
    );

  const p = c.plaintiff;
  e.addFields(
    { name: '👤 شاکی', value: `${p.firstName} ${p.lastName}`, inline: true },
    { name: '⚠️ متشاکی(شکایت‌شده)', value: sessions.defendantNames(c), inline: true },
    { name: '📌 موضوع', value: c.subject, inline: false },
    { name: '📝 شرح شکایت', value: clipField(c.description), inline: false },
    { name: '🎯 خواستهٔ شاکی', value: clipField(c.demand), inline: false },
  );

  if (c.session) {
    e.addFields({
      name: '⚖️ وقت دادگاه',
      value: `${c.session.type === 'private' ? 'جلسهٔ خصوصی' : 'جلسهٔ عمومی'} — ${c.session.atText}`,
      inline: false,
    });
  }
  if (c.plaintiffVakil || c.defendantVakil) {
    e.addFields({ name: '🧑‍⚖️ وکلا', value: vakilStatusText(c), inline: false });
  }

  const outcome = c.finalRuling.outcome === 'plaintiff'
    ? '✅ پرونده به نفع شاکی ختم شد.'
    : c.finalRuling.outcome === 'defendant'
      ? '❌ پرونده به نفع متشاکی(شکایت‌شده) ختم شد.'
      : '⚖️ پرونده مختومه شد — بدون برد و باخت برای وکلای طرفین.';
  e.addFields(
    { name: '🔨 رأی نهایی قاضی', value: outcome, inline: false },
    { name: '📜 متن رأی', value: clipField(c.finalRuling.text), inline: false },
  );

  e.setFooter({ text: `وضعیت: بسته‌شده — ${STATUS_FA.closed} | تاریخ صدور: ${jalali.formatJalali(new Date(c.closedAt))}` });
  e.setTimestamp(new Date(c.closedAt));
  return e;
}

function clipField(text, max = 1020) {
  const t = String(text || '').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * شرح شکایت در embed عمومی:
 * تا پیش از پذیرش وکالت، متن کامل مخفی و فقط خلاصهٔ کوتاه نمایش داده می‌شود.
 */
function descriptionField(c) {
  if (c.status === 'closed' || c.acceptedVakil) return clipField(c.description);
  const preview = clipField(c.description, 120);
  return `🔒 **محرمانه** — متن کامل صرفاً پس از پذیرش وکالت و تنها برای وکیل پذیرنده و قاضی قابل مشاهده است.
> ${preview}`;
}

function defendantBlock(c) {
  return c.defendants.map((d, i) => {
    const n = c.defendants.length > 1 ? ` (${fa.digits(i + 1)})` : '';
    const parts = [
      `**${d.firstName} ${d.lastName}${n}**`,
      `نام پدر: ${d.fatherName}`,
      `تماس: ${d.phone}`,
      `شغل: ${d.job}`,
      `نوع ارتباط با شاکی: ${d.relation}`,
      `محل اقامت / فعالیت: ${d.place}`,
    ];
    return parts.join('\n');
  }).join('\n\n');
}

/** Embed اطلاعیهٔ جلسه (متن آماده در Description) */
function sessionAnnouncementEmbed(c) {
  const text = sessions.sessionAnnouncement(c);
  return new EmbedBuilder()
    .setColor(c.session.type === 'private' ? COLORS.private : COLORS.public)
    .setDescription(text);
}

/** Embed لیدربورد وکلا برای /list */
function vakilListEmbed(rows, { onlineMap }) {
  const e = new EmbedBuilder()
    .setColor(COLORS.list)
    .setTitle('🧑‍⚖️ فهرست وکلا — جزئیات کامل')
    .setDescription('وضعیت آنلاین فعلی، باقی‌ماندهٔ دورهٔ وکالت، آمار پرونده‌ها و شماره تماس');

  if (!rows.length) {
    e.setDescription('هنوز وکیلی ثبت نشده است. با /addvakil وکیل اضافه کنید.');
    return e;
  }

  const SEP = '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬'; // خط جداکنندهٔ بین وکلا

  rows.forEach((v, idx) => {
    const online = onlineMap[v.discordId] ? '🟢 **آنلاین**' : '⚫ آفلاین';
    const daysLeftTxt = v.active === false
      ? '⏹ دوره به پایان رسیده'
      : `📅 دورهٔ وکالت: **${fa.num(Math.ceil(vakilDaysLeft(v)))} روز** باقی‌مانده`;
    const sec = v._onlineSeconds != null ? v._onlineSeconds : (v.onlineSeconds || 0);
    const phoneTxt = v.phone ? `📞 تماس: **${fa.digits(String(v.phone))}**` : '📞 تماس: —';

    // جزئیات پرونده‌های قبول‌شده از دیتابیس واقعی پرونده‌ها
    let casesTxt;
    try {
      const recs = require('../services/vakils').acceptedCasesOf(v.discordId);
      if (!recs.length) {
        casesTxt = 'هنوز پرونده‌ای نپذیرفته است';
      } else {
        const parts = recs.slice(0, 8).map((r) => {
          const res = r.outcome === null ? '' : (r.outcome === 'dismissed' ? ' ⚖️' : (r.won ? ' 🏆' : ' 📉'));
          return `#${fa.digits(r.number)} (${r.side === 'plaintiff' ? 'شاکی' : 'متشاکی(شکایت‌شده)'})${res}`;
        });
        const extra = recs.length > 8 ? ` … و ${fa.num(recs.length - 8)} مورد دیگر` : '';
        casesTxt = `🗣 ${fa.num(recs.length)} پرونده: ${parts.join('، ')}${extra}`;
      }
    } catch (_) {
      casesTxt = `🗂 قبول‌شده: ${fa.num(v.acceptedCases || 0)} | 🏆 برد: ${fa.num(v.wins || 0)} | 📉 باخت: ${fa.num(v.losses || 0)}`;
    }

    const isLast = idx === rows.length - 1;
    e.addFields({
      name: `${online} — ${v.firstName} ${v.lastName}`,
      value: [daysLeftTxt, phoneTxt, casesTxt, isLast ? null : SEP].filter(Boolean).join('\n'),
      inline: false,
    });
  });
  return e;
}

function vakilDaysLeft(v) {
  return Math.max(0, (v.termEndsAt - Date.now()) / 86400000);
}

module.exports = {
  caseEmbed,
  finalRulingEmbed,
  sessionAnnouncementEmbed,
  vakilRequestEmbed,
  vakilListEmbed,
  STATUS_FA,
  COLORS,
};
