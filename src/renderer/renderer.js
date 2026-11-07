'use strict';
const $ = s => document.querySelector(s);

let servers = [], selected = null, prev = null, state = 'idle', connectedId = null, pings = {};
let subs = [], serversBySub = {}, flagUrls = {};

// ---------- глобус ----------
const globe = Globe()($('#globe'))
  .backgroundColor('rgba(0,0,0,0)')
  .atmosphereColor('#4aa3ff').atmosphereAltitude(0.2)
  .pointLat(d => d.geo.lat).pointLng(d => d.geo.lon).pointAltitude(0.012).pointRadius(0.38).pointResolution(20)
  .pointColor(d => d.ids.includes(connectedId) ? '#3ddc97' : d.ids.includes(selected?.id) ? '#ffffff' : '#ffb454')
  .pointLabel(d => `<div style="padding:4px 8px;background:#0c111e;border:1px solid #2a3552;border-radius:8px;color:#d7e0f3">${d.label} · серверов: ${d.ids.length}</div>`)
  .onPointClick(d => select(d.servers.find(x => x.id === selected?.id) || d.servers[0]))
  .arcStartLat(d => d.a.lat).arcStartLng(d => d.a.lon).arcEndLat(d => d.b.lat).arcEndLng(d => d.b.lon)
  .arcColor(() => ['#4aa3ff', '#3ddc97']).arcStroke(0.6).arcDashLength(0.4).arcDashGap(0.2)
  .arcDashAnimateTime(1500).arcsTransitionDuration(0)
  .ringLat(d => d.geo.lat).ringLng(d => d.geo.lon).ringColor(() => t => `rgba(61,220,151,${1 - t})`)
  .ringMaxRadius(5).ringPropagationSpeed(3).ringRepeatPeriod(1200);

globe.renderer().setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

function bakeMap(features) {
  const W = 4096, H = 2048, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#0a1426'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#2458aa'; g.strokeStyle = 'rgba(120,180,255,0.9)'; g.lineWidth = 1.5; g.lineJoin = 'round';
  const X = lon => (lon + 180) / 360 * W, Y = lat => (90 - lat) / 180 * H;
  for (const f of features) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) {
      g.beginPath();
      for (const ring of poly) {
        let prev = null;
        ring.forEach(([lo, la]) => {
          if (prev === null || Math.abs(lo - prev) > 180) g.moveTo(X(lo), Y(la)); else g.lineTo(X(lo), Y(la));
          prev = lo;
        });
        g.closePath();
      }
      g.fill('evenodd'); g.stroke();
    }
  }
  return c.toDataURL('image/png');
}
globe.controls().autoRotate = true; globe.controls().autoRotateSpeed = 0.35;
globe.pointOfView({ lat: 30, lng: 20, altitude: 2.4 });
const resize = () => globe.width(innerWidth).height(innerHeight); addEventListener('resize', resize); resize();

window.vpn.world().then(w => {
  const land = topojson.feature(w, w.objects.countries).features;
  globe.globeImageUrl(bakeMap(land));
});

function redrawPoints() {
  const byCountry = new Map();
  servers.filter(s => s.geo).forEach(s => {
    const key = s.country;
    if (!byCountry.has(key)) byCountry.set(key, { geo: s.geo, label: s.geo.countryName, servers: [], ids: [] });
    const g = byCountry.get(key); g.servers.push(s); g.ids.push(s.id);
  });
  globe.pointsData([...byCountry.values()]).pointColor(globe.pointColor());
  globe.ringsData(servers.filter(s => s.id === connectedId && s.geo));
}

// ---------- выбор сервера: «перемещаемся» по земле ----------
const ZOOM_IN = 0.45, ZOOM_FAR = 2.0;
let flyTimer = null;
function flyTo(geo, travelling) {
  clearTimeout(flyTimer);
  const target = { lat: geo.lat, lng: geo.lon, altitude: ZOOM_IN };
  if (!travelling) { globe.pointOfView(target, 1800); return; }
  // при переезде между странами: отъезжаем, пролетаем, приближаемся
  const cur = globe.pointOfView();
  globe.pointOfView({ lat: (cur.lat + geo.lat) / 2, lng: (cur.lng + geo.lon) / 2, altitude: ZOOM_FAR }, 700);
  flyTimer = setTimeout(() => globe.pointOfView(target, 1500), 650);
}

