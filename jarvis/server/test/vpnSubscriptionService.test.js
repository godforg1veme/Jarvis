const test = require('node:test');
const assert = require('node:assert/strict');
const {
  VpnSubscriptionService,
  generateToken,
  hashToken,
  parseHysteriaUri,
  parseVlessUri,
  DEFAULT_PORT_HOPPING_RANGE,
} = require('../src/vpn/vpnSubscriptionService');

test('generateToken produces sub_ prefixed 68 char token and valid sha256 hash', () => {
  const { token, tokenHash } = generateToken();
  assert.equal(typeof token, 'string');
  assert.equal(token.startsWith('sub_'), true);
  assert.equal(token.length, 68);
  assert.equal(tokenHash, hashToken(token));
  assert.equal(tokenHash.length, 64);
});

test('parseHysteriaUri correctly parses valid hy2 URI', () => {
  const uri = 'hy2://vpn-3d905edc4cb0:MySecretPass123@vpn.rilora.ru:443/?obfs=salamander&obfs-password=ObfsKey456&sni=vpn.rilora.ru#MyDevice';
  const parsed = parseHysteriaUri(uri);
  assert.notEqual(parsed, null);
  assert.equal(parsed.host, 'vpn.rilora.ru');
  assert.equal(parsed.port, 443);
  assert.equal(parsed.auth, 'vpn-3d905edc4cb0:MySecretPass123');
  assert.equal(parsed.obfs, 'salamander');
  assert.equal(parsed.obfsPassword, 'ObfsKey456');
  assert.equal(parsed.sni, 'vpn.rilora.ru');
});

test('parseVlessUri correctly parses valid vless reality URI', () => {
  const uri = 'vless://b6db0e18-6c0b-48ae-8b37-d2e8b0877a56@jarvis.rilora.ru:8443?encryption=none&flow=xtls-rprx-vision&security=reality&sni=dl.google.com&fp=chrome&pbk=Z93Y1mK7q...&sid=3a8b&type=tcp&headerType=none#MyVless';
  const parsed = parseVlessUri(uri);
  assert.notEqual(parsed, null);
  assert.equal(parsed.host, 'jarvis.rilora.ru');
  assert.equal(parsed.port, 8443);
  assert.equal(parsed.uuid, 'b6db0e18-6c0b-48ae-8b37-d2e8b0877a56');
  assert.equal(parsed.flow, 'xtls-rprx-vision');
  assert.equal(parsed.security, 'reality');
  assert.equal(parsed.sni, 'dl.google.com');
  assert.equal(parsed.sid, '3a8b');
});

test('buildSingboxProfile builds valid sing-box JSON with exact priority and port hopping', () => {
  const service = new VpnSubscriptionService();
  const deHy2 = 'hy2://u1:p1@vpn-de.rilora.ru:443?obfs=salamander&obfs-password=k1&sni=vpn-de.rilora.ru';
  const nlHy2 = 'hy2://u2:p2@vpn-nl.rilora.ru:443?obfs=salamander&obfs-password=k2&sni=vpn-nl.rilora.ru';
  const deVless = 'vless://uuid-de@jarvis.rilora.ru:8443?encryption=none&flow=xtls-rprx-vision&security=reality&sni=dl.google.com&fp=chrome&pbk=pbkde&sid=de';
  const nlVless = 'vless://uuid-nl@jarvis-nl.rilora.ru:8443?encryption=none&flow=xtls-rprx-vision&security=reality&sni=dl.google.com&fp=chrome&pbk=pbknl&sid=nl';

  const profile = service.buildSingboxProfile({
    nodes: { deHy2, nlHy2, deVless, nlVless },
  });

  assert.equal(profile.version, 1);
  const outbounds = profile.outbounds;
  assert.equal(outbounds[0].type, 'url-test');
  assert.equal(outbounds[0].tag, '⚡ Авто-выбор (Smart Failover)');

  // Verify priority in failover group: DE Hy2 -> NL Hy2 -> DE VLESS -> NL VLESS
  assert.deepEqual(outbounds[0].outbounds, [
    '🇩🇪 Германия (Hysteria 2)',
    '🇳🇱 Нидерланды (Hysteria 2)',
    '🇩🇪 Германия (VLESS 8443)',
    '🇳🇱 Нидерланды (VLESS 8443)',
  ]);

  // Check Hysteria port hopping attributes
  const deHy2Outbound = outbounds.find((o) => o.tag === '🇩🇪 Германия (Hysteria 2)');
  assert.equal(deHy2Outbound.ports, DEFAULT_PORT_HOPPING_RANGE);
  assert.equal(deHy2Outbound.hop_interval, '30s');
  assert.equal(deHy2Outbound.obfs.type, 'salamander');

  // Check route rules for Russian bypass
  assert.equal(profile.route.final, '⚡ Авто-выбор (Smart Failover)');
  const ruRule = profile.route.rules.find((r) => r.domain_suffix && r.domain_suffix.includes('.ru'));
  assert.notEqual(ruRule, undefined);
  assert.equal(ruRule.outbound, 'direct');
});

