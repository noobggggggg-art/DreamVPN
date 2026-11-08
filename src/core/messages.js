'use strict';
// Сообщения главного процесса (ошибки и строки лога) на двух языках.
const D = {
  ru: {
    bin_missing: 'Не найден {name}. Положи его в папку bin/',
    proc_exit: '[dreamvpn] {label} завершился (код {code})',
    core_info: '[dreamvpn] ядро: {backend}, {desc}, fm: {fm}',
    fm_on: 'вкл', fm_off: 'выкл',
    cfg_path: '[dreamvpn] конфиг: {path}',
    server_addr: '[dreamvpn] адрес сервера: {ip}',
    core_died: 'Ядро завершилось сразу после запуска, см. лог',
    xray_failed: 'Xray не запустился, см. лог',
    server_not_found: 'Сервер не найден',
    sub_http: 'Подписка вернула HTTP {status}'
  },
  en: {
    bin_missing: '{name} not found. Put it in the bin/ folder',
    proc_exit: '[dreamvpn] {label} exited (code {code})',
    core_info: '[dreamvpn] core: {backend}, {desc}, fm: {fm}',
    fm_on: 'on', fm_off: 'off',
    cfg_path: '[dreamvpn] config: {path}',
    server_addr: '[dreamvpn] server address: {ip}',
    core_died: 'The core exited right after starting, see the log',
    xray_failed: 'Xray failed to start, see the log',
    server_not_found: 'Server not found',
    sub_http: 'The subscription returned HTTP {status}'
  }
};
let lang = 'ru';
const setLang = l => { if (D[l]) lang = l; };
const m = (key, p = {}) => String(D[lang][key] ?? D.ru[key] ?? key).replace(/\{(\w+)\}/g, (_, n) => p[n] ?? '');
module.exports = { setLang, m, D };
