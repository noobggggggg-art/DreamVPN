'use strict';
const assert = require('assert'), fs = require('fs');
const S = require('../src/renderer/strings.js'), { D } = require('../src/core/messages.js');
const keys = o => Object.keys(o).sort();
const ph = s => (s.match(/\{\w+\}/g) || []).sort();

for (const [name, dict] of [['интерфейс', S], ['главный процесс', D]]) {
  assert.deepStrictEqual(keys(dict.ru), keys(dict.en), `${name}: наборы ключей ru и en различаются`);
  for (const k of keys(dict.ru)) assert.deepStrictEqual(ph(dict.ru[k]), ph(dict.en[k]), `${name}: плейсхолдеры в «${k}» не совпадают`);
  for (const k of keys(dict.en)) assert.ok(dict.en[k].trim() && !/[А-Яа-яЁё]/.test(dict.en[k]), `${name}: английский текст «${k}» пуст или содержит кириллицу`);
}

const html = fs.readFileSync('src/renderer/index.html', 'utf8'), js = fs.readFileSync('src/renderer/renderer.js', 'utf8');
const used = new Set([...html.matchAll(/data-i18n(?:-title|-ph)?="(\w+)"/g)].map(m => m[1]));
for (const m of js.matchAll(/\btr\('(\w+)'/g)) used.add(m[1]);
for (const m of js.matchAll(/\btr\([^()]*?\?\s*'(\w+)'\s*:\s*'(\w+)'/g)) { used.add(m[1]); used.add(m[2]); }
assert.deepStrictEqual([...used].filter(k => !(k in S.ru)), [], 'в коде есть ключи, которых нет в strings.js');

// в коде не должно остаться русских строк (комментарии не считаем)
const strip = t => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
for (const f of ['src/renderer/renderer.js', 'src/renderer/map.js', 'src/main/main.js', 'src/core/manager.js'])
  assert.ok(!/[А-Яа-яЁё]/.test(strip(fs.readFileSync(f, 'utf8'))), `${f}: осталась захардкоженная кириллица`);
const htmlNoPick = html.replace(/<div id="langpick"[\s\S]*?<\/div>\s*<\/div>/, '').replace(/<div class="seg" id="langs">[\s\S]*?<\/div>/, '');
assert.ok(!/[А-Яа-яЁё]/.test(htmlNoPick), 'index.html: осталась захардкоженная кириллица');
console.log('OK: i18n (ключи ru/en совпадают, строк без перевода нет)');
