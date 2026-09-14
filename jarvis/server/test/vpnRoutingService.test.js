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
  buildRoutingHtmlPage,
  buildRoutingSummary,
} = require('../src/vpn/vpnRoutingService');

test('buildHappRoutingProfile generates valid Happ schema with RU direct rules', () => {
  const profile = buildHappRoutingProfile();
  assert.equal(profile.Name, DEFAULT_ROUTING_NAME);
  assert.equal(profile.GlobalProxy, 'false');
  assert.equal(profile.DomainStrategy, 'IPIfNonMatch');
  assert.equal(profile.DomesticDNSIP, '77.88.8.8');
  assert.equal(profile.DomesticDNSType, 'DoU');
  assert.equal(profile.RemoteDNSIP, '1.1.1.1');
  assert.equal(profile.RemoteDNSType, 'DoH');
  assert.equal(profile.Geositeurl, '');
  assert.equal(profile.Geoipurl, '');

  assert.ok(profile.DirectSites.includes('domain:ru'));
  assert.ok(profile.DirectSites.includes('domain:su'));
  assert.ok(profile.DirectSites.includes('domain:xn--p1ai'));
  assert.ok(profile.DirectSites.includes('domain:gosuslugi.ru'));
  assert.ok(profile.DirectSites.includes('domain:sberbank.ru'));
  assert.ok(profile.DirectSites.includes('domain:tbank.ru'));
  assert.ok(profile.DirectSites.includes('domain:ozon.ru'));
  assert.ok(profile.DirectSites.includes('domain:wildberries.ru'));
  assert.ok(profile.DirectSites.includes('domain:vk.com'));
  assert.ok(profile.DirectSites.includes('domain:yandex.net'));
  assert.ok(profile.DirectSites.includes('domain:2gis.com'));
  assert.ok(profile.DirectSites.includes('domain:max.ru'));
  assert.ok(!profile.DirectSites.includes('geosite:ru'), 'geosite:ru must not be present to avoid crash on clean Happ');

  assert.ok(profile.ProxySites.includes('domain:brawlstarsgame.com'));
  assert.ok(profile.ProxySites.includes('domain:youtube.com'));
  assert.ok(profile.ProxySites.includes('domain:discord.com'));
  assert.ok(profile.ProxySites.includes('domain:discordapp.com'));
  assert.ok(profile.ProxySites.includes('domain:t.me'));
  assert.ok(profile.ProxySites.includes('domain:instagram.com'));
  assert.ok(!profile.ProxySites.some((s) => s.startsWith('geosite:')), 'no geosite in ProxySites to stay under 50MB iOS limit');

  assert.ok(profile.DirectIp.includes('geoip:ru'));
  assert.ok(profile.DirectIp.includes('geoip:private'));
  assert.equal(profile.BlockSites.length, 0);
});

test('buildHappRoutingDeeplink encodes valid base64 and roundtrips successfully', () => {
  const onaddLink = buildHappRoutingDeeplink({ autoActivate: true });
  assert.ok(onaddLink.startsWith('happ://routing/onadd/'));

  const base64Part = onaddLink.replace('happ://routing/onadd/', '');
  const decoded = JSON.parse(Buffer.from(base64Part, 'base64').toString('utf8'));
  assert.equal(decoded.Name, DEFAULT_ROUTING_NAME);
  assert.equal(decoded.DomainStrategy, 'IPIfNonMatch');
  assert.ok(Array.isArray(decoded.DirectSites));
  assert.ok(decoded.DirectSites.includes('domain:ru'));
  assert.ok(decoded.ProxySites.includes('domain:brawlstarsgame.com'));

  const addLink = buildHappRoutingDeeplink({ autoActivate: false });
  assert.ok(addLink.startsWith('happ://routing/add/'));
});

test('buildHysteriaAclBlock and YAML contain direct rules for RU domains and IPs', () => {
  const acl = buildHysteriaAclBlock();
  assert.ok(acl.includes('direct(domain-suffix:.ru)'));
  assert.ok(acl.includes('direct(domain-suffix:vk.com)'));
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
  assert.ok(yaml.includes('direct(domain-suffix:.ru)'));
});

test('buildRoutingSummary produces Telegram-ready instructions with public routing link', () => {
  const summary = buildRoutingSummary();
  assert.ok(summary.includes('https://jarvis.rilora.ru/happ-routing'));
  assert.ok(summary.includes('Госуслуги'));
  assert.ok(summary.includes('Пошаговая инструкция'));
});

test('buildRoutingHtmlPage generates valid HTML landing page with deeplink redirect', () => {
  const html = buildRoutingHtmlPage();
  assert.ok(html.includes('<!DOCTYPE html>'));
  assert.ok(html.includes('happ://routing/onadd/'));
  assert.ok(html.includes('Jarvis RU Direct'));
  assert.ok(html.includes('http-equiv="refresh"'));
});

test('buildRoutingArtifact creates valid JSON file artifact', () => {
  const artifact = buildRoutingArtifact();
  assert.equal(artifact.kind, 'happ-routing');
  assert.equal(artifact.filename, 'jarvis-ru-direct-routing.json');
  const parsed = JSON.parse(artifact.content);
  assert.equal(parsed.Name, DEFAULT_ROUTING_NAME);
});
