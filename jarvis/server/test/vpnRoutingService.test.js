const assert = require('node:assert/strict');
const test = require('node:test');
const {
  DEFAULT_ROUTING_NAME,
  DOMESTIC_DIRECT_IPS,
  DOMESTIC_DIRECT_SITES,
  buildHappRoutingDeeplink,
  buildHappRoutingProfile,
  buildHysteriaAclBlock,
  buildHysteriaClientYaml,
  buildRoutingArtifact,
  buildRoutingSummary,
} = require('../src/vpn/vpnRoutingService');

test('buildHappRoutingProfile generates valid Happ schema with RU direct rules', () => {
  const profile = buildHappRoutingProfile();
  assert.equal(profile.Name, DEFAULT_ROUTING_NAME);
  assert.equal(profile.GlobalProxy, 'false');
  assert.equal(profile.DomainStrategy, 'IPIfNonMatch');
  assert.equal(profile.DomesticDNSIP, '77.88.8.8');
  assert.equal(profile.DomesticDNSType, 'DoH');
  assert.equal(profile.RemoteDNSIP, '8.8.8.8');
  assert.equal(profile.RemoteDNSType, 'DoH');

  assert.ok(profile.DirectSites.includes('geosite:category-gov-ru'));
  assert.ok(profile.DirectSites.includes('geosite:ru'));
  assert.ok(profile.DirectSites.includes('domain:gosuslugi.ru'));
  assert.ok(profile.DirectSites.includes('domain:sberbank.ru'));
  assert.ok(profile.DirectSites.includes('domain:tbank.ru'));
  assert.ok(profile.DirectSites.includes('domain:ozon.ru'));
  assert.ok(profile.DirectSites.includes('domain:wildberries.ru'));

  assert.ok(profile.DirectIp.includes('geoip:ru'));
  assert.ok(profile.DirectIp.includes('geoip:private'));
  assert.ok(profile.BlockSites.includes('geosite:category-ads-all'));
});

test('buildHappRoutingDeeplink encodes valid base64 and roundtrips successfully', () => {
  const onaddLink = buildHappRoutingDeeplink({ autoActivate: true });
  assert.ok(onaddLink.startsWith('happ://routing/onadd/'));

  const base64Part = onaddLink.replace('happ://routing/onadd/', '');
  const decoded = JSON.parse(Buffer.from(base64Part, 'base64').toString('utf8'));
  assert.equal(decoded.Name, DEFAULT_ROUTING_NAME);
  assert.equal(decoded.DomainStrategy, 'IPIfNonMatch');
  assert.ok(Array.isArray(decoded.DirectSites));
  assert.ok(decoded.DirectSites.includes('geosite:ru'));

  const addLink = buildHappRoutingDeeplink({ autoActivate: false });
  assert.ok(addLink.startsWith('happ://routing/add/'));
});

test('buildHysteriaAclBlock and YAML contain direct rules for RU domains and IPs', () => {
  const acl = buildHysteriaAclBlock();
  assert.ok(acl.includes('direct(geosite:category-gov-ru)'));
  assert.ok(acl.includes('direct(geosite:ru)'));
  assert.ok(acl.includes('direct(geoip:ru)'));
  assert.ok(acl.includes('direct(geoip:private)'));

  const yaml = buildHysteriaClientYaml({
    server: 'vpn.rilora.ru',
    port: 443,
    auth: 'vpn-user:secret',
    obfsPassword: 'obfspassword',
    sni: 'vpn.rilora.ru',
  });
  assert.ok(yaml.includes('server: vpn.rilora.ru:443'));
  assert.ok(yaml.includes('auth: vpn-user:secret'));
  assert.ok(yaml.includes('password: obfspassword'));
  assert.ok(yaml.includes('direct(geosite:ru)'));
});

test('buildRoutingSummary produces Telegram-ready HTML instructions with deeplink', () => {
  const summary = buildRoutingSummary();
  assert.ok(summary.includes('happ://routing/onadd/'));
  assert.ok(summary.includes('Госуслуги'));
  assert.ok(summary.includes('77.88.8.8'));
  assert.ok(summary.includes('IPIfNonMatch'));
});

test('buildRoutingArtifact creates valid JSON file artifact', () => {
  const artifact = buildRoutingArtifact();
  assert.equal(artifact.kind, 'happ-routing');
  assert.equal(artifact.filename, 'jarvis-ru-direct-routing.json');
  const parsed = JSON.parse(artifact.content);
  assert.equal(parsed.Name, DEFAULT_ROUTING_NAME);
});
