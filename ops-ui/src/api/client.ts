import type { Backup, ConnectionProfile, Incident, Metric, OperationResult, OpsEvent, Overview, PanelSession, ParserData, Service } from '../types';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/ops/api${path}`, { ...init, credentials: 'same-origin' });
  if (!response.ok) throw new ApiError(response.status, response.status === 401 ? 'Требуется подтверждение браузера' : 'Запрос к панели не выполнен');
  return response.json() as Promise<T>;
}

export async function getOverview() { return (await request<{ overview: Overview }>('/overview')).overview; }
export type HealthCheck = { key: string; state: string; summary: string; checkedAt: string };
export async function getHealthChecks() { return (await request<{ checks: HealthCheck[] }>('/checks')).checks; }
export type Inventory = { items: { name: string; type: string; state: string }[]; unavailable: string[] };
export async function getInventory() { return (await request<{ inventory: Inventory }>('/inventory')).inventory; }
export async function getServices() { return (await request<{ services: Service[] }>('/services')).services; }
export async function getMetrics(id = 'host') { return (await request<{ metrics: Metric[] }>(`/services/${encodeURIComponent(id)}/metrics`)).metrics; }
export async function getServiceLogs(id: string, limit = 120) { return request<{ state: string; logs: string[] }>(`/services/${encodeURIComponent(id)}/logs?limit=${limit}`); }
export async function runServiceAction(id: string, action: 'start' | 'stop' | 'restart') {
  const storageKey = `jarvis-operation:${id}:${action}`;
  const key = sessionStorage.getItem(storageKey) || crypto.randomUUID();
  sessionStorage.setItem(storageKey, key);
  const result = (await request<{ operation: OperationResult }>(`/services/${encodeURIComponent(id)}/actions/${action}`, { method: 'POST', headers: { 'idempotency-key': key } })).operation;
  if (['succeeded', 'failed', 'cancelled'].includes(result.status)) sessionStorage.removeItem(storageKey);
  return result;
}
export async function getIncidents() { return (await request<{ incidents: Incident[] }>('/incidents?limit=100')).incidents; }
export async function getEvents() { return (await request<{ events: OpsEvent[] }>('/events?limit=100')).events; }
export async function getBackups() { return (await request<{ backups: Backup[] }>('/backups?limit=100')).backups; }
export async function getParser() { return (await request<{ parser: ParserData }>('/parser?limit=100')).parser; }
export async function getConnections() { return (await request<{ profiles: ConnectionProfile[] }>('/connections')).profiles; }
export async function reassignTelegram(id: string, targetUserId: string) { return request(`/connections/telegram/${encodeURIComponent(id)}/reassign`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ targetUserId }) }); }
export async function reassignDevice(id: string, targetUserId: string) { return request<{ reassignment: { code: string; expiresAt: string } }>(`/connections/devices/${encodeURIComponent(id)}/reassign`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ targetUserId }) }); }
export async function getSessions() { return (await request<{ sessions: PanelSession[] }>('/sessions')).sessions; }
export async function revokeSession(id: string) { return request<{ ok: true; current: boolean }>(`/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
export async function logout() { return request<{ ok: true }>('/session/logout', { method: 'POST' }); }
export async function requestApproval(label: string) {
  return request<{ id: string; state: string; expiresAt: string }>('/session/request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label }) });
}
export async function pollApproval(id: string) { return request<{ state: string }>(`/session/request/${encodeURIComponent(id)}`); }
