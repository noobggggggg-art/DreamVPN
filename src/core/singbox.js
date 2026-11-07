'use strict';
// Генератор конфига sing-box (формат для версий >= 1.12).
// Только TUN-inbound: никаких локальных SOCKS/HTTP портов.

function tlsBlock(s, opts = {}) {
  const p = s.params || {};
  const tls = { enabled: true, server_name: p.sni || p.host || s.host };
  if (p.fp) tls.utls = { enabled: true, fingerprint: p.fp };
  if (p.alpn) tls.alpn = p.alpn.split(',');
  if (p.allowInsecure === '1' || p.insecure === '1') tls.insecure = true;
  if (s.security === 'reality') tls.reality = { enabled: true, public_key: p.pbk, short_id: p.sid || '' };
  // фрагментация TLS ClientHello (параметр fm=... из подписки)
  if (opts.fragment && s.fragment && JSON.stringify(s.fragment).includes('fragment')) tls.fragment = true;
  return tls;
}

function transportBlock(s) {
  const p = s.params || {};
  switch (s.transport) {
    case 'ws': return { type: 'ws', path: p.path || '/', headers: p.host ? { Host: p.host } : undefined };
    case 'grpc': return { type: 'grpc', service_name: p.serviceName || '' };
    case 'http': case 'h2': return { type: 'http', path: p.path || '/', host: p.host ? [p.host] : undefined };
    default: return undefined; // tcp
  }
}

function buildOutbound(s, opts = {}) {
  if (opts.upstream) return { type: 'socks', tag: 'proxy', server: '127.0.0.1', server_port: opts.upstream.port, version: '5' };
  const o = { tag: 'proxy', server: s.host, server_port: s.port, domain_resolver: 'dns-bootstrap' };
  switch (s.protocol) {
    case 'vless':
      Object.assign(o, { type: 'vless', uuid: s.secret, packet_encoding: 'xudp' });
      if (s.params.flow) o.flow = s.params.flow;
      if (s.security !== 'none') o.tls = tlsBlock(s, opts);
      break;
    case 'trojan':
      Object.assign(o, { type: 'trojan', password: s.secret, tls: tlsBlock(s, opts) });
      break;
    case 'vmess':
      Object.assign(o, { type: 'vmess', uuid: s.secret, alter_id: Number(s.params.aid || 0), security: 'auto' });
      if (s.security === 'tls') o.tls = tlsBlock(s, opts);
      break;
    case 'shadowsocks':
      Object.assign(o, { type: 'shadowsocks', method: s.method, password: s.secret });
      break;
    case 'hysteria2':
      Object.assign(o, { type: 'hysteria2', password: s.secret,
        tls: { enabled: true, server_name: s.params.sni || s.host, insecure: s.params.insecure === '1' } });
      break;
    default: throw new Error(`sing-box: протокол ${s.protocol} не поддерживается`);
  }
  const t = transportBlock(s);
  if (t) o.transport = JSON.parse(JSON.stringify(t));
  return o;
}

function buildSingboxConfig(server, opts = {}) {
  return {
    log: { level: opts.logLevel || 'warn', timestamp: true },
    dns: {
      servers: [
        { type: 'https', tag: 'dns-remote', server: '1.1.1.1', detour: 'proxy' }, // DoH по 443: порт 853 (DoT) серверы часто режут,
        { type: 'udp', tag: 'dns-bootstrap', server: '8.8.8.8' } // только чтобы найти IP самого сервера
      ],
      final: 'dns-remote'
    },
    inbounds: [{
      type: 'tun', tag: 'tun-in', interface_name: 'dreamvpn',
      address: ['172.19.0.1/30', 'fdfe:dcba:9876::1/126'],
      auto_route: true, strict_route: true
    }],
    outbounds: [buildOutbound(server, opts), { type: 'direct', tag: 'direct' }],
    route: {
      auto_detect_interface: true,
      default_domain_resolver: 'dns-bootstrap',
      rules: [
        { action: 'sniff' },
        { protocol: 'dns', action: 'hijack-dns' },
        ...(opts.upstream ? [
          { ip_cidr: opts.upstream.bypass.map(ip => `${ip}/32`), outbound: 'direct' },   // сервер — мимо TUN, иначе петля
          { process_name: ['xray.exe'], outbound: 'direct' }
        ] : []),
        { ip_is_private: true, outbound: 'direct' }
      ],
      final: 'proxy'
    },
    experimental: opts.statsPort ? { clash_api: { external_controller: `127.0.0.1:${opts.statsPort}` } } : undefined
  };
}

module.exports = { buildSingboxConfig };