test('buildSingboxProfile demotes node when probe snapshot indicates failure', () => {
  const service = new VpnSubscriptionService();
  const deHy2 = 'hy2://u1:p1@vpn-de.rilora.ru:443?obfs=salamander&obfs-password=k1';
  const nlHy2 = 'hy2://u2:p2@vpn-nl.rilora.ru:443?obfs=salamander&obfs-password=k2';
  const deVless = 'vless://uuid-de@jarvis.rilora.ru:8443?flow=xtls-rprx-vision&security=reality&pbk=p&sid=s';

  // DE hysteria is reported failed by external probe
  const probeSnapshots = {
    de: {
      checks: {
        hysteria2_udp_443: { status: 'failed', failureCode: 'PROXY_CONNECT_FAILURE' },
        vless_tcp_8443: { status: 'healthy', failureCode: null },
      },
    },
    nl: {
      checks: {
        hysteria2_udp_443: { status: 'healthy', failureCode: null },
      },
    },
  };

  const profile = service.buildSingboxProfile({
    nodes: { deHy2, nlHy2, deVless },
    probeSnapshots,
  });

  // Since DE Hy2 is failed, NL Hy2 is first, DE VLESS is second, DE Hy2 is demoted to last
  assert.deepEqual(profile.outbounds[0].outbounds, [
    '🇳🇱 Нидерланды (Hysteria 2)',
    '🇩🇪 Германия (VLESS 8443)',
    '🇩🇪 Германия (Hysteria 2)',
  ]);
});

test('buildBase64Profile outputs decodable URI list with port hopping and tags', () => {
  const service = new VpnSubscriptionService();
  const deHy2 = 'hy2://u1:p1@vpn-de.rilora.ru:443?obfs=salamander&obfs-password=k1&sni=vpn-de.rilora.ru';
  const deVless = 'vless://uuid-de@jarvis.rilora.ru:8443?flow=xtls-rprx-vision&security=reality&pbk=p&sid=s';

  const base64 = service.buildBase64Profile({
    nodes: { deHy2, deVless },
  });

  const decoded = Buffer.from(base64, 'base64').toString('utf8');
  assert.equal(decoded.includes('vpn-de.rilora.ru:20000-50000'), true);
  assert.equal(decoded.includes(':20000-50000/'), true);
  assert.equal(decoded.includes('mportHopInt=30'), true);
  assert.equal(decoded.includes('u1:p1@'), true);
  assert.equal(decoded.includes('u1%3Ap1@'), false);
  assert.equal(decoded.includes('vless://uuid-de@jarvis.rilora.ru:8443'), true);
  assert.equal(decoded.includes(encodeURIComponent('🇩🇪 Германия (Hysteria 2)')), true);
});

test('renderHappLandingHtml produces the documented Happ deeplink and manual URL', () => {
  const service = new VpnSubscriptionService({ publicUrl: 'https://jarvis.rilora.ru' });
  const html = service.renderHappLandingHtml({ token: 'sub_test123', label: 'Телефон Сени' });
  assert.equal(html.includes('Телефон Сени'), true);
  assert.equal(html.includes('happ://add/sub?url='), false);
  assert.equal(html.includes('happ://add/https%3A%2F%2Fjarvis.rilora.ru%2Fsub%2Fsub_test123'), true);
  assert.equal(html.includes('https%3A%2F%2Fjarvis.rilora.ru%2Fsub%2Fsub_test123'), true);
  assert.equal(html.includes('Активировать в Happ'), true);
});

