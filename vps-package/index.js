'use strict';

/** نقطهٔ ورود ربات دیسکورد شکایات ParadiseRP */

const {Client, GatewayIntentBits, Partials, Events, MessageFlags } = require('discord.js');
require('dotenv').config(); // قبل از SSL — تا SSL_DOMAIN از .env خوانده شود
const ssl = require('./src/ssl');

// 🔐 SSL خودکار: در صورت تنظیم SSL_DOMAIN، گواهی Let's Encrypt در استارت گرفته/تمدید می‌شود
// (قبل از بارگذاری config و وب‌سرور تا HTTPS با گواهی تازه بالا بیاید)
ssl.setup().catch((e) => console.error('[SSL] Khata:', e.message));

const cfg = require('./src/config');
const fa = require('./src/fa');

// ⏱ درج ساعت در همهٔ لاگ‌ها برای پیگیری زنده در کنسول
const _log = console.log.bind(console);
const _err = console.error.bind(console);
const _now = () => new Date().toLocaleTimeString('en-GB', { hour12: false }); // ASCII — baraye namayesh-e dorost dar CMD/VPS
console.log = (...a) => _log(`[${_now()}]`, ...a);
console.error = (...a) => _err(`[${_now()}]`, ...a);

// 🔒 قفل تک‌نمونه‌ای: اجازهٔ اجرا فقط برای یک ربات — دابل‌کلیک‌های اضافه بی‌اثر می‌شوند
const net = require('net');
const instanceLock = net.createServer();
instanceLock.on('error', () => {
  console.error('⛔ Bot ghablan dar yek panjareye digar dar hale ejrast!');
  console.error('   In panjare ra bebandid, ya avval panjareye ghabli ra khamoosh konid.');
  process.exit(2);
});
instanceLock.listen(49160, '127.0.0.1');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // برای رأی/خواسته‌های بلند لازم نیست ولی بی‌ضرر است
  ],
  partials: [Partials.Channel], // برای DM
});

const commands = new Map();
commands.set('shekayat', require('./src/commands/shekayat'));
for (const c of require('./src/commands/vakilAdmin')) commands.set(c.data.name, c);
commands.set('list', require('./src/commands/list'));
commands.set('announce', require('./src/commands/announce'));

const players = require('./src/services/players');

const formHandler = require('./src/handlers/formHandler');
const judgeHandler = require('./src/handlers/judgeHandler');
const vakilHandler = require('./src/handlers/vakilHandler');

client.once(Events.ClientReady, (c) => {
  console.log(`✅ Bot online shod: ${c.user.tag}`);
  vakilsSweep();
  players.startOnlinePolling();
  setInterval(vakilsSweep, 60 * 60 * 1000).unref();

  // 🌐 وب‌سرور فرم شکایت (طرح رسمی HTML) — از داخل دیسکورد با /shekayat لینک می‌گیرید
  try {
    require('./src/webserver').start(client);
  } catch (e) {
    console.error('⚠️ Webserver form ejra nashod:', e.message);
  }

  // ⌛ رد خودکار پیشنهادهای وکالت ۱۲ ساعتهٔ منقضی‌شده (هر ۵ دقیقه)
  const vakilRequestSweep = () => {
    try { require('./src/handlers/vakilHandler').sweepPendingRequests(c).catch(() => {}); } catch (_) { /* noop */ }
  };
  vakilRequestSweep();
  setInterval(vakilRequestSweep, 5 * 60 * 1000).unref();

  // 💓 ضربان: هر ۵ دقیقه نشان می‌دهد که ربات زنده است
  const bootTime = Date.now();
  setInterval(() => {
    const mins = Math.floor((Date.now() - bootTime) / 60000);
    console.log(`🟢 Bot dar hale ejrast — ${mins} daghighe bedoone ghati`);
  }, 5 * 60 * 1000).unref();
});

function vakilsSweep() {
  try { require('./src/services/vakils').sweepExpired(); } catch (_) { /* noop */ }
}

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // کامندهای اسلش
    if (interaction.isChatInputCommand()) {
      const cmd = commands.get(interaction.commandName);
      if (!cmd) return;
      return await cmd.execute(interaction);
    }

    // مودال‌های فرم شکایت
    if (interaction.isModalSubmit() && interaction.customId.startsWith('paradise:form:modal:')) {
      return await formHandler.onModal(interaction);
    }

    // مودال رأی قاضی
    if (interaction.isModalSubmit() && interaction.customId.startsWith('paradise:judge:rule:modal:')) {
      return await judgeHandler.onModal(interaction);
    }

    // مودال اطلاعیه به وکلا (/announce)
    if (interaction.isModalSubmit() && interaction.customId === 'paradise:announce:modal') {
      return await require('./src/commands/announce').onModal(interaction);
    }

    // دکمه‌ها و منوها
    if (interaction.isButton() || interaction.isStringSelectMenu()) {
      const [ns] = interaction.customId.split(':');
      if (ns !== 'paradise') return;

      if (interaction.customId.startsWith('paradise:form:')) {
        return await formHandler.onComponent(interaction);
      }
      if (interaction.customId.startsWith('paradise:judge:')) {
        return await judgeHandler.onComponent(interaction);
      }
      if (interaction.customId.startsWith('paradise:vakil:')) {
        return await vakilHandler.onComponent(interaction);
      }
      if (interaction.customId.startsWith('paradise:announce:')) {
        return await require('./src/commands/announce').onComponent(interaction);
      }
    }

    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '⛔ اینتراکشن نامعتبر است.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  } catch (e) {
    console.error('❌ Khata dar pardazesh interaction:', e);
    const payload = { content: '⚠️ خطایی رخ داد. دوباره تلاش کنید.', flags: MessageFlags.Ephemeral };
    if (interaction.isRepliable() && !interaction.replied) {
      await interaction.reply(payload).catch(() => {});
    } else if (interaction.isRepliable() && interaction.deferred) {
      await interaction.editReply(payload).catch(() => {});
    }
  }
});

// ذخیرهٔ امن داده‌ها هنگام خاموشی
function shutdown(signal) {
  console.log(`\n⏳ Khamooshi (${signal})...`);
  try {
    players.flushOnExit();
    require('./src/services/cases').flush();
    require('./src/services/vakils').flush();
  } catch (_) { /* noop */ }
  client.destroy();
  process.exit(signal === 'SIGINT' ? 130 : 0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// کد ۱۳۰ = توقف توسط کاربر (Ctrl+C) — تا start.bat لوپ نزند

if (require.main === module) {
  // 🏛️ بنر فارسی — چاپ مستقیم (خروجی UTF-8 در کنسول درست نمایش داده می‌شود)
  _log('============================================================');
  _log('   🏛️  Bot-e Shekayat va Dadgah — ParadiseRP');
  _log('   * In panjare ra baz negah darid; ta baz ast, bot online ast.');
  _log('   * Khamoosh kardan: Ctrl+C va bad Y (ya bastan-e hamin panjare)');
  _log('============================================================');
  client.login(cfg.token).catch((e) => {
    console.error('❌ Vorood namovafagh:', e.message);
    // ۳ = توکن نامعتبر (بدون ری‌استارت خودکار) | ۱ = خطای موقت (ری‌استارت خودکار)
    process.exit(e && e.code === 'TokenInvalid' ? 3 : 1);
  });
}

module.exports = { client };
