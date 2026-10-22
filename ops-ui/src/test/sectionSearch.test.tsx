import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SectionSearch } from '../components/orbital/SectionSearch';
import { dockForPage, dockItems, pageLabels, type PageKey } from '../components/orbital/navigation';

afterEach(cleanup);
beforeEach(() => { HTMLElement.prototype.scrollIntoView = vi.fn(); });
describe('compact navigation and section search', () => {
  it('makes every existing page reachable through exactly five dock groups', () => {
    expect(dockItems).toHaveLength(5);
    const pages = dockItems.flatMap((item) => [...item.pages]);
    expect(new Set(pages).size).toBe(Object.keys(pageLabels).length);
    for (const page of Object.keys(pageLabels) as PageKey[]) expect(dockForPage(page).pages).toContain(page);
  });
  it('finds a secondary page using its name and opens it with Enter', () => {
    const navigate = vi.fn();
    render(<SectionSearch onNavigate={navigate} />);
    const input = screen.getByRole('combobox', { name: 'Поиск по разделам' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'резерв' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(navigate).toHaveBeenCalledWith('backups');
    expect(screen.queryByRole('listbox')).toBeNull();
  });
  it('handles no matches and Escape without propagating to the workspace', () => {
    const navigate = vi.fn(), escape = vi.fn();
    render(<div onKeyDown={escape}><SectionSearch onNavigate={navigate} /></div>);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'несуществующий раздел' } });
    expect(screen.getByRole('status').textContent).toBe('Раздел не найден');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(navigate).not.toHaveBeenCalled();
    escape.mockClear();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(escape).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();
  });
  it('does not steal focus or navigate while a reassignment dialog is open', () => {
    const navigate = vi.fn();
    render(<><SectionSearch onNavigate={navigate} /><div className="modal-backdrop"><button>Закрыть</button></div></>);
    const button = screen.getByRole('button', { name: 'Закрыть' });
    button.focus();
    fireEvent.keyDown(document, { ctrlKey: true, key: 'k' });
    expect(document.activeElement).toBe(button);
    fireEvent.focus(screen.getByRole('combobox'));
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });
});
