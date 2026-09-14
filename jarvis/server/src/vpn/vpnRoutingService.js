const DEFAULT_ROUTING_NAME = 'Jarvis RU Direct (Обход РФ)';

const DOMESTIC_DIRECT_SITES = Object.freeze([
  // Russian top-level domains
  'domain:ru',
  'domain:su',
  'domain:xn--p1ai', // .рф
  'domain:xn--p1acf', // .рус
  'domain:xn--c1avg', // .орг
  'domain:xn--80aswg', // .сайт
  'domain:xn--80asehdb', // .онлайн
  'domain:xn--80adxhks', // .москва

  // Government & Public services
  'domain:gosuslugi.ru',
  'domain:gu-st.ru',
  'domain:esia.gosuslugi.ru',
  'domain:nalog.gov.ru',
  'domain:nalog.ru',
  'domain:mos.ru',
  'domain:mosreg.ru',
  'domain:pgu.mos.ru',
  'domain:cbr.ru',
  'domain:sfr.gov.ru',
  'domain:pfr.gov.ru',
  'domain:fss.ru',
  'domain:zakupki.gov.ru',
  'domain:pravo.gov.ru',
  'domain:gov.ru',
  'domain:customs.gov.ru',
  'domain:mvd.gov.ru',
  'domain:gibdd.ru',
  'domain:sudrf.ru',
  'domain:fssp.gov.ru',
  'domain:rosreestr.gov.ru',
  'domain:kremlin.ru',

  // Banks & FinTech
  'domain:sberbank.ru',
  'domain:sberbank.com',
  'domain:sber.ru',
  'domain:sber.me',
  'domain:sberauto.com',
  'domain:sberid.ru',
  'domain:sberdevices.ru',
  'domain:domclick.ru',
  'domain:tbank.ru',
  'domain:tinkoff.ru',
  'domain:t-bank.ru',
  'domain:t-static.ru',
  'domain:tinkoff.com',
  'domain:vtb.ru',
  'domain:vtb.com',
  'domain:multibonus.ru',
  'domain:alfabank.ru',
  'domain:alfa-bank.ru',
  'domain:alfabank.com',
  'domain:gazprombank.ru',
  'domain:gpb.ru',
  'domain:sovcombank.ru',
  'domain:halvacard.ru',
  'domain:raiffeisen.ru',
  'domain:rosbank.ru',
  'domain:psbank.ru',
  'domain:open.ru',
  'domain:bspb.ru',
  'domain:mkb.ru',
  'domain:rshb.ru',
  'domain:pochtabank.ru',
  'domain:yoomoney.ru',
  'domain:yoomoney.com',
  'domain:qiwi.com',
  'domain:qiwi.ru',
  'domain:tochka.com',
  'domain:modulbank.ru',
  'domain:blank.ru',
  'domain:moex.com',
  'domain:spbexchange.ru',
  'domain:nspk.ru',
  'domain:sbp.nspk.ru',
  'domain:mironline.ru',
  'domain:mir-pay.ru',

  // Yandex Ecosystem
  'domain:yandex.ru',
  'domain:ya.ru',
  'domain:yandex.net',
  'domain:yandex.com',
  'domain:yandex.by',
  'domain:yandex.kz',
  'domain:yastatic.net',
  'domain:kinopoisk.ru',
  'domain:auto.ru',
  'domain:dzen.ru',
  'domain:dzeninfra.ru',

  // VK & Mail.ru Ecosystem
  'domain:vk.com',
  'domain:vk.ru',
  'domain:vk.me',
  'domain:userapi.com',
  'domain:vk-portal.net',
  'domain:vk-cdn.me',
  'domain:vkcache.com',
  'domain:vkuservideo.net',
  'domain:vkuseraudio.net',
  'domain:mail.ru',
  'domain:my.mail.ru',
  'domain:cloud.mail.ru',
  'domain:ok.ru',
  'domain:odnoklassniki.ru',
  'domain:rutube.ru',
  'domain:rutube.video',
  'domain:sferum.ru',
  'domain:max.ru',

  // Marketplaces, Delivery & Retail
  'domain:ozon.ru',
  'domain:ozonusercontent.com',
  'domain:ozonstaging.ru',
  'domain:wildberries.ru',
  'domain:wb.ru',
  'domain:wbstatic.net',
  'domain:avito.ru',
  'domain:avito.st',
  'domain:megamarket.ru',
  'domain:sbermegamarket.ru',
  'domain:samokat.ru',
  'domain:kuper.ru',
  'domain:vprok.ru',
  'domain:perekrestok.ru',
  'domain:pyaterochka.ru',
  'domain:chizhik.club',
  'domain:x5.ru',
  'domain:magnit.ru',
  'domain:dns-shop.ru',
  'domain:mvideo.ru',
  'domain:eldorado.ru',
  'domain:citilink.ru',
  'domain:aliexpress.ru',
  'domain:lamoda.ru',
  'domain:lemanapro.ru',
  'domain:leroymerlin.ru',
  'domain:vseinstrumenti.ru',
  'domain:apteka.ru',
  'domain:eapteka.ru',
  'domain:rigla.ru',
  'domain:zdravcity.ru',

  // Transport, Travel & Telecom
  'domain:rzd.ru',
  'domain:aeroflot.ru',
  'domain:s7.ru',
  'domain:pobeda.aero',
  'domain:utair.ru',
  'domain:uralairlines.ru',
  'domain:2gis.ru',
  'domain:2gis.com',
  'domain:doublegis.ru',
  'domain:aviasales.ru',
  'domain:tutu.ru',
  'domain:wi-fi.ru',
  'domain:mosmetro.ru',
  'domain:transport.mos.ru',
  'domain:belkacar.ru',
  'domain:delimobil.ru',
  'domain:citydrive.ru',
  'domain:taximaxim.ru',
  'domain:beeline.ru',
  'domain:beeline.com',
  'domain:mts.ru',
  'domain:mgts.ru',
  'domain:mtsbank.ru',
  'domain:megafon.ru',
  'domain:t2.ru',
  'domain:tele2.ru',
  'domain:rostelecom.ru',
  'domain:rt.ru',
  'domain:dom.ru',
  'domain:yota.ru',

  // Media, Career, Auto & Community
  'domain:hh.ru',
  'domain:headhunter.ru',
  'domain:superjob.ru',
  'domain:cian.ru',
  'domain:drom.ru',
  'domain:drive2.ru',
  'domain:sports.ru',
  'domain:championat.com',
  'domain:rbc.ru',
  'domain:kommersant.ru',
  'domain:ria.ru',
  'domain:tass.ru',
  'domain:lenta.ru',
  'domain:gazeta.ru',
  'domain:pikabu.ru',
  'domain:habr.com',
  'domain:4pda.to',
  'domain:4pda.ru',
]);

