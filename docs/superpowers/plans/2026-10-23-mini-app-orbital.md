# Orbital Mini App implementation / Орбитальный Mini App

**Goal:** Реализовать выбранный владельцем первый орбитальный вариант с внешним видом планет и движением дашборда после исправления UX.

**Design:** Тёмное графитовое ядро и шесть планет с серебристой сеткой, тонкие орбиты, локальный монохромный Млечный Путь. На телефоне раздел открывается снизу, на широком экране справа. Поиск, список и док дают устойчивую навигацию. Существующие разрешения и подтверждения сохраняются.

**Architecture:** Vanilla Three.js в `core.js`, геометрия и материалы в `orbitalBodies.js`, траектории в `orbitMotion.js`. `app.js` связывает планеты с прежними маршрутами и управляет панелью и паузой. `orbital.css` применяется только к главной Mini App; страница входа HH сохраняет свою тему. Сборка и сервер публикуют явный список ресурсов.

**Stack:** Существующие JavaScript modules, Three.js 0.186.1, HTML/CSS, CommonJS/Fastify, Playwright/Edge. Новых production-зависимостей нет.

## Ограничения

- Вход остаётся серверным: числовой Telegram ID, подпись, срок и актуальные права. Ни визуальная планета, ни имя не назначают право.
- Планеты создаются только для доступных личных разделов; их тип не зависит от количества прав пользователя.
- Сохранить маршруты, черновик, исходные IDs неизвестных операций и подтверждения в исходном клиенте. Telegram bot menu/API не меняются.
- Сохранить общий pause, reduced motion, остановку скрытой сцены, WebGL fallback и освобождение ресурсов. Обращение по орбите отдельно от spin.
- Не публиковать и не развёртывать без поручения. Не включать личные AI Office материалы в Git.

## Задачи

- [x] Продолжить проверенную UX-ветку в отдельном worktree; проверить свежую main и открытые PR.
- [x] Перенести материалы, свет и типы планет дашборда в модули Three.js; адаптировать орбиты под портретный экран.
- [x] Сделать мобильную панель, поиск, список и док; связать с маршрутизацией и доступными правами.
- [x] Добавить локальную текстуру неба, credits, build inputs и явные серверные assets; учесть отдельный Docker mini-build.
- [x] Добавить браузерную проверку WebGL, orbit positions, пауз, панели, поиска, permission scope, fallback и responsive layout.
- [x] Завершить итоговые проверки, осмотр скриншотов и независимую ревизию; записать результаты на двух языках.

## English

Implement the owner's selected orbital concept using the dashboard's dark bodies,
materials, lighting and trajectories. Keep the existing vanilla Three.js stack,
add a mobile sheet and desktop workspace, and retain search/list/dock navigation
when motion or WebGL is unavailable. Preserve authentication, current rights,
drafts, unknown-operation IDs and confirmation boundaries. Verify production
assets and CSP, orbit movement, pause/reduced motion, fallback, responsive layout
and existing client/HH scenarios. Deployment requires separate authorization.
