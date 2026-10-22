// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ServicesPage } from '../pages/ServicesPage';

const sample = [
  { key: 'jarvis-server', name: 'Jarvis Server', state: 'healthy', observedAt: '2026-10-21T10:00:00Z', capabilities: ['restart'] },
  { key: 'postgres', name: 'PostgreSQL', state: 'offline', observedAt: null, capabilities: [] },
];
const response = (body: unknown) => ({ ok: true, json: async () => body });

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('filters attention states and preserves a user-collapsed row across refresh', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => response({ services: sample })));
  const user = userEvent.setup();
  const view = render(<ServicesPage />);
  const server = await screen.findByRole('button', { name: /Jarvis Server/ });
  expect(server.getAttribute('aria-expanded')).toBe('true');
  await user.click(server);
  expect(server.getAttribute('aria-expanded')).toBe('false');
  view.rerender(<ServicesPage refreshToken={1} />);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(server.getAttribute('aria-expanded')).toBe('false');
  await user.click(screen.getByRole('button', { name: 'Требуют внимания (1)' }));
  expect(screen.queryByRole('button', { name: /Jarvis Server/ })).toBeNull();
  expect(screen.getByRole('button', { name: /PostgreSQL/ })).toBeTruthy();
});

it('shows only granted commands and requires confirmation before action', async () => {
  const fetchMock = vi.fn(async (url: string) => response(url.endsWith('/services') ? { services: sample } : { operation: { status: 'succeeded' } }));
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('crypto', { randomUUID: () => 'test-operation-id' });
  const user = userEvent.setup();
  render(<ServicesPage />);
  await screen.findByRole('button', { name: 'Перезапустить' });
  expect(screen.queryByRole('button', { name: 'Остановить' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Перезапустить' }));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole('button', { name: 'Выполнить' }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(screen.getByRole('status').textContent).toContain('Операция успешно завершена');
});

it('retains the action result after switching rows during a delayed response and restores focus', async () => {
  let finish!: (value: ReturnType<typeof response>) => void;
  const pending = new Promise<ReturnType<typeof response>>((resolve) => { finish = resolve; });
  const fetchMock = vi.fn(async (url: string) => url.endsWith('/services') ? response({ services: sample }) : pending);
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('crypto', { randomUUID: () => 'delayed-operation-id' });
  const user = userEvent.setup();
  render(<ServicesPage />);
  await user.click(await screen.findByRole('button', { name: 'Перезапустить' }));
  await user.click(screen.getByRole('button', { name: 'Выполнить' }));
  const server = screen.getByRole('button', { name: /Jarvis Server/ });
  await waitFor(() => expect(document.activeElement).toBe(server));
  await user.click(screen.getByRole('button', { name: /PostgreSQL/ }));
  finish(response({ operation: { status: 'succeeded' } }));
  await user.click(server);
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Операция успешно завершена'));
});

it('rejects an action whose capability was revoked while confirmation was open', async () => {
  let requests = 0;
  const fetchMock = vi.fn(async () => response({ services: requests++ === 0 ? sample : sample.map((service) =>
    service.key === 'jarvis-server' ? { ...service, capabilities: [] } : service) }));
  vi.stubGlobal('fetch', fetchMock);
  const user = userEvent.setup();
  const view = render(<ServicesPage />);
  await user.click(await screen.findByRole('button', { name: 'Перезапустить' }));
  view.rerender(<ServicesPage refreshToken={1} />);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  await user.click(screen.getByRole('button', { name: 'Выполнить' }));
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('status').textContent).toContain('Команда больше недоступна');
  expect(screen.getByText(/Только наблюдение/)).toBeTruthy();
});

it.each([
  ['failed', 'error', 'Команда не выполнена'],
  ['unknown', 'unknown', 'Итог операции не подтверждён'],
  ['queued', 'pending', 'Команда принята в очередь'],
])('labels %s result without exposing server error codes', async (status, tone, message) => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => response(url.endsWith('/services')
    ? { services: sample } : { operation: { status, errorCode: 'SECRET_INTERNAL_CODE' } })));
  vi.stubGlobal('crypto', { randomUUID: () => 'result-operation-id' });
  const user = userEvent.setup();
  render(<ServicesPage />);
  await user.click(await screen.findByRole('button', { name: 'Перезапустить' }));
  await user.click(screen.getByRole('button', { name: 'Выполнить' }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain(message));
  expect(screen.getByRole('status').className).toContain(tone);
  expect(screen.queryByText(/SECRET_INTERNAL_CODE/)).toBeNull();
});

it('marks stale service data and refreshes the list with GET without sending a command', async () => {
  let calls = 0;
  const fetchMock = vi.fn(async (url: string) => {
    if (!url.endsWith('/services')) throw new Error('Unexpected mutation');
    calls += 1;
    if (calls === 2) throw new Error('Temporary failure');
    return response({ services: sample });
  });
  vi.stubGlobal('fetch', fetchMock);
  const user = userEvent.setup();
  render(<ServicesPage />);
  await screen.findByText('1 из 2 работают');
  await user.click(screen.getByRole('button', { name: 'Обновить список сервисов' }));
  await screen.findByRole('alert');
  expect(screen.getByText(/Последние данные: 1 из 2 работали/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Перезапустить' }).hasAttribute('disabled')).toBe(true);
  await user.click(screen.getByRole('button', { name: 'Обновить список сервисов' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(screen.getByText('1 из 2 работают')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Перезапустить' }).hasAttribute('disabled')).toBe(false);
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it('retries unavailable logs with GET and keeps the modal open', async () => {
  let logsCalls = 0;
  const fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith('/services')) return response({ services: sample });
    if (url.includes('/logs?')) return response(logsCalls++ === 0
      ? { state: 'unknown', logs: [] } : { state: 'succeeded', logs: ['recovered log'] });
    throw new Error('Unexpected mutation');
  });
  vi.stubGlobal('fetch', fetchMock);
  const user = userEvent.setup();
  render(<ServicesPage />);
  await user.click(await screen.findByRole('button', { name: /Логи Просмотр логов сервиса/ }));
  await screen.findByText('Логи временно недоступны.');
  await user.click(screen.getByRole('button', { name: 'Повторить загрузку логов' }));
  await screen.findByText('recovered log');
  expect(fetchMock).toHaveBeenCalledTimes(3);
});
