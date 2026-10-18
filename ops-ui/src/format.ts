export const statusLabels: Record<string, string> = {
  healthy: 'Работает', degraded: 'Требует внимания', unavailable: 'Недоступен', no_fresh_data: 'Нет свежих данных', unknown: 'Неизвестно',
  online: 'В сети', offline: 'Не в сети', revoked: 'Отключено',
};

export function dateLabel(value: string | null) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return 'нет данных';
  return new Intl.DateTimeFormat('ru-RU', { timeZone: 'Etc/GMT-3', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(value)) + ' МСК';
}

export function serviceTag(key: string) {
  return ({ 'jarvis-server': 'APP', postgres: 'DB', cloudflared: 'NET', 'telegram-parser': 'PARSE' } as Record<string, string>)[key] || 'SYS';
}
