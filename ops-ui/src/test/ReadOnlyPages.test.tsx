// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EventsPage } from '../pages/EventsPage';
import { IncidentsPage } from '../pages/IncidentsPage';
import { BackupsPage } from '../pages/BackupsPage';
import { ParserPage } from '../pages/ParserPage';

const ok = (body: unknown) => ({ ok: true, json: async () => body });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it.each([
  ['events', EventsPage, { events: [] }, 'События', 'Событий пока нет.'],
  ['incidents', IncidentsPage, { incidents: [] }, 'Инциденты', 'СИСТЕМА СПОКОЙНА'],
  ['backups', BackupsPage, { backups: [] }, 'Резервные копии', 'НЕТ ЗАПИСАННЫХ ЗАПУСКОВ'],
  ['parser', ParserPage, { parser: { service: null, results: [] } }, 'Telegram Parser', 'Данные о сервисе парсера пока не получены.'],
] as const)('%s preserves heading and avoids empty success on initial failure', async (_name, Page, body, title, emptyText) => {
  let calls = 0;
  const fetchMock = vi.fn(async () => { if (calls++ === 0) throw new Error('offline'); return ok(body); });
  vi.stubGlobal('fetch', fetchMock);
  const user = userEvent.setup();
  render(<Page />);
  await screen.findByRole('alert');
  expect(screen.getByRole('heading', { name: title })).toBeTruthy();
  expect(screen.queryByText(emptyText)).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Повторить' }));
  await screen.findByText(emptyText);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('keeps last incidents after failed refresh without claiming the system is currently calm', async () => {
  let calls = 0;
  vi.stubGlobal('fetch', vi.fn(async () => {
    if (calls++ > 0) throw new Error('offline');
    return ok({ incidents: [] });
  }));
  const view = render(<IncidentsPage />);
  await screen.findByText('СИСТЕМА СПОКОЙНА');
  view.rerender(<IncidentsPage refreshToken={1} />);
  await screen.findByRole('alert');
  expect(screen.getByText('ПОСЛЕДНИЕ ДАННЫЕ')).toBeTruthy();
  expect(screen.queryByText('СИСТЕМА СПОКОЙНА')).toBeNull();
});

it('keeps event payload behind technical details and uses known labels', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ok({ events: [{ id: 'one', type: 'service.state_changed', serviceKey: 'postgres', createdAt: '2026-10-21T10:00:00Z', payload: { state: 'healthy' } }] })));
  render(<EventsPage />);
  await screen.findByText('Состояние сервиса изменилось');
  const details = screen.getByText('Технические данные').closest('details')!;
  expect(details.hasAttribute('open')).toBe(false);
  expect(details.textContent).toContain('healthy');
});

it('shows the last parser reading as stale after a failed refresh', async () => {
  let calls = 0;
  vi.stubGlobal('fetch', vi.fn(async () => {
    if (calls++ > 0) throw new Error('offline');
    return ok({ parser: { service: { key: 'telegram-parser', name: 'Parser', state: 'healthy', observedAt: null }, results: [] } });
  }));
  const view = render(<ParserPage />);
  await screen.findByText('Работает');
  view.rerender(<ParserPage refreshToken={1} />);
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  expect(screen.getByText('Работает · ранее')).toBeTruthy();
  expect(screen.getByText('Работает · ранее').className).toBe('unknown');
});
