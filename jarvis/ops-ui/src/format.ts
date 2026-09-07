export const statusLabels: Record<string, string> = {
  healthy: 'Работает', degraded: 'Требует внимания', unavailable: 'Недоступен', no_fresh_data: 'Нет свежих данных', unknown: 'Неизвестно',
  online: 'В сети', offline: 'Не в сети', revoked: 'Отключено',
};

export function dateLabel(value: string | null) {
  if (!value) return 'нет данных';
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(value));
}

export function serviceTag(key: string) {
  return ({ 'jarvis-server': 'APP', postgres: 'DB', cloudflared: 'NET', 'telegram-parser': 'PARSE' } as Record<string, string>)[key] || 'SYS';
}
