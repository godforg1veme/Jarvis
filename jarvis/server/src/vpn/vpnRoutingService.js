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
    '🌐 **Раздельная маршрутизация (Обход РФ)**',
    '',
    'Все российские ресурсы (Госуслуги, банки, маркетплейсы, сайты .ru/.рф) идут **напрямую через ваш домашний/мобильный IP** с максимальной скоростью без блокировок.',
    'Все зарубежные и заблокированные ресурсы идут **через Hysteria 2**.',
    'Включать/выключать VPN для отдельных сайтов не нужно — всё работает автоматически.',
    '',
    '📱 **Активация в приложении Happ:**',
    '1. **В 1 клик через браузер (iPhone / iPad / Mac):**',
    '   Нажмите на ссылку ниже (она скопируется), вставьте в адресную строку Safari и перейдите — Happ откроется и автоматически применит профиль:',
    `   \`${deeplink}\``,
    '',
    '2. **Через файл (ПК / Android):**',
    '   Сохраните прикреплённый файл `jarvis-ru-direct-routing.json` → в приложении Happ: Настройки → Маршрутизация → «+» (или Импорт) → выберите этот файл.',
    '',
    '💡 *После применения профиля «Jarvis RU Direct» он автоматически действует для всех подключений.*',
    '',
    '⚙️ **Параметры маршрутизации:**',
    '• Direct Sites: `geosite:category-gov-ru, geosite:ru, domain:ru, domain:su, domain:xn--p1ai`',
    '• Direct IP: `geoip:ru, geoip:private`',
    '• Domestic DNS: `77.88.8.8` (Яндекс DNS)',
    '• Domain Strategy: `IPIfNonMatch`',
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
