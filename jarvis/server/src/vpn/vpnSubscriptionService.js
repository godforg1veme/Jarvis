const crypto = require('node:crypto');
const { URL, unquote } = require('node:url');

const DEFAULT_PORT_HOPPING_RANGE = '20000-50000';
const DEFAULT_HOP_INTERVAL = '30s';
const DEFAULT_TEST_URL = 'http://cp.cloudflare.com/generate_204';
const DEFAULT_PUBLIC_URL = 'https://jarvis.rilora.ru';

function generateToken() {
  const rawBytes = crypto.randomBytes(32).toString('hex');
  const token = `sub_${rawBytes}`;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  return { token, tokenHash };
}

function hashToken(token) {
  if (!token || typeof token !== 'string') return '';
  return crypto.createHash('sha256').update(token).digest('hex');
}

function parseHysteriaUri(rawUri) {
  if (!rawUri || typeof rawUri !== 'string') return null;
  const trimmed = rawUri.trim();
  if (!trimmed.startsWith('hy2://') && !trimmed.startsWith('hysteria2://')) return null;
  try {
    const parsed = new URL(trimmed);
    const user = decodeURIComponent(parsed.username || '');
    const password = decodeURIComponent(parsed.password || '');
    const host = parsed.hostname;
    const port = parseInt(parsed.port, 10) || 443;
    const obfs = parsed.searchParams.get('obfs') || 'salamander';
    const obfsPassword = parsed.searchParams.get('obfs-password') || '';
    const sni = parsed.searchParams.get('sni') || host;
    const insecure = parsed.searchParams.get('insecure') === '1';
    return {
      auth: user && password ? `${user}:${password}` : (password || user),
      user,
      password,
      host,
      port,
      obfs,
      obfsPassword,
      sni,
      insecure,
    };
  } catch (_) {
    return null;
  }
}

function parseVlessUri(rawUri) {
  if (!rawUri || typeof rawUri !== 'string') return null;
  const trimmed = rawUri.trim();
  if (!trimmed.startsWith('vless://')) return null;
  try {
    const parsed = new URL(trimmed);
    const uuid = decodeURIComponent(parsed.username || '');
    const host = parsed.hostname;
    const port = parseInt(parsed.port, 10) || 443;
    const flow = parsed.searchParams.get('flow') || 'xtls-rprx-vision';
    const security = parsed.searchParams.get('security') || 'reality';
    const sni = parsed.searchParams.get('sni') || 'dl.google.com';
    const pbk = parsed.searchParams.get('pbk') || '';
    const sid = parsed.searchParams.get('sid') || '';
    const fp = parsed.searchParams.get('fp') || 'chrome';
    const type = parsed.searchParams.get('type') || 'tcp';
    return {
      uuid,
      host,
      port,
      flow,
      security,
      sni,
      pbk,
      sid,
      fp,
      type,
    };
  } catch (_) {
    return null;
  }
}

function buildSingboxOutbound(item) {
  if (item.type === 'hysteria2') {
    const outbound = {
      type: 'hysteria2',
      tag: item.tag,
      server: item.server,
      server_port: item.server_port || 443,
      ports: item.ports || DEFAULT_PORT_HOPPING_RANGE,
      hop_interval: item.hop_interval || DEFAULT_HOP_INTERVAL,
      password: item.auth,
      tls: {
        enabled: true,
        server_name: item.sni || item.server,
        insecure: Boolean(item.insecure),
      },
    };
    if (item.obfsPassword) {
      outbound.obfs = {
        type: item.obfs || 'salamander',
        password: item.obfsPassword,
      };
    }
    return outbound;
  }

  if (item.type === 'vless') {
    return {
      type: 'vless',
      tag: item.tag,
      server: item.server,
      server_port: item.server_port || 8443,
      uuid: item.uuid,
      flow: item.flow || 'xtls-rprx-vision',
      tls: {
        enabled: true,
        server_name: item.sni || 'dl.google.com',
        reality: {
          enabled: true,
          public_key: item.pbk,
          short_id: item.sid,
        },
        utls: {
          enabled: true,
          fingerprint: item.fp || 'chrome',
        },
      },
    };
  }

  return null;
}

class VpnSubscriptionService {
  constructor(options = {}) {
    this.repository = options.repository;
    this.clients = options.clients || {};
    this.externalProbeMonitor = options.externalProbeMonitor || null;
    this.now = options.now || (() => new Date());
    this.publicUrl = (options.publicUrl || DEFAULT_PUBLIC_URL).replace(/\/+$/, '');
  }

