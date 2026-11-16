'use strict';
const assert = require('assert');
const { setLang } = require('../src/core/messages');
const { trayTooltip, trayTemplate, createCloseHandler } = require('../src/main/tray');

// ---------- подсказка над значком ----------
setLang('ru');
assert.match(trayTooltip('idle'), /не подключено/); assert.match(trayTooltip(undefined), /не подключено/, 'до появления менеджера — как «не подключено»');
assert.match(trayTooltip('connecting'), /подключение/); assert.match(trayTooltip('connected', 'Германия'), /подключено.*Германия/);
setLang('en');
assert.match(trayTooltip('connected', 'Germany'), /connected.*Germany/); assert.match(trayTooltip('idle'), /not connected/);
assert.ok(trayTooltip('connected', 'x'.repeat(500)).length <= 120, 'у подсказки Windows лимит 127 символов');

// ---------- меню ----------
const h = { toggle() {}, disconnect() {}, quit() {} };
let t = trayTemplate({ visible: true, connected: false }, h);
assert.deepStrictEqual(t.map(i => i.label || i.type), ['Hide window', 'separator', 'Quit'], 'без подключения пункта «Отключить» нет');
assert.strictEqual(t[0].click, h.toggle); assert.strictEqual(t[2].click, h.quit);
t = trayTemplate({ visible: false, connected: true }, h);
assert.deepStrictEqual(t.map(i => i.label || i.type), ['Show window', 'Disconnect VPN', 'separator', 'Quit'], 'при подключении появляется «Отключить VPN»');
assert.strictEqual(t[1].click, h.disconnect);
setLang('ru');
assert.deepStrictEqual(trayTemplate({ visible: true, connected: true }, h).map(i => i.label || i.type), ['Скрыть окно', 'Отключить VPN', 'separator', 'Выход']);

// ---------- крестик окна ----------
function mk(state) {
  const calls = { hide: 0, hint: 0, prevented: 0 };
  const f = createCloseHandler({ isQuitting: () => state.quitting, closeToTray: () => state.toTray, hide: () => calls.hide++, hint: () => calls.hint++ });
  return { f, calls, ev: { preventDefault: () => calls.prevented++ } };
}
let st = { quitting: false, toTray: true }, { f, calls, ev } = mk(st);
assert.strictEqual(f(ev), true, 'крестик при включённой настройке прячет окно');
assert.deepStrictEqual(calls, { hide: 1, hint: 1, prevented: 1 });
f(ev); assert.deepStrictEqual(calls, { hide: 2, hint: 1, prevented: 2 }, 'подсказка «живу в трее» только один раз');
st.toTray = false; assert.strictEqual(f(ev), false, 'настройка выключена — окно закрывается по-настоящему'); assert.strictEqual(calls.prevented, 2);
st.toTray = true; st.quitting = true; assert.strictEqual(f(ev), false, 'при выходе из приложения окно не прячем (иначе программа не завершится)'); assert.strictEqual(calls.prevented, 2);
// нет значка в трее -> настройка не должна прятать окно (его было бы не вернуть)
({ f, calls, ev } = mk({ quitting: false, toTray: false })); assert.strictEqual(f(ev), false); assert.strictEqual(calls.hide, 0);

console.log('OK: трей (подсказка, меню, поведение крестика)');
