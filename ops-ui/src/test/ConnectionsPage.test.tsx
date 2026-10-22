// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectionsPage } from '../pages/ConnectionsPage';
import type { ConnectionProfile } from '../types';

const profiles: ConnectionProfile[] = [
  { id: 'owner', displayName: 'Владелец', role: 'owner' as const, createdAt: '2026-09-01T00:00:00Z',
    telegram: [{ id: 'identity-1', externalId: '123456', connectedAt: '2026-09-01T00:00:00Z' }],
    devices: [{ id: 'device-1', name: 'Домашний ПК', status: 'online' as const, kind: 'computer' as const, lastSeenAt: null, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z' }] },
  { id: 'member', displayName: 'Участник', role: 'member' as const, createdAt: '2026-09-01T00:00:00Z', telegram: [], devices: [] },
];
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); sessionStorage.clear(); });

describe('ConnectionsPage', () => {
  it('renders profile, Telegram identity, and device metadata', async () => {
    render(<ConnectionsPage loader={async () => [{
      id: 'profile-1', displayName: 'Макс', role: 'owner', createdAt: '2026-09-01T00:00:00Z',
      telegram: [{ id: 'identity-1', externalId: '123456', connectedAt: '2026-09-01T00:00:00Z' }],
      devices: [{ id: 'device-1', name: 'Домашний ПК', status: 'online', kind: 'computer', lastSeenAt: '2026-09-04T10:00:00Z', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-04T10:00:00Z' }],
    }]} />);
    await waitFor(() => expect(screen.getByText('Макс')).toBeTruthy());
    expect(screen.getByText('ID 123456')).toBeTruthy();
    expect(screen.getByText('Домашний ПК')).toBeTruthy();
    expect(screen.getByText('В сети')).toBeTruthy();
  });

  it('submits a device move only once, keeps the pairing code, and refreshes revoked rows', async () => {
    let complete!: (value: { ok: boolean; json: () => Promise<unknown> }) => void;
    const pending = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => { complete = resolve; });
    const fetchMock = vi.fn(async () => pending);
    vi.stubGlobal('fetch', fetchMock);
    const loader = vi.fn(async () => loader.mock.calls.length === 1 ? profiles : [
      { ...profiles[0], devices: [{ ...profiles[0].devices[0], status: 'revoked' as const }] }, profiles[1],
    ]);
    const user = userEvent.setup();
    render(<ConnectionsPage loader={loader} />);
    await screen.findByText('Владелец');
    await user.click(screen.getAllByRole('button', { name: 'Переназначить' })[1]);
    await user.selectOptions(screen.getByLabelText('Целевой профиль'), 'member');
    const submit = screen.getByRole('dialog').querySelector<HTMLButtonElement>('button.danger')!;
    fireEvent.click(submit); fireEvent.click(submit);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Закрыть' }).hasAttribute('disabled')).toBe(true);
    complete({ ok: true, json: async () => ({ reassignment: { code: 'PAIR-123' } }) });
    await screen.findByText('PAIR-123');
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
    expect(screen.getByText('PAIR-123')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Переназначить' })).toHaveLength(1);
    expect(sessionStorage.getItem('jarvis-reassignment-pending:device:device-1')).toBeNull();
  });

  it('blocks mutation after stale read and when the source connection moved during refresh', async () => {
    let current = profiles;
    let fail = false;
    const loader = vi.fn(async () => { if (fail) throw new Error('offline'); return current; });
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ reassignment: { code: 'NEVER' } }) }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    const view = render(<ConnectionsPage loader={loader} />);
    await screen.findByText('Владелец');
    await user.click(screen.getAllByRole('button', { name: 'Переназначить' })[1]);
    await user.selectOptions(screen.getByLabelText('Целевой профиль'), 'member');
    current = [{ ...profiles[0], devices: [] }, { ...profiles[1], devices: profiles[0].devices }];
    view.rerender(<ConnectionsPage loader={loader} refreshToken={1} />);
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole('dialog').querySelector<HTMLButtonElement>('button.danger')!);
    expect(screen.getByRole('alert').textContent).toContain('не принадлежит исходному профилю');
    expect(fetchMock).not.toHaveBeenCalled();
    fail = true;
    view.rerender(<ConnectionsPage loader={loader} refreshToken={2} />);
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2));
    expect(screen.getByRole('dialog').querySelector<HTMLButtonElement>('button.danger')!.hasAttribute('disabled')).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps an unknown POST locked across close, reopen, and remount', async () => {
    const fetchMock = vi.fn(async () => { throw new Error('reply lost'); });
    vi.stubGlobal('fetch', fetchMock);
    const loader = async () => profiles;
    const user = userEvent.setup();
    const view = render(<ConnectionsPage loader={loader} />);
    await screen.findByText('Владелец');
    await user.click(screen.getAllByRole('button', { name: 'Переназначить' })[1]);
    await user.selectOptions(screen.getByLabelText('Целевой профиль'), 'member');
    await user.click(screen.getByRole('dialog').querySelector<HTMLButtonElement>('button.danger')!);
    await screen.findByText(/Итог прежнего переназначения не подтверждён/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('jarvis-reassignment-pending:device:device-1')).toBe('1');
    await user.click(screen.getByRole('button', { name: 'Закрыть' }));
    await user.click(screen.getAllByRole('button', { name: 'Переназначить' })[1]);
    expect(screen.getByRole('dialog').querySelector<HTMLButtonElement>('button.danger')!.disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Закрыть' }));
    view.unmount();
    render(<ConnectionsPage loader={loader} />);
    await screen.findByText('Владелец');
    await user.click(screen.getAllByRole('button', { name: 'Переназначить' })[1]);
    await user.selectOptions(screen.getByLabelText('Целевой профиль'), 'member');
    expect(screen.getByRole('dialog').querySelector<HTMLButtonElement>('button.danger')!.disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not send POST when pending marker cannot be stored', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ reassignment: { code: 'UNSENT' } }) }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage blocked'); });
    const user = userEvent.setup();
    render(<ConnectionsPage loader={async () => profiles} />);
    await screen.findByText('Владелец');
    await user.click(screen.getAllByRole('button', { name: 'Переназначить' })[1]);
    await user.selectOptions(screen.getByLabelText('Целевой профиль'), 'member');
    await user.click(screen.getByRole('dialog').querySelector<HTMLButtonElement>('button.danger')!);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('Без локальной записи состояния');
    expect(screen.getByRole('dialog').querySelector<HTMLButtonElement>('button.danger')!.disabled).toBe(true);
  });
});
