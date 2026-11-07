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
- [x] Bilingual result/status; source/branch/PR audit; authorized GitHub/both VPS
  release, exact image source hashes, preserved env/mounts, runtime watch.
- [x] Fresh live gate and supervised test only if safe; otherwise record the
  actual blocker without a new POST for any original unknown.

Observed release `4836021`: live 03:41–03:51 MSK, five skips, one new403,
15-minute backoff confirmed (893 seconds observed), automation restored off28.
Delivery remains unresolved; next stage adds closed request/response diagnostics.

- [x] Closed original403 diagnostic, immutable claim-bound journal; no new RPC,
  secrets, POST/retry or outcome changes. Independent security review accepted.
  Linux/Chromium160/160 passed; Windows focused6/6.
- [x] Install diagnostic browser image with exact-source validation; preserve
  server/collector images, profiles, env, mounts and policies.
- [ ] Current manual CAPTCHA gate; read-only diagnostic/live result after it,
  without repeating any previous uncertain operation.

Diagnostic release `e816e67` installed: browser59/server390 files and vendor pin
matched; env/mounts/inodes/policies/other services preserved. Final image14/14
passed after the initial full160/160. Current manual gate active2691; autooff28.
