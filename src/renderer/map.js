'use strict';
// Политическая карта: плоская карта мира (проекция Меркатора), страны разными оттенками, серверы — точками.
const PoliticalMap = (() => {
  const cv = document.getElementById('map'), ctx = cv.getContext('2d');
  const PI = Math.PI, rad = PI / 180;
  let W = 0, H = 0, dpr = 1, active = false, raf = 0, last = 0, force = false;
  let feats = [], groups = [], featCache = new Map();
  let data = { servers: [], selectedId: null, connectedId: null, arc: null };
  let labelFn = g => g.countryName;
  let sw = null, more = false;                 // sw — «занятая» справа ширина (панель + окно настроек), сглаженная
  let theme = { h: 209 }, view = { x: 0.5, y: 0.5, z: 1 }, anim = null, pickCb = () => {}, drag = null;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const hsl = (h, s, l, a = 1) => `hsla(${Math.round(h)},${s}%,${l}%,${a})`;
  const proj = (lon, lat) => { lat = clamp(lat, -82, 82); return [(lon + 180) / 360, 0.5 - Math.log(Math.tan(PI / 4 + lat * rad / 2)) / (2 * PI)]; };

  // сколько пикселей справа занято: панель, а если открыто — ещё и окно настроек
  function occupied() {
    const p = document.getElementById('panel'), d = document.getElementById('settings');
    if (!document.body.classList.contains('view-map') || !p) return { panel: 0, total: 0 };
    const panel = W - p.getBoundingClientRect().left + 16;
    let total = panel;
    if (d && d.classList.contains('open')) total = Math.max(total, W - (parseFloat(d.style.left) || W) + 12);
    return { panel, total };
  }
  // масштаб считаем по ширине без окна настроек (чтобы зум не «дышал»), а центр сдвигаем плавно в свободную область
  function stage() {
    const o = occupied();
    return { pw: o.panel, cx: (W - (sw === null ? o.total : sw)) / 2 };
  }
  const scale = () => Math.max(W - stage().pw, H) * view.z;

  function setWorld(fs) {
    feats = []; featCache = new Map();
    for (const f of fs) {
      if (f.properties && f.properties.name === 'Antarctica') continue;
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      const rings = [], ll = [];
      let u0 = 1, u1 = 0, v0 = 1, v1 = 0, lo0 = 180, lo1 = -180, la0 = 90, la1 = -90;
      for (const poly of polys) for (const ring of poly) {
        const uv = new Float32Array(ring.length * 2), l2 = new Float32Array(ring.length * 2);
        ring.forEach(([lo, la], k) => {
          const [u, v] = proj(lo, la);
          uv[2 * k] = u; uv[2 * k + 1] = v; l2[2 * k] = lo; l2[2 * k + 1] = la;
          if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v;
          if (lo < lo0) lo0 = lo; if (lo > lo1) lo1 = lo; if (la < la0) la0 = la; if (la > la1) la1 = la;
        });
        rings.push(uv); ll.push(l2);
      }
      feats.push({ idx: feats.length, name: f.properties && f.properties.name, rings, ll, u0, u1, v0, v1, lo0, lo1, la0, la1, has: false, sel: false, conn: false });
    }
    compute(); touch();
  }

  // в какой стране лежит точка (чётно-нечётное правило по всем кольцам)
  function featAt(lon, lat) {
    const key = lon + ',' + lat;
    if (featCache.has(key)) return featCache.get(key);
    let found = -1;
    for (const f of feats) {
      if (lon < f.lo0 || lon > f.lo1 || lat < f.la0 || lat > f.la1) continue;
      let inside = false;
      for (const r of f.ll) for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
        const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
        if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) { found = f.idx; break; }
    }
    featCache.set(key, found);
    return found;
  }

  function compute() {
    feats.forEach(f => { f.has = f.sel = f.conn = false; });
    const by = new Map();
    for (const s of data.servers) {
      if (!s.geo) continue;
      let g = by.get(s.country);
      if (!g) { g = { label: labelFn(s.geo), geo: s.geo, uv: proj(s.geo.lon, s.geo.lat), servers: [], sel: false, conn: false, x: NaN, y: NaN }; by.set(s.country, g); }
      g.servers.push(s);
      if (s.id === data.selectedId) g.sel = true;
      if (s.id === data.connectedId) g.conn = true;
    }
    groups = [...by.values()];
    for (const g of groups) {
      const fi = featAt(g.geo.lon, g.geo.lat);
      if (fi >= 0) { const f = feats[fi]; f.has = true; f.sel = f.sel || g.sel; f.conn = f.conn || g.conn; }
    }
  }

  function draw() {
    if (!active || !W) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = hsl(theme.h, 55, 7); ctx.fillRect(0, 0, W, H);
    const occ = occupied();
    if (sw === null) sw = occ.total;
    sw += (occ.total - sw) * 0.22; more = Math.abs(occ.total - sw) > 0.5; if (!more) sw = occ.total;
    const st = stage(), s = scale();
    const X = u => (u - view.x) * s + st.cx, Y = v => (v - view.y) * s + H / 2;
    ctx.lineJoin = 'round';
    for (const f of feats) {
      const x0 = X(f.u0), x1 = X(f.u1), y0 = Y(f.v0), y1 = Y(f.v1);
      if (x1 < 0 || x0 > W || y1 < 0 || y0 > H) continue;
      ctx.beginPath();
      for (const r of f.rings) {
        let pu = -9;
        for (let i = 0; i < r.length; i += 2) {
          const u = r[i];
          if (i === 0 || Math.abs(u - pu) > 0.5) ctx.moveTo(X(u), Y(r[i + 1])); else ctx.lineTo(X(u), Y(r[i + 1]));
          pu = u;
        }
        ctx.closePath();
      }
      ctx.fillStyle = f.conn ? hsl(156, 55, 38) : f.sel ? hsl(theme.h, 75, 52) : f.has ? hsl(theme.h, 48, 38)
        : hsl(theme.h + (f.idx % 6) * 22 - 55, 30, 20 + (f.idx % 3) * 3);
      ctx.fill();
      ctx.strokeStyle = (f.conn || f.sel || f.has) ? hsl(theme.h, 70, 78, 0.85) : hsl(theme.h, 35, 62, 0.35);
      ctx.lineWidth = (f.conn || f.sel) ? 1.6 : 0.7;
      ctx.stroke();
    }

    const now = performance.now();
    if (data.arc) {                                      // дуга «переезда» от прошлого выбора к новому
      const [ua, va] = proj(data.arc.a.lon, data.arc.a.lat), [ub, vb] = proj(data.arc.b.lon, data.arc.b.lat);
      const ax = X(ua), ay = Y(va), bx = X(ub), by = Y(vb);
      ctx.beginPath(); ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo((ax + bx) / 2, (ay + by) / 2 - Math.hypot(bx - ax, by - ay) * 0.28, bx, by);
      ctx.setLineDash([10, 8]); ctx.lineDashOffset = -now / 40;
      ctx.lineWidth = 2.5; ctx.strokeStyle = hsl(theme.h, 90, 70, 0.95); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.font = '600 12px "Segoe UI", system-ui, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    const labels = [];
    for (const g of groups) {
      const x = X(g.uv[0]), y = Y(g.uv[1]);
      g.x = NaN; g.y = NaN;
      if (x < -30 || x > W + 30 || y < -30 || y > H + 30) continue;
      g.x = x; g.y = y;
      if (g.conn) {                                      // пульсация у подключённого сервера
        const t = (now % 1600) / 1600;
        ctx.beginPath(); ctx.arc(x, y, 7 + t * 24, 0, 2 * PI);
        ctx.strokeStyle = `rgba(61,220,151,${(1 - t) * 0.8})`; ctx.lineWidth = 2; ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(x, y, g.sel || g.conn ? 6.5 : 5, 0, 2 * PI);
      ctx.fillStyle = g.conn ? '#3ddc97' : g.sel ? '#ffffff' : '#ffb454'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = '#0a0514'; ctx.stroke();
      if (g.sel || g.conn || view.z >= 1.8) labels.push(g);
    }
    labels.sort((a, b) => (Number(b.conn) - Number(a.conn)) || (Number(b.sel) - Number(a.sel)));
    const placed = [];
    for (const g of labels) {                            // справа от точки, если занято — слева, если и там занято — пропускаем
      const w = ctx.measureText(g.label).width + 4;
      for (const lx of [g.x + 11, g.x - 11 - w + 4]) {
        const r = { x0: lx - 2, x1: lx + w, y0: g.y - 8, y1: g.y + 8 };
        if (placed.some(q => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0)) continue;
        placed.push(r);
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(5,7,13,.85)'; ctx.strokeText(g.label, lx, g.y);
        ctx.fillStyle = '#e6ecfa'; ctx.fillText(g.label, lx, g.y);
        break;
      }
    }
  }

  function step(now) {
    const t = clamp((now - anim.t0) / anim.ms, 0, 1), e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    view.x = anim.x0 + (anim.x1 - anim.x0) * e; view.y = anim.y0 + (anim.y1 - anim.y0) * e;
    let z = anim.z0 + (anim.z1 - anim.z0) * e;
    if (anim.hop) z *= 1 - 0.45 * Math.sin(PI * t);      // при переезде между странами: отъезжаем и приближаемся
    view.z = clamp(z, 1, 14);
    if (t >= 1) anim = null;
  }

  function tick(now) {
    raf = 0;
    if (!active) return;
    if (force || anim || now - last >= 33) { force = false; if (anim) step(now); draw(); last = now; }
    if (anim || data.arc || data.connectedId || more) raf = requestAnimationFrame(tick);
  }
  function touch() { force = true; if (active && !raf) raf = requestAnimationFrame(tick); }

  function flyTo(geo, hop) {
    const [u, v] = proj(geo.lon, geo.lat);
    anim = { t0: performance.now(), ms: hop ? 1800 : 1400, x0: view.x, y0: view.y, z0: view.z, x1: u, y1: v, z1: 4.5, hop: !!hop };
    touch();
  }
  function reset() {
    anim = { t0: performance.now(), ms: 1200, x0: view.x, y0: view.y, z0: view.z, x1: 0.5, y1: 0.5, z1: 1, hop: false };
    touch();
  }
  function hit(mx, my) {
    let best = null, bd = 14;
    for (const g of groups) { if (isNaN(g.x)) continue; const d = Math.hypot(g.x - mx, g.y - my); if (d < bd) { bd = d; best = g; } }
    if (best) pickCb(best.servers);
  }
  function resize() {
    W = innerWidth; H = innerHeight; dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); touch();
  }

  cv.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false }; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (!drag.moved) return;
    anim = null; const s = scale();
    view.x = clamp(drag.vx - dx / s, 0, 1); view.y = clamp(drag.vy - dy / s, 0.05, 0.95); touch();
  });
  cv.addEventListener('pointerup', e => {
    if (drag && !drag.moved) { const r = cv.getBoundingClientRect(); hit(e.clientX - r.left, e.clientY - r.top); }
    drag = null;
  });
  cv.addEventListener('wheel', e => {
    e.preventDefault(); anim = null;
    const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, st = stage(), s0 = scale();
    const u = (mx - st.cx) / s0 + view.x, v = (my - H / 2) / s0 + view.y;
    view.z = clamp(view.z * Math.exp(-e.deltaY * 0.0015), 1, 14);
    const s1 = scale();
    view.x = clamp(u - (mx - st.cx) / s1, 0, 1); view.y = clamp(v - (my - H / 2) / s1, 0.05, 0.95); touch();
  }, { passive: false });
  addEventListener('resize', resize);

  return {
    setWorld, flyTo, reset, resize, touch,
    setData(d) { data = d; compute(); touch(); },
    setTheme(h) { theme.h = h; touch(); },
    setActive(v) { active = v; sw = null; if (v) resize(); },
    setLabelFn(fn) { labelFn = fn; compute(); touch(); },
    onPick(cb) { pickCb = cb; }
  };
})();
