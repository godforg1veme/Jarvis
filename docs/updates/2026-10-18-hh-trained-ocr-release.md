# Дообученный OCR HH: выпуск / Fine-tuned HH OCR release

[Русский](#русский) | [English](#english)

## Русский

18 октября 2026. Владелец разрешил новые зависимости, публикацию в GitHub,
обновление VPS и автоматическую обработку ожидающей CAPTCHA. Код выпуска:
`e25a4b70e3ed59e2ed600aab51e15c69105e7eaa`. Последующий коммит обновляет
документы и поддержку Compose overlay в проверке версий, без изменения runtime.
[Локальные измерения и ограничения данных](2026-10-18-hh-trained-ocr-development.md).

### Установка

| Узел | Фактический результат |
| --- | --- |
| GitHub / Windows | Код опубликован в `main`; исходники чистые, рабочая ветка объединена |
| DE source | Чистый `/home/deploy/apps/jarvis`, source guard прошёл до staging |
| DE runtime | `/home/deploy/releases/jarvis-e25a4b7-trained-ocr`; пересобраны и заменены только server, job-browser, job-ocr; все healthy |
| NL | Обновлён чистый source; job services там не запускались |
| Desktop | 143 проверенных файла, package и native/wake-word runtime совпадают; EXE не менялся |
| Остальные службы | PostgreSQL, ASR, collector, Cloudflare, Host Agent и VPN не пересоздавались; Xray/Hysteria2 и peer timers активны |

Новый OCR запущен через `deploy/job-ocr-frozen.yml`: CPU, лимит 1 GiB,
network none, read-only rootfs, UID 1001, без host ports и capabilities.
Browser/server получают `JARVIS_HH_CAPTCHA_AUTOMATIC=1`. Модель доступна только
через `/ocr/frozen` на прежнем приватном UNIX socket. Старый общий OCR не может
незаметно заменить её. Defaults в репозитории остаются выключенными.

Bundle перенесён приватно, без GitHub и датасетов. SHA-256 его manifest:
`af3ec0c2ef0148dea41c08b0f468381c32d00581bafd06b3542ebab7e9fa77ea`.
Основные дообученные и rescue веса проверяются перед загрузкой. Сохранены
исходные выпрямление, две обрезки, CTC greedy/beam, выбор и insertion rescue.
Зависимости закреплены версиями и хешами в `frozen-requirements.lock`.

Прежний HH profile volume, owner, claims, journal, настройки и progress сохранены.
До замены проверено совпадение критических environment values без их вывода,
profile volume и bytes смонтированного секрета. Старые release directories и
смонтированные inode не удалялись. Новый release получил копию активного private
environment; устаревший canonical `.env` не подставлялся. Значения секретов,
изображения и ответы в Git и отчёт не включены. Backup/restore не запускались.

### Проверки

- Повторно локально: server 725/725, browser 52/52 с четырьмя Linux-only skips.
  Предыдущий локальный Telegram contract 65/65 и CPU PNG parity 73/73 сохранены.
- На DE в изоляции: browser 56/56, включая все четыре Linux filesystem/ownership
  проверки; OCR worker 10/10.
- Linux Chromium → broker → настоящий server client/photo worker: пять сценариев
  первой/второй удачи, двух отказов, unknown и redirect прошли без сети.
  Отдельный CPU-model тест внутри browser image был пропущен: там нет Python
  OCR runtime; настоящая модель проверена следующим socket-тестом и ранее
  полной Windows browser цепочкой.
- Настоящий Linux worker в отдельном контейнере без production profile:
  эталон через UNIX socket распознан точно, неверный PNG отклонён; socket 0600,
  directory 0700, UID 1001. Пик памяти 416 694 272 bytes, OOM=false при лимите 1 GiB.
- Файлы установленного browser (33) и worker (4) совпали с release. Server source,
  package/build inputs сверяются общей release-status проверкой. Health/readiness,
  включая публичный `/health/ready`, прошли.
- Исправлена только проверка версии: прежний release-status считал несколько
  Compose-файлов неизвестным release. Теперь проверяет основной файл и каждый
  overlay одного release. Все 15 её тестов прошли; runtime от этого не менялся.

Кратковременные сбои SSH потребовали повторного чтения состояния. Перед
продолжением проверялись исходные checkpoints, контейнеры и файлы результатов;
операции с неизвестным результатом не запускались под новым ID.

### Реальная CAPTCHA

Автоматика действительно дошла до текущего incident: зафиксированы первая
попытка OCR, две durable claims и read-only проверка. Результат не подтвердил
доступ и был классифицирован как unknown. Факт успешного прохождения и даже
подтверждённый upstream receipt не установлены. Второй автоматической отправки
не было: бюджет перешёл в `human`, claims не очищались и не сбрасывались.

После остановки отправлено новое owner-bound фото в Telegram; БД подтверждает
`sent` с message binding. Поиск остаётся `attention`, при этом activated=true,
paused=false и progress сохранён. До и после попытки было 1 210 отправленных
карточек. Прежняя строка `solved` относится к старому ручному ответу, не к OCR.

Чтобы продолжить текущую проверку, владелец может ответить на новое фото.
Это прежнее origin-bound подтверждение одной отправки. Успешное прохождение
настоящей CAPTCHA автоматическим OCR и возобновление collector пока не
подтверждены. Для новых incidents остаётся максимум две попытки; unknown
останавливает автоматику раньше. Синтетические проценты не являются живой
точностью HH; длительная работа и серия новых реальных изображений не измерены.

## English

18 October 2026. The owner authorized dependencies, GitHub publication, VPS
updates and automatic handling of the waiting CAPTCHA. Runtime code revision:
`e25a4b70e3ed59e2ed600aab51e15c69105e7eaa`. The following commit updates docs and
Compose-overlay support in version verification without changing runtime.
[Local measurements and dataset limits](2026-10-18-hh-trained-ocr-development.md).

### Installation

| Node | Actual result |
| --- | --- |
| GitHub / Windows | Code published to `main`; clean source, task branch merged |
| DE source | Clean `/home/deploy/apps/jarvis`; source guard passed before staging |
| DE runtime | `/home/deploy/releases/jarvis-e25a4b7-trained-ocr`; only server, job-browser and job-ocr rebuilt/replaced; all healthy |
| NL | Clean source updated; job services were not started there |
| Desktop | 143 files, package and native/wake-word runtime match; no EXE changes |
| Other services | PostgreSQL, ASR, collector, Cloudflare, Host Agent and VPN were not recreated; Xray/Hysteria2 and peer timers remain active |

The new OCR runs through `deploy/job-ocr-frozen.yml`: CPU, 1 GiB limit, network
none, read-only rootfs, UID 1001, no host ports or capabilities. Browser/server
receive `JARVIS_HH_CAPTCHA_AUTOMATIC=1`. Only `/ocr/frozen` on the existing private
UNIX socket serves the model; the old general OCR cannot silently substitute for
it. Repository defaults remain disabled.

The bundle was transferred privately without GitHub or datasets. Its manifest
SHA-256 is `af3ec0c2ef0148dea41c08b0f468381c32d00581bafd06b3542ebab7e9fa77ea`.
Fine-tuned and rescue weights are verified before loading. Original rectification,
two crops, greedy/beam CTC, selection and insertion rescue are retained.
`frozen-requirements.lock` pins dependency versions and hashes.

The existing HH profile volume, owner, claims, journal, settings and progress were
preserved. Critical environment values were compared without disclosure, as were
the profile volume and mounted-secret bytes. Old releases and mounted inodes were
not deleted. The new release copied the active private environment instead of
using the stale canonical `.env`. Secrets, images and answers are absent from Git
and this report. Backup/restore was not run.

### Verification

- Repeated local suites: server 725/725; browser 52/52 plus four Linux-only skips.
  Earlier Telegram contract 65/65 and CPU PNG parity 73/73 remain recorded.
- Isolated DE suites: browser 56/56, including all four filesystem/ownership
  checks; OCR worker 10/10.
- Linux Chromium → broker → actual server client/photo worker passed five
  scenarios covering first/second success, two failures, unknown and redirect,
  without networking. The separate CPU-model test inside the browser image was
  skipped because it lacks the Python OCR runtime. The real model was exercised
  by the socket test below and the earlier complete Windows browser chain.
- The actual Linux worker in an isolated container without a production profile
  recognized the fixture exactly through its UNIX socket and rejected invalid
  PNG: socket 0600, directory 0700, UID 1001. Peak memory was 416,694,272 bytes;
  OOM=false under the 1 GiB limit.
- Installed browser (33 files) and worker (4 files) matched the release. Server
  source, package/build inputs are checked by release-status. Health/readiness,
  including public `/health/ready`, passed.
- The version checker alone needed repair: it previously treated multiple Compose
  files as an unknown release. It now checks the base file and every overlay of
  one release. All 15 tests passed; this did not change runtime.

Transient SSH failures required rereading state. Original checkpoints, containers
and result files were inspected before continuing; unknown operations were not
restarted under new IDs.

### Actual CAPTCHA

Automation reached the current incident: the first OCR attempt, two durable
claims and read-only verification were observed. Access was not confirmed and
the outcome was classified as unknown. Neither a successful solve nor a confirmed
upstream receipt was established. No second automatic submission occurred: the
budget moved to `human`, and claims were neither cleared nor reset.

A new owner-bound photo was then sent to Telegram; the database confirms `sent`
with its message binding. Search remains in `attention`, with activated=true,
paused=false and progress retained. Delivered cards remained at 1,210 before and
after the attempt. An earlier `solved` row belongs to an old human reply, not OCR.

The owner can reply to the new photo to continue the current check, preserving
the existing origin-bound single-submission confirmation. Actual automatic HH
acceptance and collector resumption remain unconfirmed. New incidents retain a
two-attempt maximum; unknown stops automation earlier. Synthetic percentages do
not establish live HH accuracy; sustained operation and a series of new actual
images have not been measured.