test('resolveSubscription uses an explicit format and handles invalid tokens', async () => {
  let touchedId = null;
  const mockRepo = {
    findActiveByTokenHash: async (hash) => {
      if (hash === hashToken('sub_valid')) {
        return {
          id: 'sub-uuid-1',
          label: 'iPhone Max',
          client_id_de: JSON.stringify({ hy2: 'vpn-aaaaaaaaaaaa', vless: 'vpn-bbbbbbbbbbbb' }),
          client_id_nl: JSON.stringify({ hy2: 'vpn-cccccccccccc', vless: 'vpn-dddddddddddd' }),
        };
      }
      return null;
    },
    touchLastAccessed: async (id) => {
      touchedId = id;
    },
  };

  const mockClients = {
    de: {
      request: async ({ operation }) => {
        if (operation === 'vpn.hysteria2.client.export') {
          return {
            result: {
              state: 'succeeded',
              data: { shareUri: 'hy2://u:p@vpn.rilora.ru:443?obfs=salamander&obfs-password=op' },
            },
          };
        }
        if (operation === 'vpn.client.export') {
          return {
            result: {
              state: 'succeeded',
              data: { shareUri: 'vless://uuid@jarvis.rilora.ru:8443?flow=xtls-rprx-vision&security=reality&pbk=p&sid=s' },
            },
          };
        }
        return { result: { state: 'failed' } };
      },
    },
    nl: {
      request: async ({ operation }) => {
        if (operation === 'vpn.hysteria2.client.export') return { result: { state: 'succeeded', data: { shareUri: 'hy2://u:p@vpn-nl.rilora.ru:443?obfs=salamander&obfs-password=op' } } };
        if (operation === 'vpn.client.export') return { result: { state: 'succeeded', data: { shareUri: 'vless://uuid@nl.rilora.ru:8443?flow=xtls-rprx-vision&security=reality&pbk=p&sid=s' } } };
        return { result: { state: 'failed' } };
      },
    },
  };

  const service = new VpnSubscriptionService({
    repository: mockRepo,
    clients: mockClients,
  });

  // 1. Invalid token -> 404
  const notFound = await service.resolveSubscription('sub_invalid');
  assert.equal(notFound.status, 404);

  // 2. Happ receives the ordinary auto-refreshing subscription body.
  const happResp = await service.resolveSubscription('sub_valid', { userAgent: 'Happ/3.2.1 (iOS)' });
  assert.equal(happResp.status, 200);
  assert.equal(happResp.contentType.includes('text/plain'), true);
  assert.equal(Buffer.from(happResp.body, 'base64').toString('utf8').includes('hy2://'), true);
  assert.equal(touchedId, 'sub-uuid-1');

  // 3. Sing-box JSON is opt-in and not inferred from a User-Agent.
  const singboxResp = await service.resolveSubscription('sub_valid', { format: 'sing-box' });
  assert.equal(singboxResp.status, 200);
  assert.equal(singboxResp.contentType.includes('application/json'), true);
  const jsonBody = JSON.parse(singboxResp.body);
  assert.equal(jsonBody.version, 1);
  assert.equal(jsonBody.outbounds[0].tag, '⚡ Авто-выбор (Smart Failover)');
});

test('createSubscription creates db record and returns valid URLs', async () => {
  const mockRepo = {
    create: async (params) => ({
      id: 'sub-new-1',
      label: params.label,
      token_hash: params.tokenHash,
    }),
  };

  const service = new VpnSubscriptionService({
    repository: mockRepo,
    publicUrl: 'https://jarvis.rilora.ru',
  });

  const created = await service.createSubscription({
    userId: 'owner-1',
    label: 'MacBook Pro',
    createdBy: 'owner-1',
    clientIdDe: 'c-de',
  });

  assert.equal(created.id, 'sub-new-1');
  assert.equal(created.label, 'MacBook Pro');
  assert.equal(created.token.startsWith('sub_'), true);
  assert.equal(created.url, `https://jarvis.rilora.ru/sub/${created.token}`);
  assert.equal(created.happUrl, `https://jarvis.rilora.ru/happ-sub/${created.token}`);
});
