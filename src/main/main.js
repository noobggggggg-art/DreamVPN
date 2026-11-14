'use strict';
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { execSync, spawn } = require('child_process');
const { importAny } = require('../parser');
const { CoreManager } = require('../core/manager');
const { setLang, m } = require('../core/messages');

let win, core;
const subs = new Map();                       // id подписки -> серверы
const allServers = () => [...subs.values()].flat();

/** fltmc отрабатывает без ошибки только в процессе с правами администратора. */
function isAdmin() {
  if (process.platform !== 'win32') return true;
  try { execSync('fltmc', { stdio: 'ignore' }); return true; } catch { return false; }
}

/** Перезапуск с запросом UAC (нужно в dev; в сборке это делает манифест). */
function relaunchElevated() {
  const arg = app.isPackaged ? '' : ` -ArgumentList '\"${app.getAppPath()}\"'`;
  const ps = `Start-Process -FilePath '${process.execPath}'${arg} -Verb RunAs`;
  spawn('powershell', ['-NoProfile', '-Command', ps], { detached: true, stdio: 'ignore' }).unref();
  app.quit();
}

/** Время TCP-подключения к host:port в мс, null — недоступен. */
function tcpPing(host, port, timeout = 3000) {
  return new Promise(resolve => {
    const t = Date.now(), sock = net.connect({ host, port, timeout });
    sock.once('connect', () => { const ms = Date.now() - t; sock.destroy(); resolve(ms); });
    sock.once('timeout', () => { sock.destroy(); resolve(null); });
    sock.once('error', () => resolve(null));
  });
}

/** Флаги берём из пакета flag-icons и отдаём как data: URI (без проблем с путями и CSP). */
const flagCache = {};
function flagDataUri(cc) {
  if (!/^[A-Z]{2}$/.test(cc)) return null;
  if (cc in flagCache) return flagCache[cc];
  try {
    const f = path.join(app.getAppPath(), 'node_modules', 'flag-icons', 'flags', '4x3', cc.toLowerCase() + '.svg');
    return (flagCache[cc] = 'data:image/svg+xml;base64,' + fs.readFileSync(f).toString('base64'));
  } catch { return (flagCache[cc] = null); }
}

/** Автообновление (electron-updater). Работает только в собранной версии и только если в package.json
 *  (build.publish.url) указан реальный адрес — заглушку CHANGE-ME мы считаем «не настроено». */
let autoUpdater = null;
const sendUpdate = p => win?.webContents.send('update:state', p);
function updatesConfigured() {
  try { return !/CHANGE-ME/.test(fs.readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf8')); } catch { return false; }
}
function setupUpdater() {
  if (!app.isPackaged || !updatesConfigured()) return;
  try { ({ autoUpdater } = require('electron-updater')); } catch { return; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => sendUpdate({ state: 'checking' }));
  autoUpdater.on('update-available', i => sendUpdate({ state: 'available', version: i.version }));
  autoUpdater.on('update-not-available', () => sendUpdate({ state: 'none' }));
  autoUpdater.on('download-progress', p => sendUpdate({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', i => sendUpdate({ state: 'ready', version: i.version }));
  autoUpdater.on('error', e => sendUpdate({ state: 'error', message: String(e?.message || e).split('\n')[0].slice(0, 160) }));
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 10000); setInterval(check, 6 * 3600 * 1000);
}

function createWindow() {
  win = new BrowserWindow({
    title: 'DreamVPN', icon: path.join(__dirname, '../../build/icon.ico'),
    width: 1100, height: 720, backgroundColor: '#05070d', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.loadFile(path.join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(() => {
  if (!isAdmin()) { relaunchElevated(); return; }
  const binDir = app.isPackaged ? path.join(process.resourcesPath, 'bin') : path.join(__dirname, '../../bin');
  core = new CoreManager({
    binDir, dataDir: path.join(app.getPath('userData'), 'run'),
    statusFile: path.join(app.getPath('appData'), 'DreamVPN', 'status.json')   // для внешних программ
  });
  core.on('state', (s, code) => win?.webContents.send('vpn:state', { state: s, code }));
  core.on('log', l => win?.webContents.send('vpn:log', l));
  core.exportStatus('disconnected');                                            // приложение запущено, VPN выключен

  ipcMain.handle('servers:import', async (_e, input, subId) => {
    let res;
    try { res = await importAny(input); }
    catch (e) { if (e.code === 'HTTP') throw new Error(m('sub_http', { status: e.status })); throw e; }
    const list = res.servers.map(s => ({ ...s, id: `${subId}:${s.id}`, sub: subId }));
    subs.set(subId, list);
    return { servers: list.map(({ raw, secret, ...pub }) => pub), userinfo: res.userinfo, title: res.title };
  });
  ipcMain.handle('servers:remove', (_e, subId) => { subs.delete(subId); });
  ipcMain.handle('vpn:connect', async (_e, id, opts) => {
    const s = allServers().find(x => x.id === id);
    if (!s) throw new Error(m('server_not_found'));
    return await core.connect(s, opts || {});
  });
  ipcMain.handle('vpn:disconnect', () => core.disconnect());
  ipcMain.handle('servers:ping', async () => {
    const out = {};
    await Promise.all(allServers().map(async s => { out[s.id] = s.protocol === 'hysteria2' ? -1 : await tcpPing(s.host, s.port); }));
    return out;
  });
  ipcMain.handle('flags:get', (_e, codes) => Object.fromEntries((codes || []).map(c => [c, flagDataUri(c)])));
  ipcMain.handle('world:get', () => require('world-atlas/countries-110m.json'));

  ipcMain.handle('lang:set', (_e, l) => { setLang(l); });
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('update:check', async () => {
    if (!app.isPackaged) return { state: 'dev' };
    if (!autoUpdater) return { state: 'off' };
    try { await autoUpdater.checkForUpdates(); return null; }   // итог придёт событием, ответ его не перетирает
    catch (e) { return { state: 'error', message: String(e?.message || e).split('\n')[0].slice(0, 160) }; }
  });
  ipcMain.handle('update:install', () => { autoUpdater?.quitAndInstall(); });

  createWindow();
  setupUpdater();
});

app.on('before-quit', () => { core?.disconnect(); core?.exportStatus('disconnected'); });
app.on('window-all-closed', () => app.quit());
