'use strict';

/**
 * ثبت کامندهای اسلش در دیسکورد
 * Application ID از خودِ توکن استخراج می‌شود (بخش اول توکن = app id کدشده)
 * → دیگر CLIENT_ID دستی لازم نیست و خطای 20012 (ناهم‌خوانی توکن/CLIENT_ID) رخ نمی‌دهد.
 */

const { REST, Routes } = require('discord.js');
const cfg = require('./src/config');

/** استخراج Application ID از توکن */
function appIdFromToken(token) {
  try {
    const seg = String(token || '').split('.')[0];
    const id = Buffer.from(seg, 'base64').toString('utf8');
    return /^[0-9]{15,25}$/.test(id) ? id : null;
  } catch (_) { return null; }
}

if (!cfg.token) {
  console.error('BOT_TOKEN dar .env Tarif Nashode Ast');
  process.exit(1);
}

const appId = appIdFromToken(cfg.token);
if (!appId) {
  console.error('Application ID az token khvand nashod — token namotabar ast!');
  process.exit(1);
}

const commands = [];
commands.push(require('./src/commands/shekayat').data.toJSON());
for (const c of require('./src/commands/vakilAdmin')) commands.push(c.data.toJSON());
commands.push(require('./src/commands/list').data.toJSON());
commands.push(require('./src/commands/announce').data.toJSON());

const rest = new REST({ version: '10' }).setToken(cfg.token);

(async () => {
  try {
    console.log(`Shoroo-e sabt-e ${commands.length} command baraye application ${appId}...`);
    const data = await rest.put(Routes.applicationCommands(appId), { body: commands });
    console.log(`OK: ${data.length} command ba movafaghiyat sabt shod.`);
  } catch (e) {
    console.error('Khat dar sabt-e command:', e.code ? `${e.code} — ${e.message}` : e);
    process.exitCode = 1;
  }
})();
