# Резюме HH: выбор, обновление и поднятие / HH resume management

[Русский](#русский) | [English](#english)

## Русский

Локальная разработка по запросу владельца: после подключения HH Mini App
постоянно показывает список собственных резюме и основное резюме для откликов.
Раньше выбор появлялся только при первом подключении. Произвольное первое
резюме не подставляется; недоступное основное требует нового явного выбора.
Смена основного увеличивает revision подключения и отменяет старые
подтверждения откликов. Сохранение привязано к Mini App actor, origin, CSRF,
текущему праву jobs и revision, а не переданному клиентом user ID.

Обновление списка: при первом открытии, кнопкой и в фоне раз в 15 минут.
Сохраняются только ID, заголовок и доступность бесплатной кнопки, без тела
резюме, контактов и cookies. Текущий текст резюме остаётся в HH и используется
самим HH при отклике. При сбое показан прежний список со статусом ошибки.
Открытая панель перечитывает состояние раз в минуту и останавливается при
закрытии раздела; в скрытой вкладке перечитывание не запускается.

Автоподнятие включается отдельным подтверждением только для основного резюме.
По умолчанию оно выключено. Платные услуги, публикация нового резюме,
изменение видимости, текста и поднятие всех резюме с главной страницы запрещены.
Минимальный интервал — 4 часа; доступность проверяется по кнопке HH.
[Официальное описание HH](https://feedback.hh.ru/knowledge-base/article/0012145).
Обработчик ограничен native POST `/applicant/resumes/touch` с выбранным hash,
`undirectable=true`, двумя необязательными fingerprint-полями и совпадающим
CSRF. Этот контракт найден чтением текущего публичного JavaScript HH;
настоящая отправка запроса в HH не выполнялась.

Запись требует отдельного `JARVIS_JOB_BROWSER_RESUME_TOKEN`, который получают
только server и browser. Read/connect/apply credentials не дают это действие;
новый credential не выдаётся сборщику. DB хранит исходный request ID и
согласованный профиль. Браузер сохраняет закрытое намерение перед кликом
в приватном per-user ledger, запрещает повтор и перенаправления. Подтверждение
поднятия требует 200 JSON и проверки server-rendered cooldown после reload.
При неизвестном результате автоматика выключается. Проверка исходной попытки
читает только её сохранённую квитанцию; повторный POST не разрешается. Если
квитанции нет, требуется ручная проверка HH. После сверки автоматика сама
не включается — это снова выбор пользователя.

Migration 041 добавляет cache/settings и отдельные scoped операции.
Модель и production-зависимости не добавлены. На рабочих VPS изменение пока
не установлено, фильтры Сени и данные других аккаунтов не менялись.

Проверено локально: server 785/785; browser 79 passed, 10 Linux-only skipped;
19 PostgreSQL acceptance, включая 3 новых сценария с настоящими HTTP-роутами,
CSRF, чужим actor, CAS, неизвестным результатом, интервалом и отзывом jobs.
Браузерный fixture проверяет native multipart, отдельное полномочие, один клик,
cooldown и запрет 307. Edge: новая панель 1280/390 и прежний Mini App fixture
320/390/1280 прошли. Файлы снимков — в игнорируемом `.superpowers/job-resumes/`.
Linux-проверка durable ledger ещё выполняется. Отдельная ревизия специалистом
не выполнена: назначенные исполнители остановились из-за лимита их модели.

Для выпуска потребуется согласовать публикацию этой новой функции, применить
041, задать новый закрытый credential и пересобрать server и browser. Collector
использует общий server image; его файлы тоже нужно синхронизировать. EXE не менялся.
Реальный выбор резюме и первое бесплатное поднятие после личного включения
пользователем остаются клиентской приёмкой.

## English

Local development requested by the owner: after HH connection, Mini App keeps
the user's resume list and primary application resume visible. Previously the
selector appeared only during initial connection. No arbitrary first resume
is substituted; a missing primary requires a new explicit choice. Changing
the primary increments connection revision and invalidates old application
approvals. Saving is bound to the Mini App actor, origin, CSRF, current jobs
permission and revision, rather than a client-supplied user ID.

The catalog refreshes on first opening, on request, and every 15 minutes in
the background. Only IDs, titles and availability of the free button are
cached, without resume bodies, contacts or cookies. Resume text remains in HH
and HH uses its current version for applications. A failed refresh preserves
the last list with an error status. An open panel rereads state every minute;
it stops on disposal and does not poll while the tab is hidden.

Automatic raising requires a separate confirmation for the primary resume
and is off by default. Paid services, publishing a new resume, changing its
visibility or text, and the home-page action that raises all resumes are
excluded. The minimum interval is four hours, subject to HH button readiness.
[Official HH guidance](https://feedback.hh.ru/knowledge-base/article/0012145).
The handler allows only the native `/applicant/resumes/touch` POST with the
selected hash, `undirectable=true`, two optional fingerprint fields and a
matching CSRF token. This contract was identified by reading current public
HH JavaScript; no real HH raise request has been submitted.

Writes require a separate `JARVIS_JOB_BROWSER_RESUME_TOKEN`, held only by
server and browser. Read/connect/apply credentials cannot invoke raising;
the new credential is not passed to the collector. PostgreSQL stores the
original request ID and approved target. Before clicking, browser saves a
closed intent in a private per-user ledger and forbids replay and redirects.
A raised result requires 200 JSON plus a server-rendered cooldown after
reload. Unknown results disable automation. Checking the original operation
reads only its saved receipt; another POST is not authorized. Without a
receipt, HH needs manual inspection. Verification never enables automation
again automatically; that remains the user's choice.

Migration 041 adds catalog/settings storage and scoped operations. No model
or production dependency was added. Production VPS services have not been
updated; Senya's filters and other accounts' data are unchanged.

Local verification: server 785/785; browser 79 passed with 10 Linux-only skips;
19 PostgreSQL acceptance tests including three new scenarios with real HTTP
routes, CSRF, foreign actors, CAS, unknown outcomes, cadence and revoked jobs
access. Browser fixtures cover native multipart, separate capability, one
click, cooldown and rejected 307. Edge passed the new panel at 1280/390 and
the existing Mini App fixture at 320/390/1280. Screenshots are ignored under
`.superpowers/job-resumes/`. Linux durable-ledger verification is still running.
Independent specialist review was unavailable because the assigned agents
hit their model's usage limit.

Release requires approval for this new feature, migration 041, a new private
credential, and rebuilt server/browser components. Collector shares the
server image and its files also need synchronization. Desktop EXE is unchanged.
Real primary selection and the first free raise after personal user opt-in
remain client acceptance checks.
