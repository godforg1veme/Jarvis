# Mini App: кнопки и память / Buttons and memory

[Русский](#русский) | [English](#english)

## Русский

27 октября пользователь поручил завершить выпускные проверки и установить
готовую ветку Mini App на VPS. Подготовлены этапы 1–4 и операции памяти этапа 5:
надёжные квитанции диалога, отмена HH, актуальные списки доступа, безопасные
переходы в бот и Operations, постраничные личные списки, старая история диалога,
добавление/исправление/удаление памяти с подтверждением.

Общая независимая ревизия нашла два дефекта, исправленных до публикации.
Вход HH теперь требует успешного сохранения и чтения исходного UUID до POST;
при недоступном хранилище запрос не отправляется. Завершение ответа ассистента
проверяет действующие права и сессию внутри общей транзакции доступа, до записи
ответа и квитанции. Отзыв права в точке гонки не раскрывает ответ и не вызывает
модель повторно при сверке исходного запроса.

Обе ранее падавшие дополнительные проверки исправлены. Дизайн-превью больше
не показывает контролы удалённого API паузы/скорости; тест проверяет автодвижение,
остановку скрытой сцены и отсутствие JS-ошибок. HH full-runtime fixture создаёт
настоящие роли до запуска runtime, передаёт AccessService репозиториям, включает
поиск через общий сервис и проверяет фактическую доставку искусственной вакансии.

Итоговые локальные проверки: **877/877** server tests без пропусков,
**24/24** PostgreSQL acceptance, полный pipeline **53 миграций**, build Mini App
и **девять** браузерных наборов, включая дизайн-превью. Повторная независимая
ревизия исправлений не нашла блокирующих дефектов. Для выпуска нужны миграции
049–051. Эвристический фильтр памяти распознаёт известные секретные форматы,
но не обещает распознавание произвольного неизвестного секрета.

Статус установки: ожидает публикации и проверки DE/NL. Обновляется server/Mini App
на DE и исходники на обоих VPS; отдельного server runtime на NL нет.
Активный worktree `codex/hh-resume-diagnostics` сохранён отдельно; его изменения
в этот выпуск не входят. Desktop-компоненты данной веткой не меняются.

Живой Telegram WebView, клавиатура телефона и owner/member приёмка ещё не
подтверждены. Остальные пользовательские операции этапа 5 и ручная сверка HH
unknown остаются в плане; этап 6 не закрыт. Новые внешние подключения, отправки
сообщений и действия с реальными подписками при выпускной проверке не выполняются.

## English

On October 27, the user authorized completing release checks and installing the
ready Mini App branch on VPS nodes. Stages 1–4 and stage-5 memory actions are
prepared: durable chat receipts, HH cancellation, current access lists, safe
bot/Operations handoffs, paginated personal lists, older chat history, and
confirmed memory creation, correction and deletion.

Independent review of the complete branch found two defects, fixed before
publication. HH sign-in now requires successfully persisting and reading back
the original UUID before POST; unavailable storage prevents sending. Assistant
completion checks live permissions and session inside the shared access
transaction before storing the answer and receipt. Revocation at the race point
does not disclose the answer or call the model again during reconciliation.

Both previously failing additional checks were repaired. The design preview no
longer exposes controls for the removed pause/speed API; its test checks automatic
motion, hidden-scene suspension and absence of JavaScript errors. The HH
full-runtime fixture creates actual access memberships before runtime, passes
AccessService to repositories, enables search through the shared service and
checks actual delivery of a synthetic vacancy.

Final local validation: **877/877** server tests without skips, **24/24** PostgreSQL
acceptance scenarios, the complete **53-migration** pipeline, Mini App build and
**nine** browser suites including the design preview. Follow-up independent
review found no blocking defects. Migrations 049–051 are required. The heuristic
memory filter recognizes known secret formats; it cannot promise detection of
arbitrary unknown secrets.

Installation status: awaiting publication and DE/NL verification. DE server/Mini
App and source checkouts on both VPS nodes are in scope; NL has no server runtime.
The active `codex/hh-resume-diagnostics` worktree is preserved separately and its
changes are excluded. This branch changes no Desktop components.

Actual Telegram WebView, phone keyboard and owner/member acceptance remain
unverified. Other stage-5 user actions and manual HH unknown reconciliation remain
in the plan; stage 6 is open. Release checks do not connect new external accounts,
send messages or change real subscriptions.
