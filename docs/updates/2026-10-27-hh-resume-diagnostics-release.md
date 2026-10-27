# Диагностика чтения резюме HH / HH resume read diagnostics

## Русский

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