function select(s) {
  if (state !== 'idle' || !s) return;
  prev = selected; selected = s;
  if (s.geo) {
    globe.controls().autoRotate = false;
    flyTo(s.geo, !!prev?.geo && prev.id !== s.id);
    globe.arcsData(prev?.geo && prev.id !== s.id ? [{ a: prev.geo, b: s.geo }] : []);
  }
  $('#connect').disabled = false;
  setCur(); render(); redrawPoints();
}

// ---------- список: папки подписок ----------
const saveSubs = () => localStorage.setItem('dreamvpn.subs', JSON.stringify(subs.map(({ id, name, input, collapsed, quota, custom }) => ({ id, name, input, collapsed, quota, custom }))));
const nameFromInput = t => { try { return new URL(t).hostname; } catch { return 'Мои серверы'; } };

function flagHtml(cc) {
  if (!cc) return '🌐';
  return flagUrls[cc] ? `<img class="flagimg" src="${flagUrls[cc]}" alt="${cc}">` : `<span class="cc">${cc}</span>`;
}
async function ensureFlags() {
  const need = [...new Set(servers.map(s => s.country).filter(c => c && !(c in flagUrls)))];
  if (!need.length) return;
  try { Object.assign(flagUrls, await window.vpn.flags(need)); } catch { /* ниже проставим null */ }
  need.forEach(c => { if (!(c in flagUrls)) flagUrls[c] = null; });
  if (need.every(c => !flagUrls[c])) setStatus('Флаги не найдены: выполни npm install в папке проекта', true);
  render();
}

function serverRow(s) {
  const li = document.createElement('li');
  li.className = (s.id === connectedId ? 'live' : s.id === selected?.id ? 'sel' : '');
  li.innerHTML = `<span class="flag">${flagHtml(s.country)}</span>
    <span class="nm"><b></b><small></small></span><span class="ping"></span><span class="tag"></span>`;
  const pv = pings[s.id], pe = li.querySelector('.ping');
  if (pv === -1) pe.textContent = 'UDP';
  else if (pv === null) { pe.textContent = '✕'; pe.className = 'ping bad'; }
  else if (pv !== undefined) { pe.textContent = pv + ' мс'; pe.className = 'ping ' + (pv < 300 ? 'ok' : 'slow'); }
  li.querySelector('b').textContent = s.name;
  li.querySelector('small').textContent = s.geo ? s.geo.countryName : s.host;
  li.querySelector('.tag').textContent = s.transport === 'xhttp' ? 'xhttp' : s.protocol;
  li.onclick = () => select(s);
  return li;
}

function render() {
  const root = $('#list'); root.innerHTML = '';
  subs.forEach(sub => {
    const list = serversBySub[sub.id] || [];
    const g = document.createElement('div'); g.className = 'group' + (sub.collapsed ? ' closed' : '');
    g.innerHTML = `<div class="ghead"><span class="chev">${sub.collapsed ? '▸' : '▾'}</span><span class="gname"></span>${list.some(s => s.id === connectedId) ? '<span class="dot"></span>' : ''}<span class="gmeta"></span><button class="gdel" title="Удалить подписку">✕</button></div><ul class="gbody"></ul>`;
    const head = g.querySelector('.ghead'), nameEl = g.querySelector('.gname');
    nameEl.textContent = sub.name;
    g.querySelector('.gmeta').textContent = [`${list.length} шт.`, sub.quota].filter(Boolean).join(' · ');
    head.onclick = e => { if (e.target.closest('.gdel')) return; sub.collapsed = !sub.collapsed; saveSubs(); render(); };
    nameEl.ondblclick = e => {                                   // переименование
      e.stopPropagation();
      const inp = document.createElement('input'); inp.className = 'gedit'; inp.value = sub.name;
      inp.onclick = ev => ev.stopPropagation();
      inp.onblur = () => { sub.name = inp.value.trim() || sub.name; sub.custom = true; saveSubs(); render(); };
      inp.onkeydown = ev => { if (ev.key === 'Enter') inp.blur(); if (ev.key === 'Escape') { inp.value = sub.name; inp.blur(); } };
      nameEl.replaceWith(inp); inp.focus(); inp.select();
    };
    g.querySelector('.gdel').onclick = e => { e.stopPropagation(); removeSub(sub); };
    const ul = g.querySelector('.gbody'); list.forEach(s => ul.appendChild(serverRow(s)));
    root.appendChild(g);
  });
}

