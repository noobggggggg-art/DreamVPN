'use strict';
// Конфиг Xray-core. Нужен для XHTTP (sing-box его не умеет).
// У Xray нет встроенного TUN: он слушает SOCKS на 127.0.0.1, а в TUN его заворачивает sing-box (см. manager.js).

const SOCKS_PORT = 10808;

function buildStream(s, opts = {}) {
  const p = s.params || {};
  const st = { network: s.transport === 'splithttp' ? 'xhttp' : s.transport };
  if (s.security === 'reality') {
    st.security = 'reality';
    st.realitySettings = { serverName: p.sni, fingerprint: p.fp || 'chrome', publicKey: p.pbk, shortId: p.sid || '', spiderX: p.spx || '' };
  } else if (s.security === 'tls') {
    st.security = 'tls';
    st.tlsSettings = { serverName: p.sni || s.host, fingerprint: p.fp || 'chrome', alpn: p.alpn ? p.alpn.split(',') : undefined };
  }
  if (opts.fragment && s.fragment) st.finalmask = s.fragment;   // fm=... передаём как есть (Xray FinalMask)
  if (st.network === 'xhttp') {
    st.xhttpSettings = { path: p.path || '/', host: p.host || '', mode: p.mode || 'auto' };
    if (p.extra) { try { Object.assign(st.xhttpSettings, { extra: JSON.parse(p.extra) }); } catch { /* ignore */ } }
  }
  return st;
}

function buildXrayConfig(server, opts = {}) {
  if (server.protocol !== 'vless' && server.protocol !== 'trojan' && server.protocol !== 'vmess')
    throw new Error(`Xray: протокол ${server.protocol} не поддерживается этим генератором`);
  const user = server.protocol === 'vless'
    ? { id: server.secret, encryption: 'none', flow: server.params.flow || undefined }
    : { id: server.secret };
  const settings = server.protocol === 'trojan'
    ? { servers: [{ address: server.host, port: server.port, password: server.secret }] }
    : { vnext: [{ address: server.host, port: server.port, users: [user] }] };
  return {
    log: { loglevel: opts.logLevel || 'warning' },
    inbounds: [{ tag: 'socks-in', listen: '127.0.0.1', port: opts.socksPort || SOCKS_PORT, protocol: 'socks',
      settings: { udp: true, auth: 'noauth' }, sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'] } }],
    outbounds: [
      { tag: 'proxy', protocol: server.protocol, settings, streamSettings: buildStream(server, opts) },
      { tag: 'direct', protocol: 'freedom' }
    ],
    dns: { servers: ['1.1.1.1', '8.8.8.8'] }
  };
}

module.exports = { buildXrayConfig, SOCKS_PORT };
