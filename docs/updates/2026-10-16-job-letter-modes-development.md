# Четыре варианта сопроводительного / Four cover-letter modes

## Русский

Более новый результат от 16 октября: [функция выпущена на DE](2026-10-16-job-letter-modes-release.md).
Ниже сохранён результат локального этапа до разрешения на публикацию.

16 октября 2026. Подготовлено локально в `codex/job-letter-modes` после согласования
владельцем. GitHub и VPS не обновлялись; установленный Desktop не менялся.

В меню поиска добавлен редактор базового сопроводительного с показом полного
текста и подтверждением сохранения. «Подготовить отклик» предлагает базовое
без AI, улучшенное из базового, кастомное без AI и кастомное с AI. Кастомное
письмо относится к одной вакансии и не заменяет общее базовое.

Факты и примеры необязательны. Оба AI-режима получают исходное письмо, вакансию,
факты и примеры стиля. Отдельное поле `sourceLetter` хранит авторский источник;
правка, перевод и перегенерация сохраняют его. При выборе нового варианта
посторонний прежний черновик не передаётся модели. Ручные варианты не вызывают
модель и работают без её настройки. Перед отправкой в HH во всех случаях
сохраняется отдельное подтверждение точного итогового текста.

Migration 034 добавляет режим и исходный текст черновика и три закрытых вида
guided input. Базовое письмо хранится в профиле отдельно от фактов/примеров.
Его замена увеличивает revision и делает прежние подтверждения отправки
неактуальными. Проверки владельца, чата, conversation, expiry, single consumption,
актуальности вакансии/профиля/резюме и исходного operation ID сохраняются.

Проверено локально:

- Server unit suite: 646/646, без пропусков.
- Telegram regression gate: 65/65.
- Job PostgreSQL acceptance: 17/17 на отдельном временном PostgreSQL 16;
  новые четыре проверки используют настоящие message/menu handlers и
  interaction repository, без stub `begin`.
- Bot/HTTP/PG E2E: 1/1, включая потерю ответа и проверку исходной отправки
  без повторного POST. Внешние ответы модели, Telegram и HH подставные.

Документы: [сценарий](../superpowers/specs/2026-10-16-job-letter-modes-design.md),
[план](../superpowers/plans/2026-10-16-job-letter-modes.md),
[контракт меню](../telegram-menu-contract.md), [проверки](../verification.md).
Для появления кнопок в Telegram нужен отдельный выпуск server с migration 034.
Реальные нажатия владельца и один выбранный HH-отклик ещё не проверены.
Browser и collector не менялись; Desktop пересобирать не требуется.

## English

Later result on 16 October: [deployed on DE](2026-10-16-job-letter-modes-release.md).
The record below preserves the local stage before publishing was authorized.

16 October 2026. Implemented locally on `codex/job-letter-modes` after owner
approval. GitHub and VPS nodes were not updated; installed Desktop is unchanged.

The job menu gains a base-letter editor with full-text save confirmation.
Prepare offers base without AI, AI-improved base, custom without AI and custom
with AI. Custom input belongs to one vacancy and never overwrites the shared base.
Facts/examples are optional. Both AI modes receive the source letter, vacancy,
facts and style samples. The source is retained through explicit AI editing,
translation and regeneration. Selecting a new source excludes an unrelated prior
draft. Manual modes make no model calls and work without model configuration.
Every mode retains the separate exact-text confirmation before HH submission.

Migration 034 adds draft mode/source columns and three closed guided-input kinds.
The base letter is stored separately from facts/examples in the profile; replacing
it increments the profile revision and invalidates pending application consent.
Owner/chat/conversation checks, expiry, single consumption, vacancy/profile/resume
revisions and original-operation reconciliation remain enforced.

Local checks: 646/646 server unit tests; 65/65 Telegram regression tests;
17/17 job PostgreSQL acceptance tests against a dedicated temporary PostgreSQL 16;
and 1/1 bot/HTTP/PG E2E covering a lost acknowledgement and no duplicate POST.
Four new acceptance tests use actual message/menu handlers and the interaction
repository, without a stubbed `begin`. Model, Telegram and HH replies are fixtures.

See the specification, plan, menu contract and verification guide linked above.
A separately authorized server rollout with migration 034 is required before
the controls appear in Telegram. Real owner taps and one owner-selected HH
application remain unverified. Browser and collector code is unchanged;
Desktop needs no rebuild.
