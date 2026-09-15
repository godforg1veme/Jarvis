const DEFAULT_ROUTING_NAME = 'Jarvis RU Direct (Обход РФ)';

const DOMESTIC_DIRECT_SITES = Object.freeze([
  // Russian top-level domains (matches ALL .ru, .su, .рф services automatically)
  'domain:ru',
  'domain:su',
  'domain:xn--p1ai', // .рф
  'domain:xn--p1acf', // .рус
  'domain:xn--80aswg', // .сайт
  'domain:xn--80asehdb', // .онлайн
  'domain:xn--80adxhks', // .москва

  // Russian services on international TLDs (.com, .net, .me, .to, etc.)
  // Yandex
  'domain:yandex.net',
  'domain:yastatic.net',
  'domain:yandex.com',
  'domain:yandex.by',
  'domain:yandex.kz',

  // VK & Mail.ru
  'domain:vk.com',
  'domain:vk.me',
  'domain:userapi.com',
  'domain:vk-cdn.me',
  'domain:vk-portal.net',
  'domain:vkcache.com',
  'domain:vkuservideo.net',
  'domain:vkuseraudio.net',

  // Banks & FinTech
  'domain:sberbank.com',
  'domain:sber.me',
  'domain:sberauto.com',
  'domain:tinkoff.com',
  'domain:t-static.ru',
  'domain:vtb.com',
  'domain:alfabank.com',
  'domain:yoomoney.com',
  'domain:qiwi.com',
  'domain:tochka.com',
  'domain:moex.com',

  // Marketplaces, Delivery & Retail
  'domain:ozonusercontent.com',
  'domain:wbstatic.net',
  'domain:avito.st',
  'domain:chizhik.club',
  'domain:x5.ru',

  // Transport, Travel & Telecom
  'domain:2gis.com',
  'domain:doublegis.ru',
  'domain:wi-fi.ru',
  'domain:mosmetro.ru',
  'domain:pobeda.aero',
  'domain:taximaxim.ru',
  'domain:beeline.com',

  // Media, Career & Community
  'domain:habr.com',
  'domain:championat.com',
  'domain:4pda.to',
  'domain:max.ru',

  // Explicit core anchors
  'domain:gosuslugi.ru',
  'domain:sberbank.ru',
  'domain:tbank.ru',
  'domain:vtb.ru',
  'domain:alfabank.ru',
  'domain:ozon.ru',
  'domain:wildberries.ru',
  'domain:avito.ru',
  'domain:yandex.ru',
  'domain:ya.ru',
  'domain:cbr.ru',
  'domain:nalog.gov.ru',
  'domain:mos.ru',
  'domain:rzd.ru',
  'domain:2gis.ru',
]);

const DOMESTIC_DIRECT_IPS = Object.freeze([
  'geoip:ru',
  'geoip:private',
]);

const DEFAULT_PROXY_SITES = Object.freeze([
  'domain:instagram.com',
  'domain:cdninstagram.com',
  'domain:facebook.com',
  'domain:fbcdn.net',
  'domain:twitter.com',
  'domain:x.com',
  'domain:t.co',
  'domain:youtube.com',
  'domain:googlevideo.com',
  'domain:ytimg.com',
  'domain:discord.com',
  'domain:discord.gg',
  'domain:discordapp.com',
  'domain:discordapp.net',
  'domain:discordcdn.com',
  'domain:discord.media',
  'domain:gateway.discord.gg',
  'domain:status.discord.com',
  'domain:spotify.com',
  'domain:chatgpt.com',
  'domain:openai.com',
  'domain:t.me',
  'domain:telegram.org',
  'domain:telegram.dog',
  'domain:telesco.pe',
  'domain:brawlstarsgame.com',
  'domain:brawlstars.com',
  'domain:supercell.com',
  'domain:clashofclans.com',
  'domain:clashroyale.com',
]);

const DEFAULT_PROXY_IPS = Object.freeze([]);

const BLOCK_SITES = Object.freeze([]);

