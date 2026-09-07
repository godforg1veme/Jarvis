import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConnectionsPage } from '../pages/ConnectionsPage';

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
});
