'use strict';
const crypto = require('crypto');
const { COUNTRIES } = require('./countries');

const b64decode = s => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
const safeDecode = s => { try { return decodeURIComponent(s); } catch { return s; } };

/** 🇩🇪 -> "DE" (два regional indicator символа). */
function flagToCode(str) {
  const ri = [...str].map(c => c.codePointAt(0)).filter(cp => cp >= 0x1F1E6 && cp <= 0x1F1FF);
  if (ri.length < 2) return null;
  return String.fromCharCode(ri[0] - 0x1F1E6 + 65, ri[1] - 0x1F1E6 + 65);
}

/** "… 122.48/700.00 GB" -> { usedGB, totalGB } */
function extractTraffic(name) {
  const m = name.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*GB/i);
  return m ? { usedGB: +m[1], totalGB: +m[2] } : null;
}

function cleanName(name) {
  return name
    .replace(/[\u{1F1E6}-\u{1F1FF}]{2}/gu, '')
    .replace(/\s*\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?\s*GB\s*$/i, '')
    .trim();
}

function base(raw, protocol, name, host, port) {
  const cc = flagToCode(name) || null;
  return {
    id: crypto.createHash('sha1').update(raw).digest('hex').slice(0, 12),
    protocol, host, port: Number(port),
    name: cleanName(name) || host,
    country: cc,
    geo: cc && COUNTRIES[cc] ? { lat: COUNTRIES[cc][1], lon: COUNTRIES[cc][2], countryName: COUNTRIES[cc][0] } : null,
    traffic: extractTraffic(name),
    raw
  };
}

function parseVlessLike(line, protocol) {
  const u = new URL(line);
  const p = Object.fromEntries(u.searchParams);
  const s = base(line, protocol, safeDecode(u.hash.slice(1)), u.hostname.replace(/^\[|\]$/g, ''), u.port || 443);
  s.secret = safeDecode(u.username);            // uuid (vless) или пароль (trojan)
  s.params = p;
  if (p.fm) { try { s.fragment = JSON.parse(p.fm); } catch { /* ignore */ } }
  s.transport = (p.type || 'tcp').toLowerCase();
  s.security = (p.security || 'none').toLowerCase();
  return s;
}

function parseHysteria2(line) {
  const u = new URL(line.replace(/^hy2:/, 'hysteria2:'));
  const p = Object.fromEntries(u.searchParams);
  const s = base(line, 'hysteria2', safeDecode(u.hash.slice(1)), u.hostname, u.port || 443);
  s.secret = safeDecode(u.password ? `${u.username}:${u.password}` : u.username);
  s.params = p;
  if (p.fm) { try { s.fragment = JSON.parse(p.fm); } catch { /* ignore */ } }
  return s;
}

function parseSS(line) {
  let rest = line.slice(5), name = '';
  const h = rest.indexOf('#');
  if (h >= 0) { name = safeDecode(rest.slice(h + 1)); rest = rest.slice(0, h); }
  const q = rest.indexOf('?');
  if (q >= 0) rest = rest.slice(0, q);
  let userinfo, hostport;
  if (rest.includes('@')) {
    const at = rest.lastIndexOf('@');
    userinfo = rest.slice(0, at); hostport = rest.slice(at + 1);
    userinfo = userinfo.includes(':') ? safeDecode(userinfo) : b64decode(userinfo);
  } else {
    const dec = b64decode(rest), at = dec.lastIndexOf('@');
    userinfo = dec.slice(0, at); hostport = dec.slice(at + 1);
  }
  const ci = userinfo.indexOf(':'), pi = hostport.lastIndexOf(':');
  const s = base(line, 'shadowsocks', name, hostport.slice(0, pi), hostport.slice(pi + 1));
  s.method = userinfo.slice(0, ci); s.secret = userinfo.slice(ci + 1); s.params = {};
  s.transport = 'tcp'; s.security = 'none';
  return s;
}

function parseVmess(line) {
  const j = JSON.parse(b64decode(line.slice(8)));
  const s = base(line, 'vmess', j.ps || '', j.add, j.port);
  s.secret = j.id; s.params = { aid: j.aid, net: j.net, tls: j.tls, sni: j.sni || j.host, path: j.path, host: j.host };
  s.transport = j.net || 'tcp'; s.security = j.tls === 'tls' ? 'tls' : 'none';
  return s;
}

function parseLink(line) {
  line = line.trim();
  try {
    if (line.startsWith('vless://')) return parseVlessLike(line, 'vless');
    if (line.startsWith('trojan://')) return parseVlessLike(line, 'trojan');
    if (line.startsWith('hysteria2://') || line.startsWith('hy2://')) return parseHysteria2(line);
    if (line.startsWith('ss://')) return parseSS(line);
    if (line.startsWith('vmess://')) return parseVmess(line);
  } catch (e) { /* битая строка — пропускаем */ }
  return null;
}

/** Текст подписки (plain или base64) -> массив серверов. */
function parseSubscription(text) {
  text = text.trim();
  if (!text.includes('://')) { try { text = b64decode(text); } catch { return []; } }
  return text.split(/\r?\n/).map(parseLink).filter(Boolean);
}

/** Заголовок subscription-userinfo: "upload=0; download=1; total=2; expire=3" */
function parseUserInfo(header) {
  if (!header) return null;
  const o = {};
  header.split(';').forEach(kv => { const [k, v] = kv.trim().split('='); if (k) o[k] = Number(v); });
  return o;
}

/** profile-title: "base64:..." или обычная/URL-кодированная строка. */
function parseTitle(h) {
  if (!h) return null;
  try { return (/^base64:/i.test(h) ? b64decode(h.slice(7)) : safeDecode(h)).trim() || null; } catch { return null; }
}

/** Одна ссылка ИЛИ http(s)-подписка ИЛИ текст со ссылками. */
async function importAny(input, fetchFn = fetch) {
  input = input.trim();
  if (/^https?:\/\//i.test(input)) {
    const res = await fetchFn(input, { headers: { 'User-Agent': 'DreamVPN/0.1' } });
    if (!res.ok) throw new Error(`Подписка вернула HTTP ${res.status}`);
    return { servers: parseSubscription(await res.text()), userinfo: parseUserInfo(res.headers.get('subscription-userinfo')), title: parseTitle(res.headers.get('profile-title')), source: input };
  }
  return { servers: parseSubscription(input), userinfo: null, title: null, source: null };
}

/** Какое ядро нужно серверу. */
function pickBackend(server, pref = 'auto') {
  if (['xhttp', 'splithttp'].includes(server.transport)) return 'xray';
  if (pref === 'singbox') return 'singbox';
  // auto и xray: те же ядро и FinalMask (fm=), что у INCY
  return ['vless', 'trojan', 'vmess'].includes(server.protocol) ? 'xray' : 'singbox';
}

module.exports = { parseLink, parseSubscription, parseUserInfo, importAny, flagToCode, pickBackend };
