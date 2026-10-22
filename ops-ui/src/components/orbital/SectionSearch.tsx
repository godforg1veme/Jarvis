import { useEffect, useId, useRef, useState } from 'react';
import { dockForPage, pageLabels, type PageKey } from './navigation';
import { InterfaceIcon } from './InterfaceIcon';

const descriptions: Record<PageKey, string> = {
  overview: 'Общее состояние Jarvis', infrastructure: 'Узлы, нагрузка, память и диск',
  services: 'Состояние и управление сервисами', connections: 'Подключённые устройства',
  parser: 'Источники и результаты парсера', incidents: 'Ошибки и доступность',
  events: 'Журнал событий системы', backups: 'История резервных копий', sessions: 'Браузеры и доступ',
};
const aliases: Record<PageKey, string> = {
  overview: 'core system', infrastructure: 'vps cpu ram disk', services: 'server postgres cloudflare',
  connections: 'devices компьютер telegram', parser: 'parser telegram', incidents: 'incidents error сбои',
  events: 'logs логи activity', backups: 'backup копии обслуживание', sessions: 'sessions security обслуживание',
};

export function SectionSearch({ onNavigate }: { onNavigate: (page: PageKey) => void }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const normalized = query.trim().toLocaleLowerCase('ru');
  const results = (Object.keys(pageLabels) as PageKey[]).filter((page) => `${pageLabels[page]} ${descriptions[page]} ${aliases[page]}`.toLocaleLowerCase('ru').includes(normalized));
  const choose = (page: PageKey) => {
    if (document.querySelector('dialog[open], .modal-backdrop')) return;
    setOpen(false); setQuery(''); input.current?.blur(); onNavigate(page);
  };

  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        if (document.querySelector('dialog[open], .modal-backdrop')) return;
        event.preventDefault(); input.current?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', shortcut);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', shortcut); };
  }, []);

  useEffect(() => { if (open && results[active]) document.getElementById(`${listId}-${results[active]}`)?.scrollIntoView({ block: 'nearest' }); }, [open, active, query, listId]);

  return <div className="section-search" ref={root} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false); }}>
    <div className="section-search-field"><InterfaceIcon name="search" /><input ref={input} role="combobox" aria-label="Поиск по разделам" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={open && results[active] ? `${listId}-${results[active]}` : undefined} placeholder="Поиск по системе" value={query} onFocus={() => {
      const modal = document.querySelector<HTMLElement>('dialog[open], .modal-backdrop');
      if (modal) { input.current?.blur(); modal.querySelector<HTMLElement>('button:not(:disabled),select')?.focus(); return; }
      setOpen(true); setActive(0);
    }} onChange={(event) => { setQuery(event.target.value); setActive(0); setOpen(true); }} onKeyDown={(event) => {
      if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); input.current?.blur(); }
      else if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActive((value) => results.length ? (value + 1) % results.length : 0); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); setActive((value) => results.length ? (value - 1 + results.length) % results.length : 0); }
      else if (event.key === 'Enter' && open && results[active]) { event.preventDefault(); choose(results[active]); }
    }} /><kbd aria-hidden="true">Ctrl K</kbd></div>
    {open && <div className="section-search-popover"><p>Разделы системы</p><ul id={listId} role="listbox" aria-label="Результаты поиска">{results.map((page, index) => <li id={`${listId}-${page}`} key={page} role="option" aria-selected={active === index} onMouseEnter={() => setActive(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(page)}><InterfaceIcon name={dockForPage(page).icon} /><span><b>{pageLabels[page]}</b><small>{descriptions[page]}</small></span><InterfaceIcon name="arrow" /></li>)}</ul>{!results.length && <div className="search-empty" role="status">Раздел не найден</div>}</div>}
  </div>;
}
