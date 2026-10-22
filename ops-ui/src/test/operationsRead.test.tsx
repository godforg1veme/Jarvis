// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useOperationsRead } from '../hooks/useOperationsRead';
import { ReadState } from '../components/ReadState';

afterEach(cleanup);

function ReadView({ loader, revision = 0 }: { loader: () => Promise<string>; revision?: number }) {
  const state = useOperationsRead(loader, revision);
  return <><ReadState {...state} hasData={state.data !== null} /><output>{state.data}</output></>;
}

it('rejects a late old snapshot after a new refresh, including its final loading state', async () => {
  let old!: (value: string) => void;
  let fresh!: (value: string) => void;
  const loader = vi.fn().mockImplementationOnce(() => new Promise<string>((resolve) => { old = resolve; }))
    .mockImplementationOnce(() => new Promise<string>((resolve) => { fresh = resolve; }));
  const view = render(<ReadView loader={loader} />);
  view.rerender(<ReadView loader={loader} revision={1} />);
  fresh('new snapshot');
  await screen.findByText('new snapshot');
  old('old snapshot');
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('new snapshot'));
  expect(screen.queryByText('old snapshot')).toBeNull();
  expect(screen.queryByText('Получаем данные…')).toBeNull();
});

it('retains data after failed refresh and clears stale warning after explicit read retry', async () => {
  const loader = vi.fn().mockResolvedValueOnce('last good').mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('recovered');
  const view = render(<ReadView loader={loader} />);
  await screen.findByText('last good');
  view.rerender(<ReadView loader={loader} revision={1} />);
  await screen.findByRole('alert');
  expect(screen.getByText('last good')).toBeTruthy();
  expect(screen.getByText('Показаны последние полученные данные.')).toBeTruthy();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Повторить' }));
  await screen.findByText('recovered');
  expect(screen.queryByRole('alert')).toBeNull();
  expect(loader).toHaveBeenCalledTimes(3);
});