function afterChange() {
  servers = subs.flatMap(s => serversBySub[s.id] || []);
  if (selected && !servers.some(s => s.id === selected.id)) { selected = null; prev = null; globe.arcsData([]); }
  $('#connect').disabled = state !== 'idle' || !selected;
  $('#quota').textContent = servers.length ? `Серверов: ${servers.length}` : '';
  ensureFlags(); setCur(); render(); redrawPoints();
}

// ---------- импорт ----------
async function loadSub(sub) {
  const r = await window.vpn.importServers(sub.input, sub.id);
  if (!r.servers.length) throw new Error('Серверов не найдено');
  serversBySub[sub.id] = r.servers;
  if (!sub.custom && r.title) sub.name = r.title;
  const u = r.userinfo;
  sub.quota = u && u.total ? `${((u.upload + u.download) / 2 ** 30).toFixed(0)}/${(u.total / 2 ** 30).toFixed(0)} ГБ` : '';
}

async function addSub(text) {
  text = (text || '').trim(); if (!text) return;
  let sub = subs.find(s => s.input === text); const isNew = !sub;
  if (isNew) sub = { id: 's' + Date.now().toString(36), name: nameFromInput(text), input: text, collapsed: false };
  try {
    setStatus('Загрузка…'); await loadSub(sub);
    if (isNew) subs.push(sub);
    saveSubs(); $('#input').value = ''; $('#settings').hidden = true; setStatus('');
    pings = {}; afterChange(); runPing();
  } catch (e) { setStatus(e.message.replace(/^Error invoking remote method.*?Error: /, ''), true); $('#settings').hidden = false; }
}

function removeSub(sub) {
  if ((serversBySub[sub.id] || []).some(s => s.id === connectedId)) { setStatus('Сначала отключись от этого сервера', true); return; }
  if (!confirm(`Удалить «${sub.name}» из списка?`)) return;
  subs = subs.filter(x => x !== sub); delete serversBySub[sub.id]; window.vpn.removeSub(sub.id);
  saveSubs(); afterChange();
  if (!subs.length) $('#settings').hidden = false;
}

$('#add').onclick = () => addSub($('#input').value);
$('#paste').onclick = async () => { $('#input').value = await navigator.clipboard.readText(); addSub($('#input').value); };
$('#input').addEventListener('keydown', e => { if (e.key === 'Enter') addSub(e.target.value); });

// ---------- проверка доступности (только пока VPN выключен) ----------
async function runPing() {
  if (state !== 'idle' || !servers.length) return;
  setStatus('Проверка серверов…');
  try { pings = await window.vpn.ping(); } catch { pings = {}; }
  setStatus(''); render();
}
$('#ping').onclick = runPing;

