# Восстановление HH CAPTCHA установлено на DE

[Русский](#русский) | [English](#english)

## Русский

16 октября 2026. После [локальной разработки](2026-10-16-hh-captcha-resilience-development.md)
владелец поручил публикацию и обновление всех узлов.

Код опубликован в GitHub main: `e6fe29a7e3129a34626223df9bd6a1b980da46be`.
Windows и оба VPS получили этот код. На DE server и job-browser установлены из
отдельного проверенного release checkout с тем же SHA. Последующая документация
не меняет исполняемый код и не требует пересборки.

### Что установлено

Подготовка CAPTCHA заменяет прежнюю вкладку, учитывает падение renderer и
возвращает понятное требование обновить непригодную картинку. Health проверяет
Chromium локальным JavaScript, а watchdog и предел операции завершают потерянный
или зависший runtime для восстановления штатной Docker policy.

Запрос обновления сохраняется до результата с проверкой своего UUID. Повторы
подготовки используют растущую паузу. Telegram 429 повторяет ту же запись фото
не более четырёх раз; неизвестный результат доставки или ответа HH требует
явного обновления, не повторяет старый POST. Сбои получают фиксированные
owner-scoped уведомления, неактуальные сообщения о задержке снимаются.

Migration 033 применена до запуска нового worker. Старые фотографии, прогресс,
настройки и журнал попыток сохранены. Код collector не пересобирался: во время
переключения его штатно остановили и запустили прежним контейнером после готовности
браузера, чтобы временный разрыв RPC не отложил следующий сбор.

### Проверки установки

- Source guard прошёл на Windows, DE и NL; release guard подтвердил полный SHA
  и его достижимость из GitHub main. Посторонних веток, worktrees и PR нет.
- Preflight и CAPTCHA Compose policy прошли. Окружение всех трёх jobs-компонентов
  совпало с прежним без вывода значений. Профиль HH сохранил inode, uid1001 и mode0700;
  секреты сохранили inode и права, `.env` совпал побайтно. Публичных портов нет.
- На новых образах: 91 серверная проверка, 45 Linux browser unit/HTTP и сценарий
  гибели Chromium → завершения main → запуска с прежними claims прошли.
  Полные результаты разработки: server 643/643, Telegram gate 65/65,
  PostgreSQL 9/9, Chromium HTTPS 5/5 и три runtime сценария.
- Server и browser healthy, readiness и публичный smoke прошли. Сверены 296 файлов
  server/shared и 32 файла browser; содержимое соответствует релизу.
- За время приёмки новых OOM и автоматических рестартов не было. Это наблюдение
  при установке, а не долговременный нагрузочный тест. Лимит браузера остался 1 GiB.
- PostgreSQL, OCR, ASR, ingress и collector сохранили свои container IDs.
  Host Agent/VPN не переустанавливались; службы обоих VPS активны.
- Desktop 1.0.2 совпал с принятым кодом: 140 файлов, native Electron и bundled
  Node проверены. Windows-клиент не менялся, сборка и переустановка не требовались.

### Настоящий сценарий

Новый worker отправил фото в Telegram и сохранил message binding. В 13:16:54 UTC
создана новая photo-запись; последующая owner-scoped проверка зафиксировала
`consumed / solved`, то есть полученный ответ был принят и точное чтение HH
подтвердило доступ. Ответ и содержимое картинки не сохранялись в отчёте.

Coordinator перешёл в idle. Collector получил активную lease и продвинул прежний
progress; настройки совпали с состоянием до установки, 46 оставшихся поисковых
окон сохранились. На момент проверки новых подходящих карточек после фото ещё
не было: это не мешало подтверждённому продвижению сбора.

Отправка нового отклика HH по-прежнему не проверена и этим выпуском не выполнялась.
Защита восстановления проверена на изолированных сбоях; длительная работа под
нагрузкой остаётся наблюдением эксплуатации.

## English

### HH CAPTCHA recovery installed on DE

16 October 2026. After [local development](2026-10-16-hh-captcha-resilience-development.md),
the owner authorized publishing and updating all nodes.

The code was published to GitHub main: `e6fe29a7e3129a34626223df9bd6a1b980da46be`.
Windows and both VPS nodes received this code. On DE, server and job-browser
were installed from a separate verified release checkout at the same SHA.
Subsequent documentation changes do not change executable code or require rebuilding.

### What was installed

CAPTCHA preparation replaces the previous tab, handles renderer crashes, and
returns a clear request to refresh unusable images. Health checks run local
JavaScript in Chromium. A watchdog and an operation deadline terminate a lost
or hung runtime so Docker's existing restart policy can recover it.

Refresh requests remain stored until an outcome is recorded, with UUID checks.
Preparation retries use increasing delays. Telegram 429 retries the same photo
record at most four times. An unknown delivery or HH answer result requires
an explicit refresh and does not repeat the old POST. Failures produce fixed
owner-scoped notices; obsolete delay messages are cleared.

Migration 033 was applied before the new worker started. Existing photos,
progress, settings, and attempt history were preserved. The collector was not
rebuilt: it was stopped normally during the switch and restarted using its
existing container after the browser became ready, so a temporary RPC interruption
would not postpone the next collection run.

### Installation checks

- Source guards passed on Windows, DE, and NL; the release guard confirmed the
  full SHA and its reachability from GitHub main. No unrelated branches,
  worktrees, or PRs were present.
- Preflight and CAPTCHA Compose policy passed. All three jobs components retained
  their previous environment without exposing values. The HH profile retained
  its inode, uid1001, and mode0700; secrets retained their inodes and permissions;
  `.env` matched byte for byte. There are no public ports.
- On the new images, 91 server checks, 45 Linux browser unit/HTTP checks, and
  the Chromium termination → main-process exit → restart with existing claims
  scenario passed. Full development results: server 643/643, Telegram gate 65/65,
  PostgreSQL 9/9, Chromium HTTPS 5/5, and three runtime scenarios.
- Server and browser were healthy; readiness and the public smoke check passed.
  Comparison covered 296 server/shared files and 32 browser files; their contents
  matched the release.
- No new OOM events or automatic restarts occurred during acceptance. This was
  an installation observation, not a sustained load test. The browser limit
  remained 1 GiB.
- PostgreSQL, OCR, ASR, ingress, and collector retained their container IDs.
  Host Agent/VPN were not reinstalled; services on both VPS nodes were active.
- Desktop 1.0.2 matched the accepted code: 140 files, native Electron, and bundled
  Node were checked. The Windows client was unchanged and needed no rebuild
  or reinstallation.

### Real scenario

The new worker sent a photo to Telegram and saved its message binding. A new
photo record was created at 13:16:54 UTC. A subsequent owner-scoped check recorded
`consumed / solved`: the answer was accepted, and an exact HH read confirmed
access. The report did not store the answer or image contents.

The coordinator returned to idle. The collector acquired an active lease and
advanced its existing progress. Settings matched the state before installation,
and the 46 remaining search windows were preserved. At the time of the check,
no new matching cards had appeared after the photo; collection progress was
nevertheless confirmed.

Submitting a new HH application remains unchecked and was not performed by this
release. Recovery safeguards were tested with isolated failures; sustained
operation under load remains an operational observation to complete.
