# Обновление действующей документации / Current documentation refresh

[Русский](#русский) | [English](#english)

## Русский

1 ноября 2026. По поручению владельца обновлена документация после аудита
Markdown проекта. Исполняемый код и настройки пользователей не менялись.

Корневой README, руководство подключения HH, deploy guide, runtime context и
контракт Telegram теперь различают ручное подтверждение письма и личное
разрешение будущих автооткликов. Зафиксированы отдельная GLM 5.3 Flash для HH,
существующий OpenRouter key и одно уведомление при $2 за месяц по МСК без
остановки поиска. Основной чат сохраняет собственную политику маршрутизации.

Карта документации обновлена на 1 ноября. Она отделяет общий код и тесты
изоляции от живой проверки владельца, незакрытых проверок участников и первого
реального автоотклика. Сохранены ограничения полного чтения резюме и старого
исторического диапазона. В руководстве подключения описаны истёкший вход при
устаревшем `connected` и отдельный отказ `JOB_COLLECTION_WINDOW_EXPIRED`.

AGENTS уточняет уже действующий scope HH-согласия; CLAUDE и Gemini ссылаются
на текущую политику провайдеров. Старые очереди моделей, порог $3 и промежуточное
состояние VPN timers явно отмечены историческими. Это уточнение документации
не включает таймеры, автоматику или новые права. Личные AI Office файлы не
публикуются; проектная и локальная копии release skill не требовали изменения.

Проверка включает локальные Markdown-ссылки, якоря и регистр путей, сопоставление
русского и английского описания, независимую ревизию и `git diff --check`. Все 352
MD-файла прошли проверку локальных ссылок и якорей. Ревизия уточнила требование
полного резюме только для автоматики и ограниченный результат тика сбора. Runtime-тесты повторно не
запускались: менялись только руководства, а model instructions не затронуты.
Публикация включает синхронизацию исходников обоих VPS и итоговый release-status;
пересборка контейнеров и установка Desktop для этого изменения не требуются.

Живые проверки остальных пользователей, тестов/анкет, уведомления при фактическом
расходе $2 и первого автоматического отклика остаются открытыми. Документация
не заменяет эти проверки. [Текущая карта](../README.md) и
[результат восстановления HH](2026-11-01-hh-session-and-complete-resume-repair.md).

## English

November 1, 2026. The owner authorized a documentation update after the project
Markdown audit. Executable code and user settings were not changed.

The root README, HH connection guide, deployment guide, runtime context and
Telegram contract now distinguish manual exact-letter approval from personal
authorization of future autonomous applications. HH uses separate GLM 5.3 Flash
with the existing OpenRouter key and one $2 notice per Moscow calendar month
without stopping search. Main chat retains its own routing policy.

The documentation map is updated to November 1. It separates shared code and
isolation tests from the owner's live acceptance, outstanding member checks and
the first real autonomous application. Complete-resume limits and the old history
range remain documented. The connection guide describes expired login with stale
connected state and the separate `JOB_COLLECTION_WINDOW_EXPIRED` failure.

AGENTS clarifies existing HH consent scope; CLAUDE and Gemini link to current
provider policy. Older model queues, the $3 threshold and the intermediate VPN
timer state are explicitly historical. This documentation clarification enables
no timers, automation or new access. Personal AI Office files are not published;
the project and local release-skill copies required no changes.

Verification covers local Markdown links, anchors and path casing, Russian/English
consistency, independent review and `git diff --check`. All 352 Markdown files
passed local-link and anchor checks. Review clarified that strict completeness
is required for automation and that a bounded tick does not finish the whole queue.
Runtime tests were not rerun: only guides
changed, with model instructions untouched. Publication includes both VPS source
checkouts and final release-status verification. Container rebuilds and Desktop
installation are unnecessary for this change.

Live checks for other users, tests/forms, a notice at actual $2 spend and the first
autonomous application remain open. Documentation does not substitute for those
checks. See the [current map](../README.md) and
[HH recovery result](2026-11-01-hh-session-and-complete-resume-repair.md).
