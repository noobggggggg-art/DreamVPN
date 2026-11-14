'use strict';
const assert = require('assert'), http = require('http');
const { probe } = require('../src/core/manager');
(async () => {
  const ok = http.createServer((q, r) => { r.statusCode = 204; r.end(); });
  const hang = http.createServer(() => { /* не отвечает */ });
  await Promise.all([ok, hang].map(s => new Promise(r => s.listen(0, '127.0.0.1', r))));
  const url = s => `http://127.0.0.1:${s.address().port}/`;
  const a = await probe(url(ok), 1000);          assert.strictEqual(a.ok, true, 'ответ 204 = трафик идёт');
  const b = await probe(url(hang), 300);         assert.strictEqual(b.ok, false); assert.strictEqual(b.err, 'timeout', 'нет ответа = timeout');
  const dead = http.createServer(); await new Promise(r => dead.listen(0, '127.0.0.1', r)); const du = url(dead); await new Promise(r => dead.close(r));
  const c = await probe(du, 1000);               assert.strictEqual(c.ok, false); assert.strictEqual(c.err, 'ECONNREFUSED', 'порт закрыт = ECONNREFUSED');
  ok.close(); hang.close(); hang.closeAllConnections && hang.closeAllConnections();
  console.log('OK: проверка трафика (204 / таймаут / отказ соединения)');

  // ожидание подъёма туннеля: первые попытки неудачны, потом успех (так и ведёт себя медленный TUN)
  const os = require('os'), path = require('path'), { CoreManager } = require('../src/core/manager');
  const mk = () => { const c = new CoreManager({ binDir: 'x', dataDir: path.join(os.tmpdir(), 'dv-test') }); c.pollMs = 5; return c; };
  let n = 0, c1 = mk(); c1.probe = async () => (++n < 4 ? { ok: false, err: 'timeout' } : { ok: true, ms: 50 });
  assert.strictEqual(await c1._verify(), true, 'после нескольких неудач и успеха — true'); assert.strictEqual(n, 4);
  // нет трафика совсем: сдаёмся только по истечении времени
  const logs = []; const c2 = mk(); c2.verifyMs = 80; c2.probe = async () => ({ ok: false, err: 'timeout' }); c2.on('log', l => logs.push(l));
  assert.strictEqual(await c2._verify(), false); assert.ok(logs.some(l => /timeout/.test(l)), 'причина пишется в лог');
  // отмена во время ожидания прерывает цикл сразу
  const c3 = mk(); c3.probe = async () => { c3._abort = true; return { ok: false, err: 'timeout' }; };
  const t0 = Date.now(); assert.strictEqual(await c3._verify(), false); assert.ok(Date.now() - t0 < 500, 'отмена прерывает ожидание');
  console.log('OK: ожидание подъёма туннеля, таймаут и отмена');

  // ---------- status.json для внешних программ ----------
  const fs = require('fs'), { StatusWriter } = require('../src/core/status');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dv-status-'));
  const rd = f => JSON.parse(fs.readFileSync(f, 'utf8'));
  const KEYS = ['state', 'connected', 'server', 'country', 'core', 'pid', 'startedAt', 'updatedAt'];
  const srv = { id: 'x:1', name: 'Германия', protocol: 'vless', host: '1.2.3.4', port: 443, country: 'DE', transport: 'tcp', security: 'reality', params: {},
    geo: { lat: 52, lon: 13, countryName: 'Германия', names: { ru: 'Германия', en: 'Germany' } } };

  // 1) формат, создание вложенных папок, отсутствие временных файлов
  const f1 = path.join(tmp, 'nested', 'dir', 'status.json');
  const w = new StatusWriter(f1, { retryMs: 1 });
  w.write({ state: 'connected', server: 'S', country: 'Germany', core: 'xray', startedAt: '2026-01-01T00:00:00.000Z' });
  const j = rd(f1);
  assert.deepStrictEqual(Object.keys(j), KEYS, 'поля и их порядок как в договорённости');
  assert.strictEqual(j.state, 'connected'); assert.strictEqual(j.connected, true); assert.strictEqual(j.pid, process.pid);
  assert.strictEqual(j.startedAt, '2026-01-01T00:00:00.000Z'); assert.ok(!Number.isNaN(Date.parse(j.updatedAt)), 'updatedAt — ISO-время');
  assert.deepStrictEqual(fs.readdirSync(path.dirname(f1)), ['status.json'], 'временных файлов не осталось');
  for (const st of ['connecting', 'disconnected', 'error']) { w.write({ state: st }); assert.strictEqual(rd(f1).connected, false, st + ' => connected=false'); }

  // 2) ошибки записи только в onError, старый файл цел, tmp убран
  w.write({ state: 'connected', server: 'S', country: 'DE', core: 'xray', startedAt: null });
  const errs = []; const w2 = new StatusWriter(f1, { retryMs: 1, onError: e => errs.push(e.message) });
  assert.strictEqual(w2.write({ state: 'bogus' }), null); assert.strictEqual(errs.length, 1, 'неизвестное состояние не пишется');
  const realRename = fs.renameSync; let tries = 0;
  fs.renameSync = () => { tries++; throw Object.assign(new Error('locked'), { code: 'EPERM' }); };
  try { assert.strictEqual(w2.write({ state: 'disconnected' }), null); } finally { fs.renameSync = realRename; }
  assert.ok(tries >= 2, 'файл занят читателем — пробуем несколько раз'); assert.strictEqual(errs.length, 2, 'итоговый сбой — в onError');
  assert.strictEqual(rd(f1).state, 'connected', 'при сбое rename прежний файл не повреждён');
  assert.deepStrictEqual(fs.readdirSync(path.dirname(f1)), ['status.json'], 'tmp убран после сбоя');
  let first = true; fs.renameSync = (a, b) => { if (first) { first = false; throw Object.assign(new Error('busy'), { code: 'EBUSY' }); } return realRename(a, b); };
  try { w.write({ state: 'connecting', server: 'S', country: 'DE', core: 'xray' }); } finally { fs.renameSync = realRename; }
  assert.strictEqual(rd(f1).state, 'connecting', 'после кратковременной блокировки запись проходит');

  // 3) менеджер: переходы состояний
  const f2 = path.join(tmp, 'AppData', 'DreamVPN', 'status.json');
  const mkMgr = (file, name = 'run') => {
    const mgr = new CoreManager({ binDir: tmp, dataDir: path.join(tmp, name), statusFile: file });
    mgr.settleMs = 5; mgr.pollMs = 5; mgr.probe = async () => ({ ok: true, ms: 1 }); mgr._singbox = async () => {}; mgr._xray = async () => {};
    return mgr;
  };
  const mgr = mkMgr(f2);
  mgr.exportStatus('disconnected');
  const s0 = rd(f2);
  assert.deepStrictEqual([s0.state, s0.connected, s0.server, s0.country, s0.core, s0.startedAt], ['disconnected', false, null, null, null, null], 'при запуске приложения');
  assert.strictEqual(s0.pid, process.pid);

  const seen = []; mgr.on('state', st => seen.push(rd(f2).state));        // файл уже актуален к моменту события
  const res = await mgr.connect(srv, { core: 'singbox' });
  assert.deepStrictEqual(res, { traffic: true }); assert.deepStrictEqual(seen, ['connecting', 'connected'], 'каждая смена состояния пишется в файл');
  const s1 = rd(f2);
  assert.deepStrictEqual([s1.state, s1.connected, s1.server, s1.country, s1.core], ['connected', true, 'Германия', 'Germany', 'sing-box']);
  assert.ok(!Number.isNaN(Date.parse(s1.startedAt)), 'startedAt — ISO-время подключения');
  await mgr.connect(srv);
  assert.strictEqual(rd(f2).core, 'xray', 'VLESS в режиме «Авто» идёт через xray');
  await mgr.disconnect();
  const s2 = rd(f2);
  assert.deepStrictEqual([s2.state, s2.connected, s2.server, s2.core, s2.startedAt], ['disconnected', false, null, null, null], 'после отключения');

  // 4) сбой подключения -> error (сервер известен, connected=false), потом штатное отключение -> disconnected
  mgr._singbox = async () => { throw new Error('boom'); };
  await assert.rejects(() => mgr.connect(srv, { core: 'singbox' }), /boom/);
  const s3 = rd(f2);
  assert.deepStrictEqual([s3.state, s3.connected, s3.server, s3.startedAt], ['error', false, 'Германия', null]); assert.strictEqual(mgr.state, 'idle');
  await mgr.disconnect(); assert.strictEqual(rd(f2).state, 'disconnected');

  // 5) отмена пользователем во время подключения — это не error
  mgr._singbox = async () => {};
  mgr.probe = async () => { await mgr.disconnect(); return { ok: false, err: 'timeout' }; };
  await assert.rejects(() => mgr.connect(srv, { core: 'singbox' }), /CANCELLED/);
  assert.strictEqual(rd(f2).state, 'disconnected', 'отмена = disconnected');

  // 6) ядро умерло само при активном подключении -> error
  mgr.probe = async () => ({ ok: true, ms: 1 });
  await mgr.connect(srv, { core: 'singbox' });
  const dropped = new Promise(r => mgr.on('state', st => st === 'dropped' && r()));
  mgr._run(process.execPath, ['-e', 'process.exit(3)'], 'fake');
  await dropped;
  const s4 = rd(f2); assert.deepStrictEqual([s4.state, s4.connected, s4.startedAt, s4.server], ['error', false, null, 'Германия'], 'обрыв = error');
  await mgr.disconnect();

  // 7) сбой записи не ломает VPN: родитель целевого файла — обычный файл, папку создать нельзя
  const blocker = path.join(tmp, 'blocker'); fs.writeFileSync(blocker, 'x');
  const mgr2 = mkMgr(path.join(blocker, 'status.json'), 'run2'); const logs2 = []; mgr2.on('log', l => logs2.push(l));
  const r2 = await mgr2.connect(srv, { core: 'singbox' });
  assert.deepStrictEqual(r2, { traffic: true }); assert.strictEqual(mgr2.state, 'connected', 'подключение не сломалось');
  assert.ok(logs2.some(l => /status\.json/.test(l)), 'ошибка записи только залогирована');
  await mgr2.disconnect();

  // 8) без statusFile менеджер работает как раньше
  const mgr3 = new CoreManager({ binDir: tmp, dataDir: path.join(tmp, 'run3') });
  assert.strictEqual(mgr3.exportStatus('disconnected'), null);
  assert.deepStrictEqual(fs.readdirSync(path.dirname(f2)), ['status.json'], 'в папке статуса только status.json');
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('OK: status.json (формат, атомарность, переходы состояний, error, отмена, обрыв, сбой записи)');
})().catch(e => { console.error(e); process.exit(1); });
