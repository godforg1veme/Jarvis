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
    'telegram-parser': 'Отслеживание новых результатов парсером может быть остановлено.',
  };
  return impacts[serviceKey] || 'Часть функций Jarvis может быть временно недоступна.';
}

module.exports = { incidentImpact, incidentSummary };
