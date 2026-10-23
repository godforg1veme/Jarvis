# Исправление движения Mini App / Mini App motion repair

[Русский](#русский) | [English](#english)

## Русский

После [выпуска](2026-10-23-mini-app-orbital-release.md) владелец сообщил об
остановленной анимации и неработающей кнопке «Продолжить». Исправлены
две причины: системный reduced motion блокировал явное возобновление, а возврат
из раздела фокусировал планету и оставлял сцену на паузе. Touch pointerenter
также ошибочно считался наведением мыши.

По умолчанию системное ограничение движения сохраняется. Явное нажатие
«Продолжить» разрешает движение до новой смены системной настройки или закрытия
страницы. «Пауза» снова останавливает сцену. При возврате фокус переходит на
неподвижную кнопку «Все разделы», а старые причины hover/focus сбрасываются.
Настройки скорости и сброса вида удалены; оставлена одна кнопка паузы.

Это обновляет правило прежнего этапа, запрещавшее ручное возобновление при
reduced motion. Проверки должны подтверждать фактический рост времени и
изменение координат орбит, включая touch-возврат без принудительного blur.
23 октября исправление выпущено на DE; Windows и оба VPS source синхронизированы с GitHub `main`.

Проверены Mini App build, client suite и орбитальный browser suite: обычное
движение, явное возобновление при reduced motion, повторная пауза, смена
системной настройки, touch-возврат, отсутствие настроек, права и WebGL fallback.


Код выпуска: `93365887e924c4c19ab28ae1d618a1f5adedca60`.
DE: `/home/deploy/releases/jarvis-9336588-mini-motion`, образ
`jarvis-mini-motion:9336588`. Preflight/release guard, 792/792 server tests внутри
нового Linux-образа, health и внешние live/ready smoke прошли. Десять публичных
Mini App assets совпадают с образом; отсутствие настроек подтверждено.
Окружение и секреты сохранены, заменён только server; ID остальных контейнеров
не изменились. Итоговая сверка Windows/GitHub/DE/NL/Desktop/Host Agent без
расхождений. Desktop и Host Agent не требовали установки. Последующая запись
результата меняет только MD. Живая проверка на телефоне остаётся.

## English

After the [release](2026-10-23-mini-app-orbital-release.md), the owner reported
stopped animation and a non-working Resume button. Two causes were repaired: system reduced motion blocked explicit resume, and returning from a
section focused a planet, keeping the scene paused. Touch pointerenter was also
incorrectly treated as mouse hover.

The system preference remains effective by default. Explicit Resume enables
motion until the system preference changes again or the page closes. Pause
stops the scene again. Return navigation focuses the stationary All sections
button and clears stale hover/focus causes. Speed and view-reset settings were
removed; the single pause button remains.

This supersedes the previous stage's rule preventing explicit resume under
reduced motion. Checks must verify advancing orbit time and changing coordinates,
including touch return without forced blur. On October 23, the repair was deployed to DE; Windows and both VPS sources match GitHub `main`.

Mini App build, client suite and orbital browser suite passed: normal motion,
explicit resume under reduced motion, pausing again, system preference changes,
touch return, removed settings, permissions and WebGL fallback.

Release code: `93365887e924c4c19ab28ae1d618a1f5adedca60`.
DE: `/home/deploy/releases/jarvis-9336588-mini-motion`, image
`jarvis-mini-motion:9336588`. Preflight/release guard, all 792 server tests inside
the new Linux image, health and external live/ready smoke passed. Ten public Mini
App assets match the image; removed settings were verified. Environment and
secrets were preserved; only server was replaced and other container IDs stayed
unchanged. Final Windows/GitHub/DE/NL/Desktop/Host Agent comparison found no
differences. Desktop and Host Agent needed no installation. The subsequent result
record changes MD only. Live physical phone acceptance remains.
