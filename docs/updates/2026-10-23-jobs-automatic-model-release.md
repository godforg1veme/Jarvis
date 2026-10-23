# Автоматическая модель писем HH: выпуск 23 октября

[Русский](#русский) | [English](#english)

## Русский

По поручению владельца полностью удалён ручной выбор модели в поиске работы:
пункт панели, пресеты, ввод ID, старый текстовый параметр, callbacks и отдельная
переменная `JARVIS_JOB_MODEL`. Письма используют общую автоматическую очередь
OpenRouter: проверенные бесплатные модели, затем настроенный платный резерв.
Генерация остаётся по запросу; отправка письма сохраняет отдельное подтверждение.
[Реализация и локальные проверки](2026-10-22-jobs-automatic-model-development.md).

Код выпуска: `97e9a0a2514421b7536bb10c57a4e0ea0f27cb07`.
Release: `/home/deploy/releases/jarvis-97e9a0a-jobs-auto`.
На DE обновлены server и collector одним образом
`sha256:9a8de471563aea6f62ebb791cabec8c7c3d72e0735632e9ceeda7e43f4a5766d`.
Server healthy, оба running и restarts 0. Migration 045 применена.
У четырёх пользователей удалён сохранённый выбор; хеши остальных настроек
и revisions совпали с состоянием до выпуска. Старые previews и активный ввод
модели аннулированы. В реальной серверной панели девять строк, controls модели нет.

Свежий read-only каталог OpenRouter подтвердил семь бесплатных текстовых
моделей и два настроенных платных резерва. Реальная генерация письма и платные
model POST для приёмки не запускались. Тесты через локальный HTTP, bot handlers
и PostgreSQL проверяют автоматическую генерацию, правку, перевод, подтверждение
и сверку потерянного ответа по исходному ID.

Новый Linux-образ прошёл 791/791 unit и 26/26 PostgreSQL-сценариев без пропусков;
локальный Telegram gate прошёл 66/66. Отдельные тестовые PostgreSQL и internal
сеть удалены. Server/shared совпали по 338 исходным файлам, общий runtime inventory
проверил 340 файлов с package metadata. Готовые интерфейсы сохранены из прежнего
образа. Проверены 87 server и 10 collector environment keys; лишнего job-model
ключа нет. Volumes и inode секретного bind mount сохранены.

Публичные live/ready проверки прошли. Browser, PostgreSQL, OCR, ASR и tunnel
сохранили container IDs. Host Agent и VPN-службы обоих VPS активны и не менялись.
GitHub main, Windows HEAD и чистые source checkout DE/NL синхронизированы.
Desktop 1.0.2 совпадает по 146 файлам и native/runtime; сборка не требуется.
Чужие локальные ветки и worktrees сохранены, что даёт ожидаемое предупреждение
общего Windows inventory. Настоящие Telegram-нажатия остаются для клиента.
Приватные подтверждения: `/home/deploy/maintenance/jobs-auto-20261023`.

## English

At the owner's request, manual job-model selection is removed completely:
menu item, presets, custom ID, legacy text input, field callbacks and dedicated
environment setting. Letters use the shared automatic OpenRouter queue:
verified free models, then configured paid fallback. Generation remains
user-triggered and sending retains a separate confirmation.
[Implementation and local checks](2026-10-22-jobs-automatic-model-development.md).

Release code: `97e9a0a2514421b7536bb10c57a4e0ea0f27cb07`.
Release: `/home/deploy/releases/jarvis-97e9a0a-jobs-auto`.
DE server and collector use image
`sha256:9a8de471563aea6f62ebb791cabec8c7c3d72e0735632e9ceeda7e43f4a5766d`.
Server is healthy, both are running with zero restarts, and migration 045 applied.
Saved overrides were removed for four users; all remaining preference hashes
and revisions match their pre-release state. Old previews/model input were
invalidated. The live server-rendered settings panel has nine rows and no model controls.

A fresh read-only OpenRouter catalog confirmed seven free text models and two
configured paid backups. Acceptance did not generate a real letter or issue
paid model POST requests. Local HTTP/bot/PostgreSQL tests cover automatic
generation, editing, translation, confirmation and original-ID reconciliation.

The Linux image passed 791/791 unit and 26/26 PostgreSQL checks without skips;
the local Telegram gate passed 66/66. Disposable PostgreSQL/network resources
were removed. All 338 server/shared source files match, and runtime inventory
checked 340 files including package metadata. Prebuilt UI assets are retained.
Environment checks covered 87 server and 10 collector keys; the obsolete key
is absent. Volumes and the secret bind-mount inode are preserved.

Public live/ready checks passed. Browser, PostgreSQL, OCR, ASR and tunnel kept
their container IDs. Host Agent and VPN services remain active on both VPSs.
GitHub main, Windows HEAD and clean DE/NL source checkouts are synchronized.
Desktop 1.0.2 matches 146 files and native/runtime; rebuilding is unnecessary.
Other local branches/worktrees were preserved, producing an expected Windows
inventory warning. Real Telegram taps remain a client check.
Private evidence: `/home/deploy/maintenance/jobs-auto-20261023`.
