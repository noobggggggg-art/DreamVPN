'use strict';
// Язык интерфейса: сохранённый выбор, иначе по языку системы.
const I18N = (() => {
  const saved = localStorage.getItem('dreamvpn.lang');
  const guess = (navigator.language || 'en').toLowerCase().startsWith('ru') ? 'ru' : 'en';
  let lang = STRINGS[saved] ? saved : guess;
  const tr = (key, p = {}) => String(STRINGS[lang][key] ?? STRINGS.ru[key] ?? key).replace(/\{(\w+)\}/g, (_, n) => p[n] ?? '');
  function apply() {
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = tr(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = tr(el.dataset.i18nTitle); });
    document.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = tr(el.dataset.i18nPh); });
  }
  return {
    tr, apply, chosen: () => !!STRINGS[saved],
    get lang() { return lang; },
    set(l) { if (STRINGS[l]) { lang = l; localStorage.setItem('dreamvpn.lang', l); } }
  };
})();
const tr = I18N.tr;
