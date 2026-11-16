'use strict';
// Логика трея без зависимости от Electron (чтобы её можно было тестировать в чистом Node).
const { m } = require('../core/messages');

/** Подсказка над значком; у Windows лимит 127 символов. */
function trayTooltip(state, serverName) {
  const text = state === 'connected' ? m('tray_tip_connected', { server: serverName || '' })
    : state === 'connecting' ? m('tray_tip_connecting') : m('tray_tip_idle');
  return text.slice(0, 120);
}

/** Шаблон контекстного меню; h = { toggle, disconnect, quit }. */
function trayTemplate({ visible, connected }, h) {
  return [
    { label: visible ? m('tray_hide') : m('tray_show'), click: h.toggle },
    ...(connected ? [{ label: m('tray_disconnect'), click: h.disconnect }] : []),
    { type: 'separator' },
    { label: m('tray_quit'), click: h.quit }
  ];
}

/**
 * Обработчик события 'close' окна: если включено «закрытие в трей» и приложение не завершается,
 * прячет окно вместо закрытия. Подсказку «живу в трее» показывает один раз за запуск.
 */
function createCloseHandler({ isQuitting, closeToTray, hide, hint }) {
  let hinted = false;
  return e => {
    if (isQuitting() || !closeToTray()) return false;
    e.preventDefault(); hide();
    if (!hinted) { hinted = true; hint(); }
    return true;
  };
}

module.exports = { trayTooltip, trayTemplate, createCloseHandler };
