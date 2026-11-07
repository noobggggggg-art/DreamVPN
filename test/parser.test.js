'use strict';
const assert = require('assert');
const { parseLink, parseSubscription, parseUserInfo, pickBackend, importAny } = require('../src/parser');
const { buildSingboxConfig } = require('../src/core/singbox');
const { buildXrayConfig } = require('../src/core/xray');

const UUID = '00000000-0000-4000-8000-000000000000';
const fm = encodeURIComponent(JSON.stringify({ tcp: [{ type: 'fragment', settings: { packets: 'tlshello' } }] }));
const reality = `vless://${UUID}@203.0.113.5:443?encryption=none&flow=xtls-rprx-vision&type=tcp&security=reality&sni=example.com&fp=firefox&pbk=PUBKEY&sid=abcd&spx=%2F&fm=${fm}#${encodeURIComponent('🇩🇪 Германия')}`;
const withTraffic = `vless://${UUID}@h.example.net:10473?type=tcp&security=reality&sni=a.b&pbk=K&sid=1#` + encodeURIComponent('🇪🇺🏳️ Автовыбор · БС 122.48/700.00 GB');
const hy2 = `hysteria2://${UUID}@203.0.113.9:31445/?sni=cdn.example.com#${encodeURIComponent('🇪🇪 Эстония 2')}`;
const xhttp = `vless://${UUID}@203.0.113.7:443?type=xhttp&security=reality&sni=example.com&pbk=K&sid=1&path=%2Fx&mode=packet-up#${encodeURIComponent('🇳🇱 Нидерланды')}`;
const ss = 'ss://' + Buffer.from('aes-256-gcm:pass').toString('base64') + '@203.0.113.1:8388#' + encodeURIComponent('🇺🇸 США');

// --- vless reality
const a = parseLink(reality);
assert.strictEqual(a.protocol, 'vless'); assert.strictEqual(a.host, '203.0.113.5'); assert.strictEqual(a.port, 443);
assert.strictEqual(a.country, 'DE'); assert.strictEqual(a.name, 'Германия'); assert.ok(a.geo.lat > 50);
assert.strictEqual(a.security, 'reality'); assert.ok(a.fragment);
assert.strictEqual(pickBackend(a), 'xray'); assert.strictEqual(pickBackend(a, 'singbox'), 'singbox');

// --- имя с остатком трафика и флагом ЕС
const b = parseLink(withTraffic);
assert.strictEqual(b.country, 'EU'); assert.strictEqual(b.name, '🏳️ Автовыбор · БС');   // прочие эмодзи остаются в названии
assert.deepStrictEqual(b.traffic, { usedGB: 122.48, totalGB: 700 });

// --- hysteria2, ss, xhttp
const c = parseLink(hy2); assert.strictEqual(c.protocol, 'hysteria2'); assert.strictEqual(c.port, 31445); assert.strictEqual(c.country, 'EE');
const d = parseLink(ss); assert.strictEqual(d.method, 'aes-256-gcm'); assert.strictEqual(d.secret, 'pass'); assert.strictEqual(d.port, 8388);
const e = parseLink(xhttp); assert.strictEqual(pickBackend(e), 'xray'); assert.strictEqual(pickBackend(c), 'singbox');

// --- подписка: plain и base64
const text = [reality, hy2, 'мусор', xhttp].join('\n');
assert.strictEqual(parseSubscription(text).length, 3);
assert.strictEqual(parseSubscription(Buffer.from(text).toString('base64')).length, 3);
assert.deepStrictEqual(parseUserInfo('upload=1; download=2; total=3; expire=4'), { upload: 1, download: 2, total: 3, expire: 4 });

// --- конфиги
const sb = buildSingboxConfig(a);
assert.strictEqual(sb.inbounds.length, 1); assert.strictEqual(sb.inbounds[0].type, 'tun');
assert.strictEqual(sb.outbounds[0].tls.reality.public_key, 'PUBKEY'); assert.strictEqual(sb.outbounds[0].tls.fragment, undefined);
assert.strictEqual(buildSingboxConfig(a, { fragment: true }).outbounds[0].tls.fragment, true);
assert.strictEqual(sb.outbounds[0].flow, 'xtls-rprx-vision');
assert.strictEqual(buildSingboxConfig(c).outbounds[0].type, 'hysteria2');
assert.strictEqual(buildSingboxConfig(d).outbounds[0].type, 'shadowsocks');
const xr = buildXrayConfig(e);
assert.strictEqual(xr.outbounds[0].streamSettings.network, 'xhttp');
assert.strictEqual(xr.outbounds[0].streamSettings.xhttpSettings.mode, 'packet-up');
assert.strictEqual(xr.inbounds[0].listen, '127.0.0.1');
const xa = buildXrayConfig(a, { fragment: true }).outbounds[0].streamSettings;
assert.ok(xa.finalmask && xa.finalmask.tcp[0].type === 'fragment'); assert.strictEqual(xa.network, 'tcp'); assert.strictEqual(xa.realitySettings.publicKey, 'PUBKEY');
assert.strictEqual(buildXrayConfig(a).outbounds[0].streamSettings.finalmask, undefined);
const up = buildSingboxConfig(a, { upstream: { port: 10808, bypass: ['203.0.113.5'] } });
assert.strictEqual(up.outbounds[0].type, 'socks'); assert.strictEqual(up.outbounds[0].server_port, 10808);
assert.ok(up.route.rules.some(r => r.ip_cidr && r.ip_cidr[0] === '203.0.113.5/32' && r.outbound === 'direct'));
assert.strictEqual(up.inbounds[0].type, 'tun');
JSON.stringify(sb); JSON.stringify(xr); JSON.stringify(up);

console.log('OK: все тесты прошли');

(async () => {
  const fakeFetch = async () => ({ ok: true, text: async () => reality,
    headers: { get: h => h === 'profile-title' ? 'base64:' + Buffer.from('Мой VPN').toString('base64') : null } });
  const r = await importAny('https://x.example/sub/1', fakeFetch);
  assert.strictEqual(r.title, 'Мой VPN'); assert.strictEqual(r.servers.length, 1);
  console.log('OK: importAny / название подписки');
})();
