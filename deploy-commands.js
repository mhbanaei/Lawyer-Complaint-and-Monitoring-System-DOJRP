'use strict';

/** ثبت کامندهای اسلش در دیسکورد — نیازمند CLIENT_ID در .env */

const { REST, Routes } = require('discord.js');
const cfg = require('./src/config');

if (!process.env.CLIENT_ID) {
  console.error('❌ متغیر CLIENT_ID در .env تنظیم نشده است. (Application ID از Developer Portal)');
  process.exit(1);
}

const commands = [];
commands.push(require('./src/commands/shekayat').data.toJSON());
for (const c of require('./src/commands/vakilAdmin')) commands.push(c.data.toJSON());
commands.push(require('./src/commands/list').data.toJSON());

const rest = new REST({ version: '10' }).setToken(cfg.token);

(async () => {
  try {
    console.log(`شروع ثبت ${commands.length} کامند اسلش...`);
    const data = await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    console.log(`✅ ${data.length} کامند با موفقیت ثبت شد.`);
  } catch (e) {
    console.error('❌ خطا در ثبت کامندها:', e);
    process.exitCode = 1;
  }
})();
