# HH Forbidden and Direction Evidence Implementation Plan

**Goal:** остановить каскад новых попыток после HH-блокировки и ложный AI core.
**Architecture:** существующий scoped/revision backoff worker; чистая серверная
проверка доказательств направления перед draft. Новых провайдеров/схем нет.
**Tech Stack:** CommonJS/Fastify/PostgreSQL, текущие Node/runtime lockfiles.
**Spec:** [design](../specs/2026-11-07-hh-forbidden-direction-design.md).

## Global Constraints

Сохранять owner/conversation/chat/revision/selected-resume; не повторять unknown.
Не отправлять новые отклики во время диагностики. Не менять Telegram-тексты,
права, VPN, зависимости и миграции. Не выводить секреты или личные тексты.

- [x] Worker: pause on blocking receipt/source, preserve original unknown.
  Files: `server/src/jobs/jobAutomationWorker.js`, worker unit/PG acceptance.
- [x] Direction: isolated source-only veto after preliminary apply, false-core/
  positive regressions. Files: `jobDirectionVerification.js`, `jobModelAdapter.js`,
  source-only instruction/allowlist; worker stage integration with separate usage
  ID before API and no repeat after unknown. No resume/profile in verifier input.
- [x] Independent review, full server suite, dedicated PG regression.
  954 server passed /2 DB-only skipped on Node22; both included in PG24/24.
  Real current-provider public classifier benchmark6/6, cost$0.00205326,
  no HH POST. Lexical guard rejected, independent source-only veto accepted.
- [ ] Bilingual result/status; source/branch/PR audit; authorized GitHub/both VPS
  release, exact image source hashes, preserved env/mounts, runtime watch.
- [ ] Fresh live gate and supervised test only if safe; otherwise record the
  actual blocker without a new POST for any original unknown.
