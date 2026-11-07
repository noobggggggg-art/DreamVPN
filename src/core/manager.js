'use strict';
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const dns = require('dns').promises;
const fs = require('fs');
const path = require('path');
const { pickBackend } = require('../parser');
const { buildSingboxConfig } = require('./singbox');
const { buildXrayConfig, SOCKS_PORT } = require('./xray');

const sleep = ms => new Promise(r => setTimeout(r, ms));

class CoreManager extends EventEmitter {
  constructor({ binDir, dataDir }) {
    super();
    this.binDir = binDir; this.dataDir = dataDir;
    this.procs = []; this.state = 'idle'; this.current = null;
    fs.mkdirSync(dataDir, { recursive: true });
  }

  _bin(name) {
    const p = path.join(this.binDir, name);
    if (!fs.existsSync(p)) throw new Error(`Не найден ${name}. Положи его в папку bin/`);
    return p;
  }

  _run(exe, args, label) {
    const proc = spawn(exe, args, { windowsHide: true, cwd: this.binDir });
    const log = d => this.emit('log', d.toString());
    proc.stdout.on('data', log); proc.stderr.on('data', log);
    proc.on('exit', code => {
      this.emit('log', `[dreamvpn] ${label} завершился (код ${code})\n`);
      if (this.state === 'connected') { this.state = 'idle'; this.emit('state', 'dropped', code); }
    });
    this.procs.push(proc);
    return proc;
  }

  async connect(server, opts = {}) {
    await this.disconnect();
    this._set('connecting');
    try {
      const backend = pickBackend(server, opts.core);
      this.emit('log', `[dreamvpn] ядро: ${backend}, ${server.protocol}/${server.security}/${server.transport} ${server.host}:${server.port}, fm: ${opts.fragment && server.fragment ? 'вкл' : 'выкл'}\n`);
      if (backend === 'singbox') await this._singbox(server, opts); else await this._xray(server, opts);
      await sleep(1500);
      const dead = this.procs.find(p => p.exitCode !== null);
      if (dead) throw new Error('Ядро завершилось сразу после запуска, см. лог');
      this.current = server; this._set('connected');
    } catch (e) {
      await this.disconnect(); this._set('idle'); throw e;
    }
  }

  _writeCfg(name, cfg) {
    const p = path.join(this.dataDir, name);
    fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
    this.emit('log', `[dreamvpn] конфиг: ${p}\n`);
    return p;
  }

  async _singbox(server, opts) {
    this._run(this._bin('sing-box.exe'), ['run', '-c', this._writeCfg('singbox.json', buildSingboxConfig(server, opts))], 'sing-box');
  }

  /** Xray = прокси (SOCKS на 127.0.0.1), sing-box = только TUN/маршруты/DNS поверх этого SOCKS. */
  async _xray(server, opts) {
    const xrayExe = this._bin('xray.exe'), sbExe = this._bin('sing-box.exe'); this._bin('wintun.dll');
    const ip = /^\d+\.\d+\.\d+\.\d+$/.test(server.host) ? server.host : (await dns.lookup(server.host, { family: 4 })).address;
    this.emit('log', `[dreamvpn] адрес сервера: ${ip}\n`);

    this._run(xrayExe, ['run', '-c', this._writeCfg('xray.json', buildXrayConfig({ ...server, host: ip }, opts))], 'xray');
    await sleep(900);
    if (this.procs[0].exitCode !== null) throw new Error('Xray не запустился, см. лог');

    const tunCfg = buildSingboxConfig(server, { ...opts, upstream: { port: SOCKS_PORT, bypass: [ip] } });
    this._run(sbExe, ['run', '-c', this._writeCfg('singbox-tun.json', tunCfg)], 'sing-box (TUN)');
  }

  async disconnect() {
    const procs = this.procs;
    this.procs = []; this.current = null;
    if (this.state === 'connected') this.state = 'idle';
    procs.reverse().forEach(p => { try { p.kill(); } catch { /* уже мёртв */ } });
  }

  _set(s) { this.state = s; this.emit('state', s); }
}

module.exports = { CoreManager };
