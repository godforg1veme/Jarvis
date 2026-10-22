import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '../components/AppShell';
import { pageLabels, pagesForPlanet, planetForPage, planets, type PageKey } from '../components/orbital/navigation';

vi.mock('../components/orbital/OrbitalScene', () => ({ default: () => <div>Scene fixture</div> }));
afterEach(cleanup);
beforeEach(() => { window.history.replaceState(null, '', '/'); });

describe('orbital navigation', () => {
  it('keeps all nine existing pages in one unambiguous group', () => {
    const covered: PageKey[] = ['overview', ...planets.flatMap((planet) => planet.pages)];
    expect(new Set(covered).size).toBe(9);
    expect(covered.length).toBe(9);
    for (const page of Object.keys(pageLabels) as PageKey[]) expect(pagesForPlanet(planetForPage(page))).toContain(page);
  });
  it('opens real content and closes back to the system without changing access', async () => {
    const navigate = vi.fn();
    render(<AppShell page="overview" onNavigate={navigate}><h1>Обзор</h1><p>Real page content</p></AppShell>);
    expect(screen.queryByRole('main')).toBeNull();
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Основная навигация' })).getByRole('button', { name: /Обзор/ }));
    expect(navigate).toHaveBeenCalledWith('overview');
    expect(screen.getByRole('main').textContent).toContain('Real page content');
    expect(document.activeElement).toBe(screen.getByRole('main'));
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть рабочую область' }));
    expect(screen.queryByRole('main')).toBeNull();
    expect(document.activeElement?.getAttribute('data-nav')).toBe('core');
  });
  it('preserves deep links, group subtabs and expand state', () => {
    window.history.replaceState(null, '', '/#/events');
    const navigate = vi.fn();
    render(<AppShell page="events" onNavigate={navigate}><h1>События</h1></AppShell>);
    const subtabs = screen.getByRole('navigation', { name: 'Подразделы' });
    expect(within(subtabs).getByRole('button', { name: 'События' }).getAttribute('aria-current')).toBe('page');
    fireEvent.click(within(subtabs).getByRole('button', { name: 'Инциденты' }));
    expect(navigate).toHaveBeenCalledWith('incidents');
    fireEvent.click(screen.getByRole('button', { name: 'Расширить рабочую область' }));
    expect(screen.getByRole('button', { name: 'Свернуть рабочую область' }).getAttribute('aria-pressed')).toBe('true');
  });
  it('skip link focuses navigation without corrupting the hash route', () => {
    render(<AppShell page="overview" onNavigate={vi.fn()}>content</AppShell>);
    fireEvent.click(screen.getByRole('link', { name: 'Перейти к разделам' }));
    expect(window.location.hash).toBe('');
    expect(document.activeElement?.id).toBe('orbital-navigation');
  });
  it('Escape returns focus to the current planet after changing pages', () => {
    window.history.replaceState(null, '', '/#/events');
    const { rerender } = render(<AppShell page="events" onNavigate={vi.fn()}>events</AppShell>);
    rerender(<AppShell page="services" onNavigate={vi.fn()}>services</AppShell>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('main')).toBeNull();
    expect(document.activeElement?.getAttribute('data-nav')).toBe('services');
  });
});
