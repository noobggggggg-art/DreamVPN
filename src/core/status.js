'use strict';
// Экспорт статуса подключения в JSON-файл для внешних программ.
// Запись атомарная: временный файл рядом, затем rename. Ошибки наружу не бросаются — только onError.
const fs = require('fs');
const path = require('path');

const STATES = ['connected', 'connecting', 'disconnected', 'error'];
const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);       // Windows: читатель держит файл открытым
const sleepSync = ms => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* нет SAB — без паузы */ } };

class StatusWriter {
  constructor(file, { pid = process.pid, onError = () => {}, attempts = 4, retryMs = 15 } = {}) {
    this.file = file; this.pid = pid; this.onError = onError; this.attempts = attempts; this.retryMs = retryMs;
  }

  /** Документ строго в согласованном формате и порядке полей. */
  build({ state, server = null, country = null, core = null, startedAt = null }) {
    if (!STATES.includes(state)) throw new Error(`unknown state: ${state}`);
    return {
      state, connected: state === 'connected',
      server, country, core,
      pid: this.pid, startedAt,
      updatedAt: new Date().toISOString()
    };
  }

  /** Возвращает записанный документ или null (если запись не удалась). Исключений не бросает. */
  write(info) {
    const tmp = `${this.file}.${this.pid}.tmp`;
    try {
      const doc = this.build(info);
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(doc, null, 2));
      for (let i = 1; ; i++) {
        try { fs.renameSync(tmp, this.file); return doc; }
        catch (e) { if (i >= this.attempts || !RETRY_CODES.has(e.code)) throw e; sleepSync(this.retryMs); }
      }
    } catch (e) {
      try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
      try { this.onError(e); } catch { /* ignore */ }
      return null;
    }
  }
}

module.exports = { StatusWriter, STATES };
