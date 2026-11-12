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
})().catch(e => { console.error(e); process.exit(1); });