  generateToken() {
    return generateToken();
  }

  _isProbeHealthy(snapshot, checkName) {
    if (!snapshot || !snapshot.checks || !snapshot.checks[checkName]) return true; // optimistic if not probed
    return snapshot.checks[checkName].status !== 'failed';
  }

  buildSingboxProfile({ nodes = {}, probeSnapshots = {} } = {}) {
    const deProbe = probeSnapshots.de || null;
    const nlProbe = probeSnapshots.nl || null;

    const candidates = [];

    // 1. DE Hysteria 2
    if (nodes.deHy2) {
      const parsed = typeof nodes.deHy2 === 'string' ? parseHysteriaUri(nodes.deHy2) : nodes.deHy2;
      if (parsed) {
        const healthy = this._isProbeHealthy(deProbe, 'hysteria2_udp_443');
        candidates.push({
          key: 'de_hy2',
          priority: healthy ? 1 : 10,
          tag: '🇩🇪 Германия (Hysteria 2)',
          type: 'hysteria2',
          server: parsed.host,
          server_port: parsed.port,
          ports: parsed.ports || DEFAULT_PORT_HOPPING_RANGE,
          hop_interval: parsed.hop_interval || DEFAULT_HOP_INTERVAL,
          auth: parsed.auth,
          obfs: parsed.obfs,
          obfsPassword: parsed.obfsPassword,
          sni: parsed.sni,
          insecure: parsed.insecure,
        });
      }
    }

    // 2. NL Hysteria 2
    if (nodes.nlHy2) {
      const parsed = typeof nodes.nlHy2 === 'string' ? parseHysteriaUri(nodes.nlHy2) : nodes.nlHy2;
      if (parsed) {
        const healthy = this._isProbeHealthy(nlProbe, 'hysteria2_udp_443');
        candidates.push({
          key: 'nl_hy2',
          priority: healthy ? 2 : 11,
          tag: '🇳🇱 Нидерланды (Hysteria 2)',
          type: 'hysteria2',
          server: parsed.host,
          server_port: parsed.port,
          ports: parsed.ports || DEFAULT_PORT_HOPPING_RANGE,
          hop_interval: parsed.hop_interval || DEFAULT_HOP_INTERVAL,
          auth: parsed.auth,
          obfs: parsed.obfs,
          obfsPassword: parsed.obfsPassword,
          sni: parsed.sni,
          insecure: parsed.insecure,
        });
      }
    }

    // 3. DE VLESS (8443)
    if (nodes.deVless) {
      const parsed = typeof nodes.deVless === 'string' ? parseVlessUri(nodes.deVless) : nodes.deVless;
      if (parsed) {
        const healthy = this._isProbeHealthy(deProbe, 'vless_tcp_8443');
        candidates.push({
          key: 'de_vless',
          priority: healthy ? 3 : 12,
          tag: '🇩🇪 Германия (VLESS 8443)',
          type: 'vless',
          server: parsed.host,
          server_port: parsed.port || 8443,
          uuid: parsed.uuid,
          flow: parsed.flow,
          sni: parsed.sni,
          pbk: parsed.pbk,
          sid: parsed.sid,
          fp: parsed.fp,
        });
      }
    }

    // 4. NL VLESS (8443)
    if (nodes.nlVless) {
      const parsed = typeof nodes.nlVless === 'string' ? parseVlessUri(nodes.nlVless) : nodes.nlVless;
      if (parsed) {
        const healthy = this._isProbeHealthy(nlProbe, 'vless_tcp_8443');
        candidates.push({
          key: 'nl_vless',
          priority: healthy ? 4 : 13,
          tag: '🇳🇱 Нидерланды (VLESS 8443)',
          type: 'vless',
          server: parsed.host,
          server_port: parsed.port || 8443,
          uuid: parsed.uuid,
          flow: parsed.flow,
          sni: parsed.sni,
          pbk: parsed.pbk,
          sid: parsed.sid,
          fp: parsed.fp,
        });
      }
    }

    // Sort outbounds in url-test by priority
    candidates.sort((a, b) => a.priority - b.priority);

    const failoverGroupTag = '⚡ Авто-выбор (Smart Failover)';
    const concreteOutbounds = candidates.map(buildSingboxOutbound).filter(Boolean);
    const failoverOutbounds = candidates.map((c) => c.tag);

    const outbounds = [];
    if (failoverOutbounds.length > 0) {
      outbounds.push({
        type: 'url-test',
        tag: failoverGroupTag,
        outbounds: failoverOutbounds,
        url: DEFAULT_TEST_URL,
        interval: '30s',
        tolerance: 50,
      });
    }

    outbounds.push(...concreteOutbounds);
    outbounds.push({ type: 'direct', tag: 'direct' });
    outbounds.push({ type: 'block', tag: 'block' });

    return {
      version: 1,
      outbounds,
      route: {
        auto_detect_interface: true,
        final: failoverOutbounds.length > 0 ? failoverGroupTag : 'direct',
        rules: [
          {
            geoip: ['private'],
            outbound: 'direct',
          },
          {
            geosite: ['category-ru'],
            geoip: ['ru'],
            domain_suffix: ['.ru', '.su', '.xn--p1ai'],
            outbound: 'direct',
          },
        ],
      },
    };
  }

