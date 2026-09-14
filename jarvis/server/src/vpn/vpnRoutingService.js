const DEFAULT_ROUTING_NAME = 'Jarvis RU Direct (Обход РФ)';

const DOMESTIC_DIRECT_SITES = Object.freeze([
  'geosite:category-gov-ru',
  'geosite:ru',
  'domain:ru',
  'domain:su',
  'domain:xn--p1ai',
  'domain:gosuslugi.ru',
  'domain:sberbank.ru',
  'domain:tbank.ru',
  'domain:tinkoff.ru',
  'domain:vtb.ru',
  'domain:alfabank.ru',
  'domain:ozon.ru',
  'domain:wildberries.ru',
  'domain:avito.ru',
  'domain:yandex.ru',
  'domain:ya.ru',
  'domain:vk.com',
  'domain:cbr.ru',
  'domain:nalog.gov.ru',
  'domain:mos.ru',
]);

const DOMESTIC_DIRECT_IPS = Object.freeze([
  'geoip:ru',
  'geoip:private',
]);

const BLOCK_SITES = Object.freeze([
  'geosite:category-ads-all',
]);

function buildHappRoutingProfile(options = {}) {
  return {
    Name: options.name || DEFAULT_ROUTING_NAME,
    GlobalProxy: 'false',
    RemoteDNSType: 'DoH',
    RemoteDNSDomain: options.remoteDnsDomain || 'dns.google',
    RemoteDNSIP: options.remoteDnsIp || '8.8.8.8',
    DomesticDNSType: 'DoH',
    DomesticDNSDomain: options.domesticDnsDomain || 'common.dot.dns.yandex.net',
    DomesticDNSIP: options.domesticDnsIp || '77.88.8.8',
    Geoipurl: '',
    Geositeurl: '',
    LastUpdated: '',
    DnsHosts: {},
    DirectSites: [...(options.directSites || DOMESTIC_DIRECT_SITES)],
    DirectIp: [...(options.directIp || DOMESTIC_DIRECT_IPS)],
    ProxySites: options.proxySites ? [...options.proxySites] : [],
    ProxyIp: options.proxyIp ? [...options.proxyIp] : [],
    BlockSites: [...(options.blockSites || BLOCK_SITES)],
    BlockIp: options.blockIp ? [...options.blockIp] : [],
    DomainStrategy: 'IPIfNonMatch',
    FakeDNS: 'false',
  };
}

function buildHappRoutingDeeplink(options = {}) {
  const profile = buildHappRoutingProfile(options);
  const jsonString = JSON.stringify(profile, null, 2);
  const base64 = Buffer.from(jsonString, 'utf8').toString('base64');
  const action = options.autoActivate === false ? 'add' : 'onadd';
  return `happ://routing/${action}/${base64}`;
}

function buildHysteriaAclBlock() {
  return [
    'acl:',
    '  inline:',
    '    - direct(geosite:category-gov-ru)',
    '    - direct(geosite:ru)',
    '    - direct(geoip:ru)',
    '    - direct(geoip:private)',
    '    - direct(domain-suffix:.ru)',
    '    - direct(domain-suffix:.su)',
    '    - direct(domain-suffix:.xn--p1ai)',
  ].join('\n');
}

function buildHysteriaClientYaml(options = {}) {
  const server = options.server || 'vpn.rilora.ru';
  const port = options.port || 443;
  const auth = options.auth || 'username:password';
  const obfsPassword = options.obfsPassword || '';
  const sni = options.sni || server;

  const lines = [
    `server: ${server}:${port}`,
    `auth: ${auth}`,
    'tls:',
    `  sni: ${sni}`,
  ];
  if (obfsPassword) {
    lines.push('obfs:', '  type: salamander', `  password: ${obfsPassword}`);
  }
  lines.push(buildHysteriaAclBlock());
  return lines.join('\n') + '\n';
}

function buildRoutingSummary(options = {}) {
  const deeplink = buildHappRoutingDeeplink(options);
  return [
    '🌐 <b>Раздельная маршрутизация (Обход РФ)</b>',
    '',
    'Все российские ресурсы (Госуслуги, банки, маркетплейсы, сайты .ru/.рф) идут <b>напрямую через ваш домашний/мобильный IP</b> с максимальной скоростью без блокировок.',
    'Все зарубежные и заблокированные ресурсы идут <b>через Hysteria 2</b>.',
    'Включать/выключать VPN для отдельных сайтов не нужно — всё работает автоматически.',
    '',
    '📱 <b>Активация в приложении Happ в 1 тап:</b>',
    'Скопируйте и откройте в браузере Safari или строке Happ ссылку:',
    `<code>${deeplink}</code>`,
    '',
    '💡 <i>При переходе Happ автоматически импортирует и включит профиль «Jarvis RU Direct». Этот профиль сразу применяется ко всем вашим Hysteria 2 подключениям.</i>',
    '',
    '⚙️ <b>Ручная настройка в Happ (если ссылка не открылась):</b>',
    '• Настройки → Маршрутизация (Routing)',
    '• Direct Sites: <code>geosite:category-gov-ru, geosite:ru, domain:ru, domain:su, domain:xn--p1ai</code>',
    '• Direct IP: <code>geoip:ru, geoip:private</code>',
    '• Domestic DNS: <code>77.88.8.8</code> (Яндекс DNS)',
    '• Domain Strategy: <code>IPIfNonMatch</code>',
  ].join('\n');
}

function buildRoutingArtifact(options = {}) {
  const profile = buildHappRoutingProfile(options);
  return {
    kind: 'happ-routing',
    filename: 'jarvis-ru-direct-routing.json',
    content: JSON.stringify(profile, null, 2) + '\n',
  };
}

module.exports = {
  BLOCK_SITES,
  DEFAULT_ROUTING_NAME,
  DOMESTIC_DIRECT_IPS,
  DOMESTIC_DIRECT_SITES,
  buildHappRoutingDeeplink,
  buildHappRoutingProfile,
  buildHysteriaAclBlock,
  buildHysteriaClientYaml,
  buildRoutingArtifact,
  buildRoutingSummary,
};
