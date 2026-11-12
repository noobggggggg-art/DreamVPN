'use strict';
const { spawn } = require('child_process');
const https = require('https');
const http = require('http');
const { EventEmitter } = require('events');
const dns = require('dns').promises;
const fs = require('fs');
const path = require('path');
const { pickBackend } = require('../parser');
const { buildSingboxConfig } = require('./singbox');
const { buildXrayConfig, SOCKS_PORT } = require('./xray');
const { m } = require('./messages');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Два адреса: по IP (без DNS) и по имени. Хватает любого из них.
const PROBES = ['https://1.1.1.1/cdn-cgi/trace', 'https://www.gstatic.com/generate_204'];

/** Один запрос к «пустому» адресу проверки связи; идёт по обычным маршрутам системы, то есть через туннель. */
function probe(url = 'https://www.gstatic.com/generate_204', timeout = 4000) {
  return new Promise(resolve => {
    const t0 = Date.now();
    const req = (url.startsWith('https') ? https : http).get(url, { timeout }, res => {
      res.resume();
      resolve({ ok: res.statusCode >= 200 && res.statusCode < 400, ms: Date.now() - t0, status: res.statusCode });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', e => resolve({ ok: false, err: e.code || e.message }));
  });
}

class CoreManager extends EventEmitter {
  constructor({ binDir, dataDir }) {
    super();
    this.binDir = binDir; this.dataDir = dataDir;
    this.procs = []; this.state = 'idle'; this.current = null; this._abort = false;
    this.probe = probe; this.verifyMs = 45000; this.pollMs = 1000;      // настраиваются в тестах
    fs.mkdirSync(dataDir, { recursive: true });
  }

  _bin(name) {
    const p = path.join(this.binDir, name);
    if (!fs.existsSync(p)) throw new Error(m('bin_missing', { name }));
    return p;
  }

  _run(exe, args, label) {
    const proc = spawn(exe, args, { windowsHide: true, cwd: this.binDir });
    const log = d => this.emit('log', d.toString());
    proc.stdout.on('data', log); proc.stderr.on('data', log);
    proc.on('exit', code => {
      this.emit('log', m('proc_exit', { label, code: code ?? '-' }) + '\n');
      if (this.state === 'connected') { this.state = 'idle'; this.emit('state', 'dropped', code); }
    });
    this.procs.push(proc);
    return proc;
  }

  async connect(server, opts = {}) {
    await this.disconnect();
    this._abort = false;
    this._set('connecting');
    try {
      const backend = pickBackend(server, opts.core);
      this.emit('log', m('core_info', {
        backend, desc: `${server.protocol}/${server.security}/${server.transport} ${server.host}:${server.port}`,
        fm: opts.fragment && server.fragment ? m('fm_on') : m('fm_off')
      }) + '\n');
      if (backend === 'singbox') await this._singbox(server, opts); else await this._xray(server, opts);
      await sleep(1500);
      if (this._abort) throw new Error('CANCELLED');
      if (this.procs.some(p => p.exitCode !== null)) throw new Error(m('core_died'));
      const traffic = await this._verify();
      if (this._abort) throw new Error('CANCELLED');
      this.current = server; this._set('connected');
      return { traffic };
    } catch (e) {
      await this.disconnect(); this._set('idle'); throw e;
    }
  }

  /** Ядра запущены — но идёт ли трафик? TUN-адаптер в Windows бывает поднимается больше 10 секунд, поэтому ждём до verifyMs. */
  async _verify() {
    const t0 = Date.now(); let last = {}, i = 0;
    while (Date.now() - t0 < this.verifyMs && !this._abort) {
      last = await this.probe(PROBES[i++ % PROBES.length], 3000);
      if (last.ok) { this.emit('log', m('traffic_ok', { ms: Date.now() - t0 }) + '\n'); return true; }
      if (this.procs.some(p => p.exitCode !== null)) break;
      await sleep(this.pollMs);
    }
    if (this._abort) return false;
    this.emit('log', m('traffic_fail', { err: last.err || `HTTP ${last.status}` }) + '\n');
    return false;
  }

  _writeCfg(name, cfg) {
    const p = path.join(this.dataDir, name);
    fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
    this.emit('log', m('cfg_path', { path: p }) + '\n');
    return p;
  }

  async _singbox(server, opts) {
    this._run(this._bin('sing-box.exe'), ['run', '-c', this._writeCfg('singbox.json', buildSingboxConfig(server, opts))], 'sing-box');
  }

  /** Xray = прокси (SOCKS на 127.0.0.1), sing-box = только TUN/маршруты/DNS поверх этого SOCKS. */
  async _xray(server, opts) {
    const xrayExe = this._bin('xray.exe'), sbExe = this._bin('sing-box.exe'); this._bin('wintun.dll');
    const ip = /^\d+\.\d+\.\d+\.\d+$/.test(server.host) ? server.host : (await dns.lookup(server.host, { family: 4 })).address;
    this.emit('log', m('server_addr', { ip }) + '\n');

    this._run(xrayExe, ['run', '-c', this._writeCfg('xray.json', buildXrayConfig({ ...server, host: ip }, opts))], 'xray');
    await sleep(900);
    if (this._abort) throw new Error('CANCELLED');
    if (this.procs[0].exitCode !== null) throw new Error(m('xray_failed'));

    const tunCfg = buildSingboxConfig(server, { ...opts, upstream: { port: SOCKS_PORT, bypass: [ip] } });
    this._run(sbExe, ['run', '-c', this._writeCfg('singbox-tun.json', tunCfg)], 'sing-box (TUN)');
  }

  async disconnect() {
    this._abort = true;                              // прерывает идущее подключение
    const procs = this.procs;
    this.procs = []; this.current = null;
    if (this.state === 'connected') this.state = 'idle';
    procs.reverse().forEach(p => { try { p.kill(); } catch { /* already dead */ } });
  }

  _set(s) { this.state = s; this.emit('state', s); }
}

module.exports = { CoreManager, probe };
