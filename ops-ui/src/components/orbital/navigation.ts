export type PageKey = 'overview' | 'infrastructure' | 'services' | 'connections' | 'parser' | 'incidents' | 'events' | 'backups' | 'sessions';
export type PlanetKey = 'infrastructure' | 'services' | 'connections' | 'parser' | 'activity' | 'maintenance';
export type SceneSelection = PlanetKey | 'core' | null;

export const pageLabels: Record<PageKey, string> = {
  overview: 'Обзор', infrastructure: 'Инфраструктура', services: 'Сервисы',
  connections: 'Устройства', parser: 'Парсер', incidents: 'Инциденты',
  events: 'События', backups: 'Резервные копии', sessions: 'Сессии',
};

export const planets: { key: PlanetKey; label: string; caption: string; pages: PageKey[]; position: [number, number, number]; radius: number }[] = [
  { key: 'infrastructure', label: 'Инфраструктура', caption: 'Узлы и ресурсы', pages: ['infrastructure'], position: [-4.4, 1.5, -1.3], radius: .54 },
  { key: 'services', label: 'Сервисы', caption: 'Рабочие контуры', pages: ['services'], position: [3.1, 2.1, -1.1], radius: .66 },
  { key: 'connections', label: 'Устройства', caption: 'Точки подключения', pages: ['connections'], position: [-3.3, -1.85, 1.2], radius: .43 },
  { key: 'parser', label: 'Парсер', caption: 'Источники данных', pages: ['parser'], position: [1.1, -2.5, 1.1], radius: .38 },
  { key: 'activity', label: 'События', caption: 'Инциденты и журнал', pages: ['incidents', 'events'], position: [4.55, -.75, .3], radius: .47 },
  { key: 'maintenance', label: 'Обслуживание', caption: 'Копии и сессии', pages: ['backups', 'sessions'], position: [-.7, 2.9, -2], radius: .36 },
];

export function planetForPage(page: PageKey): SceneSelection {
  return page === 'overview' ? 'core' : planets.find((planet) => planet.pages.includes(page))?.key ?? null;
}

export function pagesForPlanet(key: SceneSelection): PageKey[] {
  return key === 'core' ? ['overview'] : planets.find((planet) => planet.key === key)?.pages ?? [];
}

// Five compact destinations; secondary pages remain available in the workspace.
export const dockItems = [
  { key: 'core', label: 'Обзор и обслуживание', icon: 'system', pages: ['overview', 'backups', 'sessions'] },
  { key: 'infrastructure', label: 'Инфраструктура', icon: 'server', pages: ['infrastructure'] },
  { key: 'services', label: 'Сервисы и парсер', icon: 'orbit', pages: ['services', 'parser'] },
  { key: 'connections', label: 'Устройства', icon: 'device', pages: ['connections'] },
  { key: 'activity', label: 'События и инциденты', icon: 'pulse', pages: ['incidents', 'events'] },
] as const;

export function dockForPage(page: PageKey) {
  return dockItems.find((item) => (item.pages as readonly PageKey[]).includes(page))!;
}
