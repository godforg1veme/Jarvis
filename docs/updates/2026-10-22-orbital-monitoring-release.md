# Выпуск орбитального мониторинга / Orbital monitoring release

[Русский](#русский) | [English](#english)

## Русский

22 октября владелец поручил публикацию выбранного оформления Operations UI
и проверку на реальных данных. Выпуск готовится; результат установки будет
записан после проверки работающего server. Desktop и Host Agent не меняются.

Состав: орбитальная сцена, общий движущийся фон, прозрачная панель, девять
существующих разделов и мобильная компоновка. Основные метрики видны сразу,
остальные раскрываются. API, вход и серверные права остаются прежними.

Локальные проверки: 42 unit, TypeScript/build, native dialogs, bootstrap,
девять разделов на 1440/662/390/320 px, WebGL fallback и production CSP.
Предрелизная ревизия обнаружила повтор переназначения после потерянного ответа.
Он заблокирован сохранённым намерением в текущей сессии браузера; недоступность
хранилища запрещает отправку. Неопределённый результат требует отдельной проверки.
Автоматические повторные POST не добавлялись.

Подробности разработки и принятые решения:
[локальный этап](2026-10-21-orbital-monitoring-development.md).

## English

On October 22 the owner authorized publishing the selected Operations UI and
checking real data. The release is being prepared; installation results will be
recorded after verifying the running server. Desktop and Host Agent are unchanged.

Scope: orbital scene, a shared moving sky, translucent workspace, nine existing
sections and mobile layout. Primary metrics are visible immediately; additional
metrics use disclosure. APIs, authentication and server permissions stay intact.

Local checks: 42 unit tests, TypeScript/build, native dialogs, bootstrap, nine
sections at 1440/662/390/320 px, WebGL fallback and production CSP. Pre-release
review found a reassignment retry after a lost response. A persisted intent now
blocks it within the current browser session; unavailable storage prevents sending.
An unconfirmed result requires separate verification. No automatic POST retries
were added.

Development details and accepted decisions:
[local work](2026-10-21-orbital-monitoring-development.md).
