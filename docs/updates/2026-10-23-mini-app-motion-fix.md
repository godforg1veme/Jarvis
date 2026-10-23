# Исправление движения Mini App / Mini App motion repair

[Русский](#русский) | [English](#english)

## Русский

После [выпуска](2026-10-23-mini-app-orbital-release.md) владелец сообщил об
остановленной анимации и неработающей кнопке «Продолжить». Локально исправлены
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
Изменения пока локальные; опубликованный сервер ещё использует прежний код.

Проверены Mini App build, client suite и орбитальный browser suite: обычное
движение, явное возобновление при reduced motion, повторная пауза, смена
системной настройки, touch-возврат, отсутствие настроек, права и WebGL fallback.

## English

After the [release](2026-10-23-mini-app-orbital-release.md), the owner reported
stopped animation and a non-working Resume button. Two causes were repaired
locally: system reduced motion blocked explicit resume, and returning from a
section focused a planet, keeping the scene paused. Touch pointerenter was also
incorrectly treated as mouse hover.

The system preference remains effective by default. Explicit Resume enables
motion until the system preference changes again or the page closes. Pause
stops the scene again. Return navigation focuses the stationary All sections
button and clears stale hover/focus causes. Speed and view-reset settings were
removed; the single pause button remains.

This supersedes the previous stage's rule preventing explicit resume under
reduced motion. Checks must verify advancing orbit time and changing coordinates,
including touch return without forced blur. Changes remain local; the published
server still runs the previous code.

Mini App build, client suite and orbital browser suite passed: normal motion,
explicit resume under reduced motion, pausing again, system preference changes,
touch return, removed settings, permissions and WebGL fallback.