// ---------- подключение ----------
function setStatus(t, err) { const el = $('#status'); el.textContent = t; el.className = err ? 'err' : ''; }
function setState(s) {
  state = s;
  const badge = $('#badge'), btn = $('#connect');
  badge.className = 'badge ' + (s === 'connected' ? 'connected' : s === 'connecting' ? 'connecting' : '');
  badge.textContent = { idle: 'не подключено', connecting: 'подключение…', connected: 'подключено', dropped: 'обрыв' }[s] || s;
  btn.className = s === 'connected' ? 'on' : '';
  btn.textContent = s === 'connected' ? 'Отключить' : s === 'connecting' ? 'Подключение…' : 'Подключить';
  btn.disabled = s === 'connecting' || (s === 'idle' && !selected);
}
$('#connect').onclick = async () => {
  if (state === 'connected') { await window.vpn.disconnect(); connectedId = null; setState('idle'); globe.controls().autoRotate = true; globe.pointOfView({ altitude: 2.4 }, 1400); redrawPoints(); render(); return; }
  if (!selected) return;
  setStatus(''); setState('connecting');
  try { await window.vpn.connect(selected.id, { fragment: $('#frag').checked, core: $('#core').value }); connectedId = selected.id; setState('connected'); if ($('#autofold').checked) setCompact(true); }
  catch (e) { connectedId = null; setState('idle'); setStatus(e.message.replace(/^Error invoking remote method.*?Error: /, ''), true); }
  render(); redrawPoints();
};
window.vpn.onState(({ state: s }) => {
  if (s === 'dropped') { connectedId = null; setStatus('Соединение оборвалось', true); render(); redrawPoints(); }
  if (s === 'dropped' || s === 'idle') setState('idle');
});
window.vpn.onLog(l => { const p = $('#log'); p.textContent = (p.textContent + l).slice(-6000); p.scrollTop = p.scrollHeight; });

// ---------- старт ----------
setState('idle');
$('#frag').checked = localStorage.getItem('dreamvpn.frag') !== '0';
$('#frag').onchange = e => localStorage.setItem('dreamvpn.frag', e.target.checked ? '1' : '0');
$('#core').value = localStorage.getItem('dreamvpn.core') || 'auto';
$('#core').onchange = e => localStorage.setItem('dreamvpn.core', e.target.value);
$('#gear').onclick = () => { const st = $('#settings'); st.hidden = !st.hidden; };

try { subs = JSON.parse(localStorage.getItem('dreamvpn.subs') || '[]'); } catch { subs = []; }
const legacy = localStorage.getItem('dreamvpn.input');                     // старый формат: одна подписка
if (!subs.length && legacy) { subs = [{ id: 's0', name: nameFromInput(legacy), input: legacy, collapsed: false }]; localStorage.removeItem('dreamvpn.input'); saveSubs(); }
if (!subs.length) $('#settings').hidden = false;                           // первый запуск
render();
(async () => {
  await Promise.all(subs.map(sub => loadSub(sub).catch(() => { serversBySub[sub.id] = []; })));
  saveSubs(); afterChange(); runPing();
})();

// ---------- свёрнутый режим: остаётся «DreamVPN · подключено» ----------
function setCompact(v) {
  $('#panel').classList.toggle('compact', v);
  $('#fold').innerHTML = v ? '&#9662;' : '&#9652;';
  $('#fold').title = v ? 'Развернуть' : 'Свернуть';
  localStorage.setItem('dreamvpn.compact', v ? '1' : '0');
}
function setCur() { $('#cur').textContent = selected ? selected.name : ''; }
$('#fold').onclick = () => setCompact(!$('#panel').classList.contains('compact'));
$('#autofold').checked = localStorage.getItem('dreamvpn.autofold') === '1';
$('#autofold').onchange = e => localStorage.setItem('dreamvpn.autofold', e.target.checked ? '1' : '0');
setCompact(localStorage.getItem('dreamvpn.compact') === '1');

// ---------- обновления ----------
window.vpn.version().then(v => { $('#ver').textContent = 'Версия ' + v; });
function showUpdate(u) {
  const msg = { checking: 'Проверка обновлений…', none: 'У тебя последняя версия', off: 'Автообновление не настроено: впиши адрес в package.json (build.publish.url)',
    dev: 'Недоступно в режиме разработки (только в собранной версии)', available: `Найдена версия ${u.version}, загрузка…`,
    downloading: `Загрузка обновления: ${u.percent}%`, ready: `Версия ${u.version} загружена`, error: `Ошибка обновления: ${u.message || ''}` }[u.state] || '';
  $('#updmsg').textContent = msg;
  $('#update').hidden = u.state !== 'ready';
  if (u.state === 'ready') $('#updtext').textContent = `Доступна версия ${u.version}`;
}
window.vpn.onUpdate(showUpdate);
$('#upd').onclick = async () => showUpdate(await window.vpn.checkUpdate());
$('#updbtn').onclick = () => window.vpn.installUpdate();
