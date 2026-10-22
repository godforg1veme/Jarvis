# Управление резюме HH: выпуск / HH resume management release

[Русский](#русский) | [English](#english)

## Русский

22 октября по поручению владельца опубликованы постоянный выбор основного
резюме в личном профиле Mini App, обновление списка из HH каждые 15 минут
и вручную, отдельное включение бесплатного автоподнятия. Пользователь выбирает
собственное резюме и подтверждает изменения; его ID сохраняется для новых
откликов. Старые подготовленные подтверждения с другим резюме становятся
неактуальными. Недоступное основное не заменяется произвольным первым.

Автоподнятие по умолчанию выключено, работает только с выбранным основным,
не чаще раза в четыре часа и при доступной бесплатной кнопке HH. Платные
услуги, изменение текста, публикация и смена видимости не выполняются.
Неизвестный результат выключает автоматику; проверяется сохранённый результат
исходной попытки без нового POST. Без квитанции блокировка сохраняется.
Детали протокола и ограничения: [запись разработки](2026-10-22-hh-resume-management-development.md).

Код функции: `6ff9e5dd8305565bc90e9bfc8c66e15b63607b60`.
Окончательный серверный код: `f03aee38df094283c6ea5261e20092ade411066b`.
Публичная проверка обнаружила пропущенные JS/CSS в серверном allowlist;
исправление включено в этот выпуск вместе с HTTP-регрессионной проверкой.
После замены проверены 200, точное содержимое обоих файлов и `no-store`.

На DE применена migration 041. Server и collector работают из
`/home/deploy/releases/jarvis-f03aee3-hh-resumes`; browser — из
`/home/deploy/releases/jarvis-6ff9e5d-hh-resumes` и совпадает с принятым кодом.
Образы:

- Server: `sha256:9ce00f5f6491b566df50e3c50d58b9bca14be14bc8565da1e000162c93bc0ebd`.
- Browser: `sha256:15e1a0d3a467badac1c97d45fdb9aaf7ddb166330c1feebc69ef2f6f3aedbdb9`.
- Collector: `sha256:62af7759465fa9813ec88f94839d340148d9fa481aec9f6ace7b1e93356e593b`.

Заменены только эти три контейнера; server/browser healthy, все три работают
без перезапусков. Сверены файлы server/shared в работающих server и collector.
Сохранены профили HH, тома, остальные переменные окружения, inode смонтированного
секрета и все пользовательские настройки поиска. Новый отдельный credential
получают только server/browser. Сборщику он не передаётся. Проверка БД после
установки подтвердила 041, ноль включённых автоподнятий и ноль попыток поднятия.

Linux: server 786/786, browser 89/89, PostgreSQL acceptance 19/19.
Edge: панель проверена на ширине 1280/390, прежний Mini App fixture —
320/390/1280. HTTPS live/ready, Mini App, страница подключения и новые файлы
возвращают 200; анонимные me/resumes — ожидаемый 401. Настоящий выбор резюме
и первое поднятие после личного включения остаются клиентской приёмкой.
Независимая ревизия специалиста недоступна из-за лимита назначенной модели.

NL получает исходники; HH-сервисы там не запускаются. Desktop не менялся
и не требует новой сборки. Общая инвентаризация и сохранение незавершённой
Operations UI работы проверяются отдельно при завершении выпуска.
Остаётся известное ограничение: access lock удерживается на время одного
browser RPC до 90 секунд, что может задержать операции с тем же lock.
Приватные результаты: `/home/deploy/maintenance/hh-resume-release-20261022`.

## English

On October 22, with owner authorization, the release added a persistent primary
resume selector to the personal Mini App profile, HH catalog refresh every
15 minutes and on request, and a separate free auto-raise opt-in. Users select
their own resume and confirm the change; its ID is saved for new applications.
Older prepared approvals using another resume become stale. A missing primary
is never replaced with an arbitrary first resume.

Automatic raising is off by default, targets only the selected primary, runs
at most once every four hours, and requires HH's available free button. It
does not purchase services, edit content, publish resumes or change visibility.
Unknown outcomes disable automation; checking reads the original saved receipt
without another POST. Without a receipt, the block remains. Protocol details
and limits: [development record](2026-10-22-hh-resume-management-development.md).

Feature code: `6ff9e5dd8305565bc90e9bfc8c66e15b63607b60`.
Final server code: `f03aee38df094283c6ea5261e20092ade411066b`.
Public verification found omitted JS/CSS entries in the production asset
allowlist. This release includes the correction and an HTTP regression test.
After replacement, both assets returned 200 with exact contents and `no-store`.

DE applied migration 041. Server and collector run from
`/home/deploy/releases/jarvis-f03aee3-hh-resumes`; browser runs from
`/home/deploy/releases/jarvis-6ff9e5d-hh-resumes` and matches the accepted code.
Images:

- Server: `sha256:9ce00f5f6491b566df50e3c50d58b9bca14be14bc8565da1e000162c93bc0ebd`.
- Browser: `sha256:15e1a0d3a467badac1c97d45fdb9aaf7ddb166330c1feebc69ef2f6f3aedbdb9`.
- Collector: `sha256:62af7759465fa9813ec88f94839d340148d9fa481aec9f6ace7b1e93356e593b`.

Only those three containers were replaced. Server/browser are healthy; all
three run with zero restarts. Running server/shared files were compared in
server and collector. HH profiles, volumes, other environment values, mounted
secret inode and every user's search settings were preserved. The separate
new credential is held only by server/browser, not the collector. Post-install
database checks confirmed 041, zero enabled auto-raise settings and zero raises.

Linux: server 786/786, browser 89/89, PostgreSQL acceptance 19/19.
Edge: new panel at 1280/390 and existing Mini App fixture at 320/390/1280.
Public HTTPS live/ready, Mini App, connection page and new assets return 200;
anonymous me/resumes return the expected 401. Real primary selection and the
first raise after personal opt-in remain client acceptance checks. Independent
specialist review was unavailable due to the assigned model's usage limit.

NL receives source synchronization without starting HH services. Desktop is
unchanged and needs no rebuild. Final inventory and preservation of unfinished
Operations UI work are checked separately at release completion. One known
limit remains: the access lock is held during a browser RPC for up to 90 seconds,
which can delay operations using that lock. Private evidence:
`/home/deploy/maintenance/hh-resume-release-20261022`.
