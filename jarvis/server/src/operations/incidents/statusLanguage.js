function incidentSummary(service, kind) {
  if (kind === 'service_failed') return `${service.displayName} аварийно остановлен`;
  if (kind === 'no_fresh_data') return `Нет свежих данных от ${service.displayName}`;
  return `${service.displayName} недоступен или работает нестабильно`;
}

function incidentImpact(serviceKey) {
  const impacts = {
    'jarvis-server': 'Jarvis может не отвечать в Telegram и на подключённых устройствах.',
    postgres: 'Память, диалоги и другие облачные данные временно недоступны.',
    cloudflared: 'Внешние клиенты могут потерять доступ к Jarvis.',
    xray: 'VPN-клиенты Happ могут потерять доступ к интернету через VPS.',
    hysteria2: 'Резервный Hysteria2-профиль Happ может потерять доступ к интернету.',
    'vpn-host': 'Оба VPN-протокола могут работать нестабильно из-за состояния VPS.',
    'vpn-multi': 'Основной и резервный VPN-профили могут быть одновременно недоступны.',
    'telegram-parser': 'Отслеживание новых результатов парсером может быть остановлено.',
  };
  return impacts[serviceKey] || 'Часть функций Jarvis может быть временно недоступна.';
}

module.exports = { incidentImpact, incidentSummary };
