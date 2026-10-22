# Orbital monitoring implementation plan

**Goal:** Apply the approved orbital visual system to the existing Operations UI.

**Architecture:** Keep the authenticated App and all page components. Replace
AppShell with an orbital navigator and a contextual workspace. A lazy R3F scene
uses the same route model as accessible HTML controls.

**Tech stack:** React 19, TypeScript, Vite, React Three Fiber 9, Three.js.

**Spec:** [Approved design](../specs/2026-10-20-orbital-monitoring-design.md).

## Constraints / Ограничения

No backend, authentication, API or confirmation changes. Keep all nine routes.
The approved sky asset ships locally; no new effect libraries. Fixture data must not ship in
the application. This is local development; no push or deployment.

## 1. Shared route model and scene / Модель и сцена

- [x] Create `ops-ui/src/components/orbital/navigation.ts`: export PageKey,
  PlanetKey, planet definitions, `planetForPage(page)` and `pagesForPlanet(key)`.
  Map infrastructure/services/connections/parser individually, incidents/events
  together, backups/sessions together; overview belongs to the core.
- [x] Create `OrbitalScene.tsx` and focused scene modules owned by the scene
  implementer. Contract: selected PlanetKey or 'core' or null; onSelect;
  paused/reducedMotion flags. Scene supplies only visual navigation.
- [x] Render a procedural core, six distinct planets, fine orbits and sparse
  stars. Interpolate camera position when a workspace opens. Invalidate frames
  only while visible/unpaused or transitions require them.
- [x] Verify with `npm run build --prefix ops-ui` and an actual WebGL browser.

## 2. Shell and existing content / Оболочка и содержимое

- [x] Replace `AppShell.tsx` retaining its page/onNavigate/children contract;
  accept initial overview for factual system summary. HTML navigation remains
  usable before scene load and after WebGL failure.
- [x] Add `orbital.css`, imported after existing styles. Scope scene layout,
  neutral typography, cards, responsive tables and modal styling. Keep semantic
  error colors, labels and focus rings.
- [x] Add workspace close/expand controls, group subtabs, Escape handling and
  explicit compact navigation. Preserve hash routes and browser history.
- [x] Update main.tsx only for shell props/styles; preserve access bootstrap,
  SSE, page rendering and action callbacks.
- [x] Test route groups, current selection, close/reopen, subtabs and fallback
  using Testing Library with a mocked scene.

## 3. Browser verification and handoff / Проверка и передача

- [x] Extend local browser fixtures with orbital navigation and overview/focus
  screenshots, without adding a production preview or login bypass.
- [x] Run `npm test --prefix ops-ui` and `npm run build --prefix ops-ui`.
- [x] Run existing bootstrap and service dialog browser checks, plus all nine
  routes at 1440/390/320 px. Confirm no overflow or runtime exceptions.
- [x] Verify pause/reduced motion, WebGL fallback, keyboard navigation, browser
  history and responsive focused workspaces. Inspect screenshots and fix defects.
- [x] Independently review the final diff and resolve actionable findings.
- [x] Update bilingual current status and verification docs with actual results.
  Show local screenshots and open a fixture-backed browser preview. Record live
  production limitations and offer a release only after local acceptance.
# Принятая сцена: завершение анимации / approved scene: animation completion

## Сайдбар Б / Sidebar B implementation

- [ ] ServicesPage: доступный accordion, counts/filters, capabilities, stale/error,
  существующие подтверждения и логи / accessible accordion and existing contracts.
- [ ] AppShell + inspector styles: единый движущийся фон под прозрачной панелью,
  читаемая типографика, один скроллер / shared sky and translucent workspace.
- [ ] Unit, service dialog, orbital/CSP browser regression, desktop/mobile screenshots.
- [ ] Независимая ревизия и обновление RU/EN статуса / review and bilingual status.

21 октября: владелец выбрал `A-reference-milky-v4`. Завершить перенос в R3F;
структуру сайдбара сначала показать тремя эскизами и обсудить отдельно.

21 October: owner approved `A-reference-milky-v4`. Complete its R3F adaptation;
show three sidebar structure concepts before implementing a new workspace.

- [x] `orbital/orbitMotion.ts`: разнесённые эллипсы, разные spin speeds и
  ограниченное индивидуальное изменение orbital speed, безопасные bounds.
- [x] `GalacticBackdrop.tsx` + отдельный компонент событий: утверждённая узкая
  текстура фона, мягкое движение, редкий метеор/мерцание, без новых зависимостей.
- [x] Сохранить pause, reduced motion, скрытую вкладку, demand rendering и
  graceful fallback при недоступности текстуры/WebGL.
- [x] Проверить тела/кольца в проекции при выборе/hover и возврате камеры,
  несколько размеров экрана и длительные времена; unit + WebGL browser + CSP.
- [x] Подготовить три понятных изображения структуры управления с учётом
  реальных данных/API. Не добавлять вымышленные работающие команды в приложение.


## Approved sidebar B / Выбранный сайдбар B — 21 October

- [x] Translucent shared sky, local Inter, filters and inline service accordion.
- [x] Preserve capabilities, native confirmation and explicit log loading.
- [x] Unit 24/24, build, modal regression, four-width orbital and production CSP suites.
- [x] Independent review, bilingual status and actual desktop screenshot.
