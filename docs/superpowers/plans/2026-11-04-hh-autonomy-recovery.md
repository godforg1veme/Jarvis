# HH autonomy recovery implementation plan

**Goal:** реализовать согласованный общий ремонт состояний, подтверждения и восстановления HH.
**Spec:** `docs/superpowers/specs/2026-11-04-hh-autonomy-recovery-design.md`.
**Architecture:** ограниченный GET-читатель доказательства; существующий ledger
с запретом повторов; отдельный scheduler читающей сверки; ограниченная repair
генерация письма; закрытые причины и миграция метаданных восстановления.
**Stack:** Node CommonJS/Fastify, PostgreSQL, Playwright; без новых зависимостей.

- [x] Аудит main/веток/worktrees/PR; сохранение посторонней работы.
- [x] Установить читающий источник точного письма в живом HH без POST/WS.
- [x] Реализовать bounded GET proof и отрицательные проверки привязок.
- [x] Разделить отказ подготовки до claim и неизвестный исход после claim.
- [x] Добавить ограниченную читающую сверку исходных unknown операций,
  forward-only migration, scope/revocation и отсутствие повторного submit.
- [x] Согласовать схему письма и одну дополнительную генерацию с durable
  checkpoint/usage; неизвестные модельные вызовы не повторять.
- [x] Исправить причины worker/уведомления и обновить контракт Telegram.
- [x] Выполнить unit, Linux Chromium и отдельные PG acceptance; проверить
  исполнение/права/дубли и отчитаться о пределах живой проверки.
- [x] Независимая ревизия полного diff и повторная ревизия исправлений;
  устранены разрывы статусов application/item и остановка обхода на denied scope.
  PostgreSQL: 8 recovery + 13 applications/model + 12 automation tests прошли.
- [x] Обновить русские/английские статус и результат локальной разработки;
  подготовить предложение выпуска server/browser/migration 058.