  buildBase64Profile({ nodes = {}, probeSnapshots = {} } = {}) {
    const deProbe = probeSnapshots.de || null;
    const nlProbe = probeSnapshots.nl || null;
    const lines = [];

    // Helper to format hy2 with port hopping and tag
    const formatHy2 = (rawUri, tag, ports = DEFAULT_PORT_HOPPING_RANGE) => {
      const parsed = parseHysteriaUri(rawUri);
      if (!parsed) return '';
      const query = new URLSearchParams();
      if (parsed.obfs) query.set('obfs', parsed.obfs);
      if (parsed.obfsPassword) query.set('obfs-password', parsed.obfsPassword);
      if (parsed.sni) query.set('sni', parsed.sni);
      if (parsed.insecure) query.set('insecure', '1');
      query.set('mport', ports);
      return `hy2://${encodeURIComponent(parsed.auth)}@${parsed.host}:${ports}/?${query.toString()}#${encodeURIComponent(tag)}`;
    };

    // Helper to format vless with tag
    const formatVless = (rawUri, tag) => {
      const parsed = parseVlessUri(rawUri);
      if (!parsed) return '';
      const query = new URLSearchParams({
        encryption: 'none',
        flow: parsed.flow || 'xtls-rprx-vision',
        security: parsed.security || 'reality',
        sni: parsed.sni || 'dl.google.com',
        fp: parsed.fp || 'chrome',
        pbk: parsed.pbk || '',
        sid: parsed.sid || '',
        type: parsed.type || 'tcp',
        headerType: 'none',
      });
      return `vless://${encodeURIComponent(parsed.uuid)}@${parsed.host}:${parsed.port}?${query.toString()}#${encodeURIComponent(tag)}`;
    };

    if (nodes.deHy2 && this._isProbeHealthy(deProbe, 'hysteria2_udp_443')) {
      lines.push(formatHy2(nodes.deHy2, '🇩🇪 Германия (Hysteria 2)'));
    }
    if (nodes.nlHy2 && this._isProbeHealthy(nlProbe, 'hysteria2_udp_443')) {
      lines.push(formatHy2(nodes.nlHy2, '🇳🇱 Нидерланды (Hysteria 2)'));
    }
    if (nodes.deVless && this._isProbeHealthy(deProbe, 'vless_tcp_8443')) {
      lines.push(formatVless(nodes.deVless, '🇩🇪 Германия (VLESS 8443)'));
    }
    if (nodes.nlVless && this._isProbeHealthy(nlProbe, 'vless_tcp_8443')) {
      lines.push(formatVless(nodes.nlVless, '🇳🇱 Нидерланды (VLESS 8443)'));
    }

    // Add remaining if they were degraded
    if (nodes.deHy2 && !this._isProbeHealthy(deProbe, 'hysteria2_udp_443')) {
      lines.push(formatHy2(nodes.deHy2, '🇩🇪 Германия (Hysteria 2 - Degraded)'));
    }
    if (nodes.nlHy2 && !this._isProbeHealthy(nlProbe, 'hysteria2_udp_443')) {
      lines.push(formatHy2(nodes.nlHy2, '🇳🇱 Нидерланды (Hysteria 2 - Degraded)'));
    }
    if (nodes.deVless && !this._isProbeHealthy(deProbe, 'vless_tcp_8443')) {
      lines.push(formatVless(nodes.deVless, '🇩🇪 Германия (VLESS 8443 - Degraded)'));
    }
    if (nodes.nlVless && !this._isProbeHealthy(nlProbe, 'vless_tcp_8443')) {
      lines.push(formatVless(nodes.nlVless, '🇳🇱 Нидерланды (VLESS 8443 - Degraded)'));
    }

    const validLines = lines.filter(Boolean);
    return Buffer.from(validLines.join('\n'), 'utf8').toString('base64');
  }

