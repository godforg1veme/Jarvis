# Jarvis Mini App — design preview

[Русский](#русский) | [English](#english)

## Русский

Локальный образец дизайна, 18 октября 2026. Это ещё не установленный Telegram
Mini App: вход Telegram, серверные роли, API и реальные пользовательские разделы
не подключены. Образец не выдаёт реальных прав и не читает личные данные.
Все Telegram ID вымышленные. Изменения существуют только в памяти вкладки
и пропадают при обновлении страницы. Email не используется.

Главная содержит процедурное 3D-ядро Three.js: отдельные металлические кольца,
световые вставки, сфера, оболочка и частицы. Есть вращение по разным осям,
поворот перетаскиванием с плавным догоняющим движением, пауза, скорость и сброс.
Сцена останавливается вне viewport и при скрытии вкладки. Reduced motion
по умолчанию оставляет неподвижную сцену; отсутствие WebGL даёт статичный вид.
Внешних API, CDN, моделей и генерации на каждом кадре нет.

В управлении можно добавить вымышленный Telegram ID, создать роль,
выбрать роль пользователя, задать персональные allow/deny/inherit и увидеть
итоговые права. Владелец защищён от изменения в этом образце.
Это демонстрация интерфейса, а не реализация серверной безопасности.

Запуск из `mini-app/`:

```powershell
npm ci
npm run dev
```

Адрес: http://127.0.0.1:5187/. Preview server слушает только loopback,
отдаёт закрытый список файлов и запрещает сетевые соединения страницы через CSP.
Не используйте его как production сервер и не публикуйте через туннель.

Проверка при работающем preview server, из корня репозитория:

```powershell
node scripts/testMiniAppPreview.cjs
```

Использует имеющиеся Playwright в `job-browser/node_modules` и Edge.
Проверяет WebGL frames, pause/offscreen, reduced motion, fallback, allow/deny,
создание ролей, уникальность Telegram ID, безопасное отображение имени,
320/390/844 px, отсутствие сохранения и browser/CSP errors. Артефакты остаются
в игнорируемой `.superpowers/mini-app-preview/`. Тест использует software WebGL;
производительность на настоящем телефоне ещё не проверена.

Спецификация: [Telegram Mini App](../docs/superpowers/specs/2026-10-18-telegram-mini-app-design.md).
Следующий этап после проверки спецификации владельцем: подробный план,
серверная модель прав, проверенный Telegram вход и подключение настоящей админки.
Публикация и настройка запуска в Telegram требуют отдельного поручения.
Образец исключён из упаковки Windows Desktop.

## English

Local design preview, October 18, 2026. This is not a deployed Telegram Mini
App: Telegram authentication, server roles, APIs and actual user sections are
not connected. The preview grants no real permissions and reads no personal
data. All Telegram IDs are fictional. Edits live only in tab memory and are
discarded on reload. Email is not used.

The home screen contains a procedural Three.js core: independent metallic rings,
light inlays, a sphere, a shell and particles. It includes multi-axis rotation,
drag rotation with smooth trailing movement, pause, speed and reset controls.
Rendering stops offscreen and when the tab is hidden. Reduced motion defaults
to a stationary scene; unavailable WebGL produces a static fallback. No external
APIs, CDNs, models or per-frame generation are used.

Administration allows adding a fictional Telegram ID, creating roles, assigning
a user's role, selecting personal allow/deny/inherit overrides and inspecting
effective access. The owner cannot be changed in this preview. This demonstrates
the interface, not server-side security.

Run from `mini-app/`:

```powershell
npm ci
npm run dev
```

URL: http://127.0.0.1:5187/. The preview server binds only to loopback,
serves an explicit file allowlist and prevents page network connections through
CSP. Do not use it as a production server or expose it through a tunnel.

With the preview running, verify from the repository root:

```powershell
node scripts/testMiniAppPreview.cjs
```

Uses existing Playwright in `job-browser/node_modules` and Edge. Covers WebGL
frames, pause/offscreen, reduced motion, fallback, allow/deny, role creation,
Telegram ID uniqueness, safe display names, 320/390/844 px, ephemeral edits,
and absence of browser/CSP errors. Artifacts remain under ignored
`.superpowers/mini-app-preview/`. The test uses software WebGL; performance
on a physical phone has not been verified.

Specification: [Telegram Mini App](../docs/superpowers/specs/2026-10-18-telegram-mini-app-design.md).
After the owner's specification review, the next stage is a detailed plan,
server access control, verified Telegram authentication and actual administration.
Publication and Telegram launch configuration require a separate instruction.
The preview is excluded from Windows Desktop packaging.
