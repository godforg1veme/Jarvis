# Mini App UX repair / Исправление UX Mini App

**Goal:** Исправить подтверждённые ошибки переходов и обратной связи перед орбитальным редизайном.

**Architecture:** Открытие разделов проходит через один обработчик hash-маршрута. Каждое чтение связано с текущей версией навигации; поздний ответ не обновляет другой экран. API, права и подтверждения изменений сохраняются.

**Stack:** JavaScript modules, существующие HTML/CSS Mini App, Node.js и Playwright/Edge для проверок.

**Основание:** аудит текущего Mini App и поручение владельца от 23 октября сначала исправить UX. Новый орбитальный UI не входит в этот этап.

## Шаги

- [x] Проверить ветки, PR, worktrees и свежую origin/main; сохранить параллельную работу над документацией в основном checkout.
- [x] Добавить браузерную регрессию в scripts/testMiniAppClient.cjs; подтвердить падение перехода #section/memory на исходном коде.
- [x] В mini-app/src/app.js ввести маршруты #section/<permission>, единый запуск загрузки, защиту от поздних ответов, освобождение HH-панели при уходе, пустые состояния и явный повтор чтения.
- [x] В mini-app/index.html сделать заголовки доступными для фокуса после перехода.
- [x] Собрать Mini App и выполнить расширенный testMiniAppClient и testHhLoginTouch; проверить результаты и diff независимо.
- [x] Обновить русскую и английскую запись результата; сохранить работу локально и сообщить границы проверки.

## Ограничения

Не менять Telegram bot menu, callback grammar, серверные API, права и origin-bound подтверждения. Не повторять неизвестные изменения под новым ID. Не публиковать и не развёртывать без отдельного поручения. Сохранить #modules, черновик диалога, receipt неизвестного запроса, reduced motion и WebGL fallback. Новые production зависимости не нужны.

## English

Repair confirmed navigation and feedback issues before the orbital redesign. Use explicit section routes and one navigation loader, discard stale responses, dispose the HH panel on departure, retain chat drafts and unknown-request receipts, and provide empty-state feedback and explicit read retries. Add browser regressions for Home/logo/back/forward/reload, single chat history loading, permissions and delayed responses. Keep APIs, bot menus, authorization and confirmation boundaries unchanged. Work stays local pending release authorization.
