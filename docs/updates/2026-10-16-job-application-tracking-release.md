# Учёт откликов установлен / Application tracking deployed

[Русский](#русский) | [English](#english)

## Русский

16 октября 2026. По поручению владельца опубликован код `7e10589e8c9c7f54d0613b58a8cc766dc912c289`
в GitHub main. Windows и оба VPS получили принятую версию. На DE установлен
server/browser release `/home/deploy/releases/jarvis-7e10589-job-history`.
Эта последующая запись меняет только документы.

«Поиск работы → Отклики» объединяет собственные операции и старую историю HH,
включая другие резюме. Первый вход запускает импорт; обновление доступно кнопкой.
Статусы отправки и работодателя показаны отдельно. Если отклик уже существует,
Jarvis объясняет это и не отправляет повторный. Периодических проверок и уведомлений нет.
[Сценарий](../superpowers/specs/2026-10-16-job-application-tracking-design.md),
[контракт меню](../telegram-menu-contract.md).

Проверки выпуска:

- Source/release guards, preflight, сохранение окружения и secret inode прошли.
- Собранные Linux-образы: server 649/649, browser 48/48 без пропусков.
  Отдельная временная PostgreSQL с pgvector: 24/24 job acceptance, 1/1 E2E,
  1/1 full-runtime с применением всех 37 миграций и повторным запуском migrations.
  Тесты не использовали production credentials, HH, модель или Telegram API.
- Migration 035 применена на рабочей базе. Owner-scoped чтение и rendering
  сохранённого списка прошли без имитации пользовательского нажатия и запуска импорта.
- Установленный server через приватный browser RPC прочитал active и archived:
  7 активных записей; архив сообщает 410 записей на 21 странице, первая содержит 20.
  Это проверка чтения, а не выполненный полный импорт.
- При первом запуске server возникла ошибка прав упакованных файлов из-за закрытой
  маски подготовки каталога. Права кода исправлены; выполнена повторная сборка
  из канонического Dockerfile. Запуск, readiness и публичный smoke проверены после исправления.
- Профиль, подключение HH, настройки поиска и количества черновиков/операций
  сохранились. Секреты и профиль браузера не заменялись. PostgreSQL, collector,
  OCR, ASR и ingress сохранили container IDs; collector временно останавливался
  на переключение browser и затем продолжил работу.
- Desktop 1.0.2 совпадает с принятым кодом; пересборка не требуется. На NL
  обновлены исходники; Host Agent и VPN не менялись.

Остаётся открыть «Отклики» в настоящем Telegram-клиенте, дождаться первого
полного импорта и сверить несколько старых записей. При необходимости пройти
CAPTCHA через существующий Telegram-путь. Выпуск не отправлял HH-откликов и
не скачивал переписки или прежние письма.

## English

16 October 2026. At the owner's request, code `7e10589e8c9c7f54d0613b58a8cc766dc912c289`
was published to GitHub main. Windows and both VPS source checkouts received it.
DE runs the server/browser release `/home/deploy/releases/jarvis-7e10589-job-history`.
This subsequent record changes documentation only.

Job search → Applications merges own operations with old HH history, including
other resumes. First opening starts an import; a button refreshes it. Submission
and employer states are separate. Existing applications are explained without
resubmission. There are no scheduled account checks or notifications. See the
design and menu contract linked above.

Release checks:

- Source/release guards, preflight, environment preservation and secret inode checks passed.
- Built Linux images: server 649/649, browser 48/48 without skips. A separate temporary
  pgvector PostgreSQL passed 24/24 job acceptance, 1/1 E2E and 1/1 full-runtime
  acceptance, applying all 37 migrations and rerunning migration processing.
  Tests used no production credentials, HH, model or Telegram API.
- Production migration 035 is applied. Owner-scoped saved-list reads and rendering
  passed without impersonating user input or starting an import.
- The installed server read active and archived sections through private browser RPC:
  7 active records; an archive of 410 records across 21 pages, with 20 on its first page.
  This verifies reading, not a completed full import.
- Initial server startup hit packaged-file permissions inherited from a restrictive
  staging umask. Code permissions were corrected and the canonical Dockerfile rebuilt.
  Startup, readiness and public smoke were checked after the correction.
- Profile, HH connection, search settings and draft/operation counts were preserved.
  Secrets and the browser profile were retained. PostgreSQL, collector, OCR, ASR and
  ingress kept their container IDs; the collector paused during the browser switch
  and resumed afterward.
- Desktop 1.0.2 matches accepted code and needs no rebuild. NL received source changes;
  Host Agent and VPN were unchanged.

Remaining acceptance: open Applications in the real Telegram client, wait for the
first full import and compare several old records. Complete CAPTCHA through the
existing Telegram flow if needed. This release sent no HH applications and downloaded
no chats or historical letters.
