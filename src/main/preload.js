'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('vpn', {
  importServers: (input, subId) => ipcRenderer.invoke('servers:import', input, subId),
  removeSub: subId => ipcRenderer.invoke('servers:remove', subId),
  connect: (id, opts) => ipcRenderer.invoke('vpn:connect', id, opts),
  disconnect: () => ipcRenderer.invoke('vpn:disconnect'),
  ping: () => ipcRenderer.invoke('servers:ping'),
  flags: codes => ipcRenderer.invoke('flags:get', codes),
  setLang: l => ipcRenderer.invoke('lang:set', l),
  version: () => ipcRenderer.invoke('app:version'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdate: cb => ipcRenderer.on('update:state', (_e, v) => cb(v)),
  world: () => ipcRenderer.invoke('world:get'),
  onState: cb => ipcRenderer.on('vpn:state', (_e, v) => cb(v)),
  onLog: cb => ipcRenderer.on('vpn:log', (_e, v) => cb(v))
});