  renderHappLandingHtml({ token, label }) {
    const subUrl = `${this.publicUrl}/sub/${encodeURIComponent(token)}`;
    const happDeeplink = `happ://add/sub?url=${encodeURIComponent(subUrl)}`;
    const safeLabel = String(label || 'Устройство').replace(/[<>&"']/g, '');

    return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Активация подписки Happ — Jarvis</title>
  <style>
    :root {
      --bg: #090d16;
      --card: #131b2e;
      --primary: #3b82f6;
      --primary-hover: #2563eb;
      --text: #f8fafc;
      --text-dim: #94a3b8;
      --border: #1e293b;
      --success: #10b981;
    }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      margin: 0;
      padding: 24px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 90vh;
      text-align: center;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 32px 24px;
      max-width: 420px;
      width: 100%;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    }
    .icon {
      font-size: 48px;
      margin-bottom: 16px;
    }
    h1 {
      font-size: 22px;
      margin: 0 0 8px 0;
      font-weight: 700;
    }
    .badge {
      display: inline-block;
      background: rgba(16, 185, 129, 0.15);
      color: var(--success);
      padding: 4px 12px;
      border-radius: 9999px;
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 20px;
    }
    p {
      color: var(--text-dim);
      font-size: 15px;
      line-height: 1.5;
      margin: 0 0 24px 0;
    }
    .btn {
      display: block;
      background: var(--primary);
      color: #fff;
      text-decoration: none;
      font-weight: 600;
      font-size: 17px;
      padding: 16px;
      border-radius: 14px;
      transition: background 0.2s ease;
      box-shadow: 0 4px 14px rgba(59, 130, 246, 0.4);
    }
    .btn:hover {
      background: var(--primary-hover);
    }
    .url-box {
      margin-top: 24px;
      text-align: left;
    }
    .url-label {
      font-size: 12px;
      color: var(--text-dim);
      margin-bottom: 6px;
      display: block;
    }
    .input-wrap {
      display: flex;
      gap: 8px;
    }
    input {
      background: #0b1120;
      border: 1px solid var(--border);
      color: var(--text);
      padding: 10px 12px;
      border-radius: 8px;
      font-size: 12px;
      font-family: monospace;
      width: 100%;
      outline: none;
    }
    .copy-btn {
      background: #1e293b;
      border: 1px solid var(--border);
      color: var(--text);
      padding: 0 16px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🚀</div>
    <h1>Подписка Jarvis VPN</h1>
    <div class="badge">● Профиль «${safeLabel}» активен</div>
    <p>Открываем приложение <b>Happ</b> для автоматического добавления подписки с динамическим отказоустойчивым каналом...</p>
    
    <a class="btn" href="${happDeeplink}">Активировать в Happ</a>

    <div class="url-box">
      <span class="url-label">Ссылка для ручной вставки:</span>
      <div class="input-wrap">
        <input type="text" readonly value="${subUrl}" id="subInput" onclick="this.select()">
        <button class="copy-btn" onclick="copyUrl()">Копия</button>
      </div>
    </div>
  </div>

  <script>
    function copyUrl() {
      const input = document.getElementById('subInput');
      input.select();
      navigator.clipboard.writeText(input.value);
      alert('Ссылка подписки скопирована!');
    }
    // Auto-launch Happ on load
    setTimeout(function() {
      window.location.href = "${happDeeplink}";
    }, 400);
  </script>
</body>
</html>`;
  }

  async createSubscription({ userId, label, createdBy, clientIdDe = null, clientIdNl = null }) {
    if (!this.repository) throw new Error('SUBSCRIPTION_REPOSITORY_UNAVAILABLE');
    const { token, tokenHash } = this.generateToken();
    const record = await this.repository.create({
      userId,
      label,
      tokenHash,
      clientIdDe,
      clientIdNl,
      createdBy: createdBy || userId,
    });
    return {
      id: record.id,
      token,
      label: record.label,
      url: `${this.publicUrl}/sub/${token}`,
      happUrl: `${this.publicUrl}/happ-sub/${token}`,
    };
  }

  async _exportNodeCredentials(record) {
    const result = { deHy2: null, nlHy2: null, deVless: null, nlVless: null };
    const deClient = this.clients?.de;
    const nlClient = this.clients?.nl;

    // DE exports
    if (deClient && record.client_id_de) {
      try {
        const hy2Resp = await deClient.request({
          version: 1,
          requestId: crypto.randomUUID(),
          operation: 'vpn.hysteria2.client.export',
          arguments: { clientId: record.client_id_de },
          sentAt: this.now().toISOString(),
        });
        if (hy2Resp?.result?.state === 'succeeded' && hy2Resp.result.data?.shareUri) {
          result.deHy2 = hy2Resp.result.data.shareUri;
        }
      } catch (_) {}

      try {
        const vlessResp = await deClient.request({
          version: 1,
          requestId: crypto.randomUUID(),
          operation: 'vpn.client.export',
          arguments: { clientId: record.client_id_de },
          sentAt: this.now().toISOString(),
        });
        if (vlessResp?.result?.state === 'succeeded' && vlessResp.result.data?.shareUri) {
          result.deVless = vlessResp.result.data.shareUri;
        }
      } catch (_) {}
    }

    // NL exports
    if (nlClient && record.client_id_nl) {
      try {
        const hy2Resp = await nlClient.request({
          version: 1,
          requestId: crypto.randomUUID(),
          operation: 'vpn.hysteria2.client.export',
          arguments: { clientId: record.client_id_nl },
          sentAt: this.now().toISOString(),
        });
        if (hy2Resp?.result?.state === 'succeeded' && hy2Resp.result.data?.shareUri) {
          result.nlHy2 = hy2Resp.result.data.shareUri;
        }
      } catch (_) {}

      try {
        const vlessResp = await nlClient.request({
          version: 1,
          requestId: crypto.randomUUID(),
          operation: 'vpn.client.export',
          arguments: { clientId: record.client_id_nl },
          sentAt: this.now().toISOString(),
        });
        if (vlessResp?.result?.state === 'succeeded' && vlessResp.result.data?.shareUri) {
          result.nlVless = vlessResp.result.data.shareUri;
        }
      } catch (_) {}
    }

    return result;
  }

  async resolveSubscription(token, { userAgent = '', format = null } = {}) {
    if (!token || typeof token !== 'string' || !this.repository) {
      return { status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'SUBSCRIPTION_NOT_FOUND' }) };
    }

    const tokenHash = hashToken(token);
    const subscription = await this.repository.findActiveByTokenHash(tokenHash);
    if (!subscription) {
      return { status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'SUBSCRIPTION_NOT_FOUND' }) };
    }

    // Update access timestamp
    if (typeof this.repository.touchLastAccessed === 'function') {
      await this.repository.touchLastAccessed(subscription.id).catch(() => {});
    }

    // Fetch node credentials
    const nodes = await this._exportNodeCredentials(subscription);

    // Fetch probe snapshots if monitor available
    let probeSnapshots = {};
    if (this.externalProbeMonitor && typeof this.externalProbeMonitor.snapshot === 'function') {
      try {
        const [de, nl] = await Promise.all([
          this.externalProbeMonitor.snapshot('de').catch(() => null),
          this.externalProbeMonitor.snapshot('nl').catch(() => null),
        ]);
        probeSnapshots = { de, nl };
      } catch (_) {}
    }

    const ua = String(userAgent || '').toLowerCase();
    const isSingbox = format === 'json' || ua.includes('happ') || ua.includes('sing-box');

    if (isSingbox && format !== 'base64') {
      const profile = this.buildSingboxProfile({ nodes, probeSnapshots });
      return {
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify(profile, null, 2),
      };
    }

    const base64 = this.buildBase64Profile({ nodes, probeSnapshots });
    return {
      status: 200,
      contentType: 'text/plain; charset=utf-8',
      body: base64,
    };
  }
}

module.exports = {
  VpnSubscriptionService,
  generateToken,
  hashToken,
  parseHysteriaUri,
  parseVlessUri,
  DEFAULT_PORT_HOPPING_RANGE,
};
