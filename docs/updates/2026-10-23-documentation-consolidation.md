# Уплотнение документации / Documentation consolidation

[Русский](#русский) | [English](#english)

## Русский

23 октября 2026 года по поручению владельца опубликовано уплотнение основных
руководств. Коммит содержания: `44c36a95e7d6d57bd1ac41a18b305f1df423af56`.

Карта документации отделяет текущие возможности от незакрытой приёмки.
Контракт Telegram начинает с действующей клавиатуры и границ доступа;
поиск работы описан как личный раздел для владельца и участников с `jobs`,
с учётом конфигурации и серверной проверки прав. Руководство проверок отделяет
команды от истории запусков. В runtime-контексте уплотнена хроника HH и
исправлено старое утверждение о ручном выборе модели писем.

Четыре исходных документа сохранены в `docs/history/2026-10-23-*` с указанием
актуального источника и пересчитанными относительными ссылками. В старой карте
исправлены три битых пути. Обязательные правила, подтверждения, callbacks,
scopes и исполняемые блоки команд сохранены. Код приложения не менялся.

До публикации проверены 794 файловые ссылки и 91 ссылка на заголовки, без ошибок;
сохранность четырёх архивов, блоков команд и соответствие RU/EN статуса проверены
повторно. Независимая ревизия итогового diff дефектов не нашла. Проверка Git
на ошибки пробелов прошла. Runtime suite для этих MD-only правок не запускался.

После публикации исходники DE и NL обновлены fast-forward до коммита содержания;
оба source guard прошли, рабочие каталоги чистые. Сервер DE healthy,
340 файлов и входные файлы сборки совпадают с принятой версией. Host Agent
совпадает на обоих узлах; службы активны. Desktop 1.0.2: все 146 файлов,
native Electron и bundled wake runtime совпали. Перезапусков и переустановки нет.

Итоговая общая сверка возвращает предупреждения локального Git: Windows остаётся
в рабочей ветке, сохранены другие refs и отдельная незавершённая работа Mini App.
Её файлы и worktree не менялись; это не расхождение работающих VPS. Завершающая
запись результата также синхронизируется на оба VPS. Новая живая приёмка
Telegram, HH, голоса и VPN-трафика в этот выпуск не входила.

## English

On October 23, 2026, the owner authorized publication of the consolidated guides.
Content commit: `44c36a95e7d6d57bd1ac41a18b305f1df423af56`.

The documentation map separates current capabilities from pending acceptance.
The Telegram contract starts with the current keyboard and access boundaries;
Jobs is documented as a personal section for the owner and members with `jobs`,
subject to configuration and server authorization. The verification guide
separates commands from past runs. The runtime guide consolidates HH chronology
and corrects an obsolete claim about manual letter-model selection.

Four original documents remain in `docs/history/2026-10-23-*`, with current-source
notices and adjusted relative links. Three broken paths in the older map were
fixed. Mandatory rules, confirmations, callbacks, scopes and executable command
blocks are retained. Application code is unchanged.

Before publication, 794 file links and 91 heading links passed without errors.
The four archives, command blocks and RU/EN status were checked again.
Independent review found no defects in the final diff; Git whitespace checks
passed. Runtime suites were not rerun for these Markdown-only changes.

After publication, DE and NL sources were fast-forwarded to the content commit;
both source guards passed and their working trees were clean. The DE server is
healthy; its 340 files and build inputs match the accepted code. Host Agent
matches on both nodes and services are active. Desktop 1.0.2 matches all 146
files, native Electron and the bundled wake runtime. Nothing was restarted
or reinstalled.

The overall comparison still warns about local Git state: Windows stays on the
task branch, other refs and separate unfinished Mini App work are retained.
Those files and that worktree were untouched; these warnings do not indicate
VPS runtime drift. This closing record is also synchronized to both VPS nodes.
New live Telegram, HH, voice and VPN traffic acceptance was outside this release.
