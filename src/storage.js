'use strict';

/**
 * ذخیره‌سازی فایل JSON اتمی + نگهداری در حافظه
 * هر سرویس یک «جدول» از این کلاس می‌سازد.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(process.cwd(), 'data');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

class JsonTable {
  /**
   * @param {string} name نام فایل (بدون پسوند)
   * @param {object|Array} defaultValue مقدار اولیه
   */
  constructor(name, defaultValue) {
    this.file = path.join(DATA_DIR, `${name}.json`);
    this.defaultValue = defaultValue;
    this.data = this.load();
    // نگه‌داشتن هندل تایمر برای ذخیرهٔ debounce شده
    this._timer = null;
    this._dirty = false;
  }

  load() {
    try {
      if (fs.existsSync(this.file)) {
        const raw = fs.readFileSync(this.file, 'utf8');
        return JSON.parse(raw);
      }
    } catch (e) {
      console.error(`⚠️ Khataye khandan ${this.file}: ${e.message} — ba meghdare pishfarz edame midahim.`);
      // نسخهٔ پشتیبان از دادهٔ خراب نگه می‌داریم
      try { fs.copyFileSync(this.file, `${this.file}.corrupt-${Date.now()}`); } catch (_) { /* noop */ }
    }
    return typeof this.defaultValue === 'object' && this.defaultValue !== null
      ? JSON.parse(JSON.stringify(this.defaultValue))
      : this.defaultValue;
  }

  /** ذخیرهٔ فوری (اتمیک: temp + rename) */
  flush() {
    ensureDataDir();
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
    this._dirty = false;
  }

  /** ذخیرهٔ با تأخیر کوتاه تا چند تغییر پشت‌سرهم یک بار نوشته شود */
  save() {
    this._dirty = true;
    if (this._timer) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      if (!this._dirty) return;
      try { this.flush(); } catch (e) {
        console.error(`⚠️ Khataye zakhire ${this.file}: ${e.message}`);
      }
    }, 400);
    if (this._timer.unref) this._timer.unref();
  }
}

ensureDataDir();

module.exports = { JsonTable, DATA_DIR };
