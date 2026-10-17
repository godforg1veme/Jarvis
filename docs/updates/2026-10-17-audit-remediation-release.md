# Исправления аудита выпущены / Audit fixes deployed

[Русский](#русский) | [English](#english)

## Русский

17 октября 2026. По поручению владельца все 13 подтверждённых исправлений
опубликованы в GitHub `main` и установлены на нужные компоненты.
Основные коммиты: `343f1bb` и
`70e5bcd71f800837566c77c257acf005ea5cb5f8`.
[Разработка и состав исправлений](2026-10-17-audit-remediation-development.md).
Предложения A01–A07 и D01 в выпуск не включены.

| Компонент | Фактический результат |
| --- | --- |
| GitHub, Windows, DE/NL source | Принятая `main`; последующий коммит результатов меняет документацию и состав файлов проверки Desktop |
| Server / Operations UI, DE | Release `70e5bcd71f800837566c77c257acf005ea5cb5f8`, `/home/deploy/releases/jarvis-70e5bcd-audit-remediation`; healthy, readiness и публичный smoke прошли |
| Host Agent DE/NL | Установлены полные trees; все 17 модулей совпадают с принятой версией, службы и socket health работают |
| Desktop | Собран и установлен 1.0.2 с новым кодом; 143 файла, manifest, native Electron 42.11.9 и bundled Node совпадают с принятой версией |
| VPN и peer timers | Службы Xray/Hysteria2 и существующие peer timers active на обоих узлах; VPN-службы не перезапускались |

### Что проверено

- Ветки, worktrees, stash и PR проверены; посторонней работы не было.
  Объединение выполнено fast-forward без force; завершённая task branch удалена
  после проверки включения. Source/release guards и preflight прошли.
- Windows: server 723/723, cloud/voice/TTS 73/73, Operations test 1/1 и build.
  IPC/Gateway, media permissions и browser fixtures прошли. Подробные команды
  находятся в [verification.md](../verification.md).
- В новом Linux server image прошли 723/723 unit tests при `TZ=Europe/Moscow`.
  Первый запуск в UTC дал 722/723: существующий тест commitment detector сравнивает
  локальный час через `getHours()`. Проверка с явной тестовой timezone прошла;
  production timezone и код этого теста не менялись.
- Host Agent прошёл 149/149 на каждом Linux-узле до установки и повторно после
  неё: установленные модули через `PYTHONPATH=/opt/jarvis-host-agent`, тесты из
  полного source tree с соседними `deploy/vpn` fixtures. Запуск всех тестов прямо
  из `/opt` не содержит этих repository fixtures и не является корректной проверкой.
- Сервер заменён с `--no-deps`. Из container IDs изменился только server:
  `82b5394343ab092d8a8455e886c771b29dbaa3af61b8f0a7031a260a91fa3764`.
  PostgreSQL, browser, collector, OCR, ASR и ingress не пересоздавались.
  Окружение и секреты скопированы из прежнего release и сверены без вывода значений;
  права сохранены, прежний release и его mounted inode оставлены на месте.
- Origin Operations отдаёт `/ops/` 200 и закрытый `/ops/api/overview` 401 без сессии.
  Внешняя проба Operations с VPS получила 403; доступ владельца через внешний
  браузер требует отдельной проверки. Публичные `/health/live` и `/health/ready` прошли.
- После подтверждения Windows установщик завершился. Bundled Node загрузил
  `ref-napi`, `ffi-napi`, `vosk`. Работающий установленный Electron загрузил Cloud
  Chat; удалённых raw IPC handlers нет, главное окно и widget не предоставляют
  `executeTool`/`confirmCommand`, widget не имеет cloud bridge. После smoke
  приложение вновь запущено обычным способом.
- Проверка релиза теперь включает `desktop/` с тремя новыми minimal preloads;
  14 fixture-тестов release inventory прошли. Сверка server/shared/package/build
  inputs и установленных компонентов прошла.

### Оставшиеся клиентские проверки

Живые микрофон/голос, камера, удалённые изменяющие команды, Telegram-нажатия,
внешний owner Operations browser и VPN protocol traffic в этом выпуске не
имитировались. Health snapshot не заменяет protocol probe: оба протокола
остались unverified в этой проверке. Настоящую PostgreSQL acceptance с временной
базой повторно не запускали; production readiness прошла. Новые зависимости,
backup timer и backup/restore drill не добавлялись и не включались.

## English

17 October 2026. At the owner's request, all 13 confirmed fixes were published
to GitHub `main` and installed in the affected components.
The implementation commits are `343f1bb` and
`70e5bcd71f800837566c77c257acf005ea5cb5f8`.
[Development record and fixes](2026-10-17-audit-remediation-development.md).
Proposals A01–A07 and D01 are outside this release.

| Component | Observed result |
| --- | --- |
| GitHub, Windows, DE/NL source | Accepted `main`; the subsequent results commit changes documentation and Desktop inventory coverage |
| Server / Operations UI, DE | Release `70e5bcd71f800837566c77c257acf005ea5cb5f8`, `/home/deploy/releases/jarvis-70e5bcd-audit-remediation`; healthy, readiness and public smoke passed |
| Host Agent DE/NL | Full trees installed; all 17 modules match the accepted version, services and socket health work |
| Desktop | Version 1.0.2 rebuilt and installed with the fixes; 143 files, manifest, native Electron 42.11.9 and bundled Node match the accepted version |
| VPN and peer timers | Xray/Hysteria2 services and existing peer timers are active on both nodes; VPN services were not restarted |

### Verification

- Branches, worktrees, stash and PRs were inspected; no unrelated work was present.
  The task was merged fast-forward without force; its branch was removed after
  checking inclusion. Source/release guards and preflight passed.
- Windows: server 723/723, cloud/voice/TTS 73/73, Operations test 1/1 and build.
  IPC/Gateway, media permissions and browser fixtures passed. Commands are in
  [verification.md](../verification.md).
- The new Linux server image passed 723/723 unit tests with `TZ=Europe/Moscow`.
  The first UTC run passed 722/723: an existing commitment-detector test compares
  a local hour through `getHours()`. It passed with an explicit test timezone;
  production timezone and that test's code were unchanged.
- Host Agent passed 149/149 on each Linux node before installation and again
  afterwards, using installed modules via `PYTHONPATH=/opt/jarvis-host-agent` and
  tests from the complete source tree with adjacent `deploy/vpn` fixtures.
  Running every test directly from `/opt` lacks those repository fixtures and
  is not a valid verification layout.
- The server was replaced with `--no-deps`. Only its container ID changed:
  `82b5394343ab092d8a8455e886c771b29dbaa3af61b8f0a7031a260a91fa3764`.
  PostgreSQL, browser, collector, OCR, ASR and ingress were not recreated.
  Environment and secrets were copied from the previous release and compared
  without printing values; permissions were preserved, and the old release
  and its mounted inodes remain in place.
- Origin Operations returns 200 for `/ops/` and 401 for the private
  `/ops/api/overview` without a session. An external Operations probe from the
  VPS received 403; owner access through an external browser needs a separate
  check. Public `/health/live` and `/health/ready` passed.
- The installer completed after Windows approval. Bundled Node loaded
  `ref-napi`, `ffi-napi` and `vosk`. The installed Electron loaded Cloud Chat;
  removed raw IPC handlers are absent, the main window and widget do not expose
  `executeTool`/`confirmCommand`, and the widget has no cloud bridge. The app was
  started normally again after the smoke check.
- Release inventory now includes `desktop/` and its three minimal preloads;
  all 14 inventory fixture tests passed. Server/shared/package/build inputs
  and installed component comparisons passed.

### Remaining client checks

Live microphone/voice, camera, changing remote commands, Telegram taps,
external owner Operations browser access and VPN protocol traffic were not
simulated during this release. Health snapshots do not replace protocol probes:
both protocols remained unverified in this check. Disposable real-PostgreSQL
acceptance was not rerun; production readiness passed. No new dependencies,
backup timer or backup/restore drill were introduced or enabled.