function buildHappRoutingProfile(options = {}) {
  return {
    Name: options.name || DEFAULT_ROUTING_NAME,
    // Explicit domestic rules stay direct; every unmatched destination uses
    // the active Happ VPN profile.
    GlobalProxy: 'true',
    RemoteDNSType: options.remoteDnsType || 'DoH',
    RemoteDNSDomain: options.remoteDnsDomain || 'https://cloudflare-dns.com/dns-query',
    RemoteDNSIP: options.remoteDnsIp || '1.1.1.1',
    DomesticDNSType: options.domesticDnsType || 'DoU',
    DomesticDNSDomain: options.domesticDnsDomain || '',
    DomesticDNSIP: options.domesticDnsIp || '77.88.8.8',
    Geoipurl: options.geoipUrl || '',
    Geositeurl: options.geositeUrl || '',
    LastUpdated: '',
    DnsHosts: {},
    DirectSites: [...(options.directSites || DOMESTIC_DIRECT_SITES)],
    DirectIp: [...(options.directIp || DOMESTIC_DIRECT_IPS)],
    ProxySites: [...(options.proxySites || DEFAULT_PROXY_SITES)],
    ProxyIp: options.proxyIp ? [...options.proxyIp] : [...DEFAULT_PROXY_IPS],
    BlockSites: [...(options.blockSites || BLOCK_SITES)],
    BlockIp: options.blockIp ? [...options.blockIp] : [],
    DomainStrategy: options.domainStrategy || 'IPIfNonMatch',
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
    '    - direct(geoip:ru)',
    '    - direct(geoip:private)',
    '    - direct(domain-suffix:.ru)',
    '    - direct(domain-suffix:.su)',
    '    - direct(domain-suffix:.xn--p1ai)',
    '    - direct(domain-suffix:vk.com)',
    '    - direct(domain-suffix:userapi.com)',
    '    - direct(domain-suffix:yandex.net)',
    '    - direct(domain-suffix:yastatic.net)',
    '    - direct(domain-suffix:yandex.com)',
    '    - direct(domain-suffix:tinkoff.com)',
    '    - direct(domain-suffix:sberbank.com)',
    '    - direct(domain-suffix:alfabank.com)',
    '    - direct(domain-suffix:vtb.com)',
    '    - direct(domain-suffix:qiwi.com)',
    '    - direct(domain-suffix:tochka.com)',
    '    - direct(domain-suffix:2gis.com)',
    '    - direct(domain-suffix:avito.st)',
    '    - direct(domain-suffix:ozonusercontent.com)',
    '    - direct(domain-suffix:wbstatic.net)',
    '    - direct(domain-suffix:wi-fi.ru)',
    '    - direct(domain-suffix:habr.com)',
    '    - direct(domain-suffix:championat.com)',
    '    - direct(domain-suffix:4pda.to)',
    '    - direct(domain-suffix:max.ru)',
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

function buildRoutingHtmlPage(options = {}) {
  const deeplink = buildHappRoutingDeeplink(options);
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Активация маршрутизации Happ — Jarvis</title>
  <meta http-equiv="refresh" content="0; url=${deeplink}">
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: #0f172a;
      color: #f8fafc;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 20px;
      text-align: center;
    }
    .card {
      background: #1e293b;
      padding: 36px 24px;
      border-radius: 20px;
      max-width: 440px;
      width: 100%;
      box-shadow: 0 12px 30px rgba(0,0,0,0.4);
      border: 1px solid #334155;
    }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 22px; margin: 0 0 12px; font-weight: 700; }
    p { font-size: 15px; color: #94a3b8; line-height: 1.5; margin: 0 0 28px; }
    .btn {
      display: block;
      background: #2563eb;
      color: #ffffff;
      text-decoration: none;
      font-weight: 600;
      font-size: 17px;
      padding: 16px 24px;
      border-radius: 12px;
      transition: background 0.2s, transform 0.1s;
    }
    .btn:active { transform: scale(0.98); }
    .btn-off {
      display: inline-block;
      margin-top: 14px;
      color: #94a3b8;
      text-decoration: underline;
      font-size: 14px;
      font-weight: 500;
    }
    .btn-off:hover { color: #f87171; }
    .hint { margin-top: 18px; font-size: 13px; color: #64748b; line-height: 1.4; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🌐</div>
    <h1>Jarvis RU Direct</h1>
    <p>Открываем приложение <b>Happ</b> для автоматической активации раздельной маршрутизации (Обход РФ)...</p>
    <a class="btn" href="${deeplink}">Активировать в Happ</a>
    <div><a class="btn-off" href="happ://routing/off">Отключить маршрутизацию в Happ</a></div>
    <div class="hint">Если появится диалог Safari/браузера, нажмите <b>«Открыть»</b>.</div>
  </div>
  <script>
    setTimeout(function() {
      window.location.href = ${JSON.stringify(deeplink)};
    }, 150);
  </script>
</body>
</html>`;
}

function buildRoutingSummary(options = {}) {
  const publicUrl = options.publicRoutingUrl || 'https://jarvis.rilora.ru/happ-routing';
  return [
    '🌐 **Раздельная маршрутизация (Обход РФ)**',
    '',
    'Позволяет **не отключать VPN**: Госуслуги, банки (Сбер, Т-Банк, ВТБ), маркетплейсы и все сайты `.ru` открываются **напрямую** с вашего домашнего/мобильного IP, а заблокированные ресурсы и YouTube — **через Hysteria 2**.',
    '',
    '🚀 **Активация в Happ за 1 клик:**',
    `👉 **[Нажмите сюда для активации в Happ](${publicUrl})**`,
    '',
    '📋 **Пошаговая инструкция:**',
    '1. **Нажмите на ссылку выше** (или кнопку «🚀 Активировать в Happ» под сообщением) — откроется браузер.',
    '2. В появившемся окне браузера нажмите **«Открыть»** для перехода в приложение Happ.',
    '3. Happ откроется и покажет диалог импорта — нажмите **«Добавить»**!',
    '',
    '📁 **Альтернатива (если ссылка не открылась):**',
    'К сообщению прикреплён файл `jarvis-ru-direct-routing.json`. В приложении Happ: **Настройки → Маршрутизация → «+»** → выберите этот файл.',
    '',
    '💡 *Настройка выполняется всего один раз — после этого правило «Jarvis RU Direct» действует автоматически для всех подключений.*',
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
  DEFAULT_PROXY_IPS,
  DEFAULT_PROXY_SITES,
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
};