const DOMESTIC_DIRECT_IPS = Object.freeze([
  'geoip:ru',
  'geoip:private',
]);

const DEFAULT_PROXY_SITES = Object.freeze([
  'geosite:supercell',
  'domain:brawlstarsgame.com',
  'domain:brawlstars.com',
  'domain:supercell.com',
  'domain:clashofclans.com',
  'domain:clashroyale.com',
  'geosite:google',
  'geosite:youtube',
  'geosite:telegram',
  'domain:t.me',
  'domain:telegram.org',
  'domain:telegram.dog',
  'domain:telesco.pe',
  'geosite:instagram',
  'geosite:twitter',
  'geosite:facebook',
  'geosite:openai',
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
  'geosite:discord',
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
]);

const DEFAULT_PROXY_IPS = Object.freeze([
  'geoip:telegram',
]);

const BLOCK_SITES = Object.freeze([
  'geosite:category-ads-all',
]);

function buildHappRoutingProfile(options = {}) {
  return {
    Name: options.name || DEFAULT_ROUTING_NAME,
    GlobalProxy: 'false',
    RemoteDNSType: options.remoteDnsType || 'DoH',
    RemoteDNSDomain: options.remoteDnsDomain || 'https://cloudflare-dns.com/dns-query',
    RemoteDNSIP: options.remoteDnsIp || '1.1.1.1',
    DomesticDNSType: options.domesticDnsType || 'DoU',
    DomesticDNSDomain: options.domesticDnsDomain || '',
    DomesticDNSIP: options.domesticDnsIp || '77.88.8.8',
    Geoipurl: options.geoipUrl || 'https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geoip.dat',
    Geositeurl: options.geositeUrl || 'https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geosite.dat',
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
