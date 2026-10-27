# Диагностика чтения резюме HH / HH resume read diagnostics

## Русский

Обновление 28 октября: reader исправлен и установлен на DE, образ
`jarvis-hh-browser:ee29c85`. Все 108 Linux-тестов прошли без пропусков.
Штатный серверный запрос подтвердил чтение выбранного резюме: название,
опыт и навыки получены без вывода содержимого. Reader проверяет точный адрес,
единственность источника HH, объём и формат данных; временная подробная
диагностика удалена. Проверка самого создания письма в Telegram ещё открыта.
Защита связи писем с резюме установлена на DE в образе
`jarvis-hh-context:997b3cd`, migration 053 применена. Локально прошли 885
серверных тестов, 47 профильных проверок PostgreSQL и 78 Telegram-проверок;
сквозной тест через обработчики Telegram и PostgreSQL также прошёл. В Linux
прошли 883 серверных теста, два с отдельной БД проверены локально. Настройки,
тома и исходный файл подключаемого секрета сохранены; readiness вернул 200.
Реальные отклики работодателям не отправлялись.

27 октября 2026 года по поручению владельца на DE установлена диагностика
чтения резюме для сопроводительных писем. Проверка выбранного профиля показала:
резюме присутствует в списке HH, но существующий reader не распознаёт его
разделы и возвращает ошибку до генерации письма. Найденный заголовок образования
использует `h4`; reader ожидал `h2` или `h3`. Исправление чтения ещё не выпущено.

Диагностика выводит только закрытые коды и ограниченные признаки структуры,
без текста резюме, идентификаторов и значений полей. Серверное сообщение и
проверки содержимого остаются прежними. Browser image `jarvis-hh-browser:4a75dd9`
установлен на DE из проверенного release `4a75dd9f9029fc9e5211c7faaff7c2391d24e07d`;
профиль HH и настройки сохранены. Проверены 108 тестов Linux без пропусков.
Исходники Windows, DE и NL синхронизированы с GitHub `main`; Desktop не менялся.
Продолжение диагностики и живая проверка создания письма остаются открытыми.

## English

October 28 update: the reader fix is deployed on DE as
`jarvis-hh-browser:ee29c85`. All 108 Linux tests passed without skips.
A normal server request successfully read the selected resume's title,
experience and skills without printing their contents. The reader checks the
exact URL, unique HH source, size and data shape; detailed temporary diagnostics
were removed. Live letter creation in Telegram remains open. Draft provenance
guards are deployed on DE as `jarvis-hh-context:997b3cd`; migration 053 is applied.
Validation passed 885 local server tests, 47 focused PostgreSQL tests and
78 Telegram tests, plus the handler/PostgreSQL E2E. Linux passed 883 server
tests; two database-dependent tests passed locally. Environment, volumes and
the original mounted secret file were retained; readiness returned 200.
No real applications were sent to employers.

On October 27, 2026, the owner authorized deployment of diagnostics for HH resume
reading during cover-letter preparation. A check of the selected profile showed
that the resume is present in HH's list, but the reader fails to recognize its
sections and returns an error before letter generation. The observed education
heading uses `h4`; the reader expected `h2` or `h3`. A reading fix is not yet deployed.

Diagnostics emit closed codes and bounded structural signals only, without resume
text, identifiers, or field values. The server's public error and content checks
are unchanged. Browser image `jarvis-hh-browser:4a75dd9` runs on DE from verified
release `4a75dd9f9029fc9e5211c7faaff7c2391d24e07d`; the HH profile and settings
were retained. All 108 Linux tests passed. Windows, DE, and NL source checkouts
are synchronized with GitHub `main`; Desktop was unchanged. Further diagnosis and
a live cover-letter check remain open.
