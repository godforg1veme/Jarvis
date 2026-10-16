# Описание проекта на двух языках / Bilingual project documentation

[Русский](#русский) | [English](#english)

## Русский

16 октября 2026. Изменения документации по поручению владельца; позднее в тот же
день владелец поручил публикацию и сверку всех узлов.

В [руководство выпуска](../release-workflow.md#русский-и-английский-тексты)
добавлено правило: полное описание проекта, текущий статус и новые или
обновляемые записи об обновлениях ведутся на русском и английском. Оба текста
обновляются вместе; Humanizer применяется к каждому при доступности. Правило
охватывает GitHub Releases и, при изменении, краткое описание репозитория About.
Старую историю не требуется переводить целиком.

[Корневой README](../../README.md), [текущий статус](../README.md) и
[последняя запись о выпуске](2026-10-16-hh-captcha-resilience-release.md)
получили полные разделы на двух языках. В истории статуса уточнено, что отсутствие
выпуска поиска работы относилось к прежнему этапу разработки. AGENTS и
jarvis-release ссылаются на общее правило.

Проверены локальные ссылки, языковые разделы, команды и числовые данные между
переводами, а также diff на пробельные ошибки. Код и зависимости не менялись;
приложения не пересобирались. На этапе локальной подготовки GitHub и VPS
не обновлялись. Результаты прежних выпусков в переводах сохранены с исходными
датами; новая проверка после публикации описана ниже.

### Публикация и сверка

Документация опубликована в GitHub `main` коммитом
`5d03febf79fe74399b600b814579048ada54d2eb`. Windows и исходники DE/NL получили
эту версию; source guards прошли на всех узлах. Краткое описание GitHub About
обновлено на двух языках. Новая страница GitHub Releases не создавалась.
Эта запись результата публикуется отдельным документальным коммитом.

Общая команда `release-status.py --fetch --vps --desktop-app ... --check`
прошла без замечаний: чистая `main`, нет отставания, посторонних веток, worktrees,
stash и открытых PR. Desktop 1.0.2 совпадает по 140 файлам, manifest, native
Electron и bundled Node. На обоих VPS Host Agent совпадает по 16 модулям;
Host Agent, Xray, Hysteria и peer probe timers активны. Сервер healthy,
296 файлов и входные файлы сборки совпадают. Сервер работает из
`e6fe29a7e3129a34626223df9bd6a1b980da46be`: позднее менялась документация.

Дополнительная проверка обнаружила и уточнила отличия вне основной команды:

- Browser healthy; 32 файла и исполняемые входы сборки совпадают. От релиза
  отличается только `job-browser/README.md`, который не входит в образ.
  У контейнера один перезапуск, последнее начало работы в 14:08:34 UTC.
  В момент проверки `OOMKilled=false`, health failures отсутствуют;
  причина перезапуска этой проверкой не установлена.
- Collector работает из сохранённого релиза
  `b0712e69875adbe62db1892007da65f34d4d636f` и полностью совпадает с ним.
  При сравнении 296 файлов с `main` отличаются 8: migration 033,
  `jobCaptchaClient.js`, `jobCaptchaNotices.js`, `jobCaptchaRepository.js`,
  `jobCaptchaWorker.js`, `jobDeliveryRepository.js`, `jobDeliveryWorker.js`
  и `runtime.js`. Манифесты зависимостей совпадают. Из 12 статически найденных
  локальных зависимостей collector отличается только `jobDeliveryRepository.js`:
  изменён метод `claim`, который collector не вызывает; используемые им
  `enqueue` и `enqueueAttention` не менялись. Это сохранённое решение
  [прежнего выпуска](2026-10-16-hh-captcha-resilience-release.md),
  а не полное совпадение всех файлов контейнера с `main`.
- Qwen остановлен с кодом 0 как тестовый профиль согласно
  [runtime-context](../runtime-context.md); рабочий GigaAM и PostgreSQL healthy.

Службы в этом документальном выпуске не перезапускались. Новые проверки
микрофона, Telegram-сценариев, VPN-трафика и отправки отклика HH не выполнялись.

## English

16 October 2026. Documentation changes requested by the owner; later the same
day, the owner authorized publishing and comparing all nodes.

The [release guide](../release-workflow.md#русский-и-английский-тексты) now
requires the full project description, current status, and new or updated
update records in Russian and English. Both texts are updated together;
Humanizer is applied to each when available. The rule covers GitHub Releases
and the repository's short About description when it is changed. Translating
the entire historical archive is not required.

The [root README](../../README.md), [current status](../README.md), and
[latest release record](2026-10-16-hh-captcha-resilience-release.md) now contain
full sections in both languages. The status history clarifies that the unreleased
job-search feature referred to an earlier development stage. AGENTS and
jarvis-release refer to the shared rule.

Local links, language sections, commands, numeric data across translations, and
the diff for whitespace errors were checked. Code and dependencies were unchanged;
applications were not rebuilt. GitHub and VPS nodes were not updated during local
preparation. Translations preserve earlier release results with their original
dates; the new comparison after publishing is described below.

### Publishing and comparison

The documentation was published to GitHub `main` in commit
`5d03febf79fe74399b600b814579048ada54d2eb`. Windows and the DE/NL source checkouts
received that version; source guards passed on all nodes. The GitHub About
description was updated in both languages. No new GitHub Releases page was
created. This result record is published in a separate documentation commit.

The full `release-status.py --fetch --vps --desktop-app ... --check` command
passed without issues: clean `main`, no lag, unrelated branches, worktrees,
stash entries, or open PRs. Desktop 1.0.2 matches across 140 files, its manifest,
native Electron, and bundled Node. Host Agent matches across 16 modules on each
VPS; Host Agent, Xray, Hysteria, and peer probe timers are active. The server is
healthy; 296 files and build inputs match. The server runs from
`e6fe29a7e3129a34626223df9bd6a1b980da46be`: later changes were documentation.

Additional checks found and clarified differences outside the main command:

- Browser is healthy; 32 files and executable build inputs match. Only
  `job-browser/README.md` differs from its release; that file is not in the image.
  The container has one restart, with its latest start at 14:08:34 UTC.
  At inspection, `OOMKilled=false` and there were no health failures;
  this check did not establish the restart cause.
- Collector runs from the retained release
  `b0712e69875adbe62db1892007da65f34d4d636f` and matches it completely.
  Comparing 296 files with `main` found 8 differences: migration 033,
  `jobCaptchaClient.js`, `jobCaptchaNotices.js`, `jobCaptchaRepository.js`,
  `jobCaptchaWorker.js`, `jobDeliveryRepository.js`, `jobDeliveryWorker.js`,
  and `runtime.js`. Dependency manifests match. Of 12 statically identified
  local collector dependencies, only `jobDeliveryRepository.js` differs:
  its changed `claim` method is not called by collector; the methods it uses,
  `enqueue` and `enqueueAttention`, are unchanged. This retains the decision
  from the [previous release](2026-10-16-hh-captcha-resilience-release.md);
  it does not mean every container file matches `main`.
- Qwen is stopped with exit code 0 as a benchmark profile, as documented in
  [runtime-context](../runtime-context.md); the active GigaAM and PostgreSQL are healthy.

Services were not restarted in this documentation release. No new microphone,
Telegram scenario, VPN traffic, or HH application-submission checks were performed.
