# HH browser: чтение и проверка формы

Изолированный пакет для замены недоступного API соискателя. Реализованы чтение
поиска, вакансий, собственных резюме и безопасная проверка формы. Сборщик
подключён через приватный RPC. Отправка ещё не подключена.
Playwright/Chromium согласованы владельцем 15 октября 2026.

## Проверка без аккаунта

```powershell
cd job-browser
npm ci
npm test
$env:JARVIS_HH_BROWSER_PROBE='1'
npm run probe
```

Локальный probe требует соответствующего установленного Chromium. Для DE
используется отдельный Docker image с pinned base digest и non-root `pwuser`.
При обходе внешнего сайта обязательно `chromiumSandbox: true` и официальный
seccomp профиль. Профиль скачан из
`https://raw.githubusercontent.com/microsoft/playwright/v1.64.0/utils/docker/seccomp_profile.json`,
SHA256 `cc3e61cabda6bbc1e53e54d27ba4d55a9d3be829b6dd1a596f4a7b31b1cc7849`.
Его нельзя подменять `privileged`, root, host IPC или `--no-sandbox`.

```bash
docker build -t jarvis-job-browser-probe:20261015 .
docker run --rm --init --user pwuser --memory=1g --cpus=1 --pids-limit=256 \
  --shm-size=256m --security-opt seccomp=/absolute/path/seccomp_profile.json \
  -e JARVIS_HH_BROWSER_PROBE=1 jarvis-job-browser-probe:20261015 node src/probe.js
```

Проба посещает максимум три страницы: поиск, одну найденную вакансию и вход.
429/CAPTCHA/отказ/unknown прерывают переходы. Вывод — закрытые состояния,
число ссылок и известные признаки формы. Ни HTML, ни cookies, ни тексты
вакансий или CAPTCHA URL в stdout не попадают. Неизвестное не означает healthy.
Разрешённые домены ограничены; часть ресурсов блокируется этой политикой,
поэтому результат не описывает поведение при произвольном полном сетевом доступе.

На DE успешно проверены HTTP 200 выдачи (20 ссылок), наличие полного
описания вакансии и страница входа. В этих публичных пробах видимая CAPTCHA
не обнаружена. Это не доказывает отсутствие CAPTCHA после ввода данных,
при повторных сессиях или отправке отклика.

## Временный вход владельца

`node src/ownerLogin.js` требует `JARVIS_HH_OWNER_LOGIN=1`. Профиль находится
в отдельном приватном volume `/home/pwuser/profile`, права 0700. Окно входа
закрывается через 30 минут; данные сессии сохраняются в volume. Его нельзя
копировать в Git, логи или обмениваться им через чат. Пароль и код вводит сам
владелец на странице HH. Скрипт ничего не вводит и не отправляет.

CDP слушает внутри контейнера, relay направляет только к фиксированному
локальному порту. Обязательное host binding: `127.0.0.1:19222:9223`;
никаких `0.0.0.0` host bindings. Доступ с Windows — только SSH forward.
Нельзя подключать контейнер к сети Jarvis, передавать DB/model/Telegram env,
Docker socket или host directories. Используется отдельная Docker network.

В Edge открыть `edge://inspect/#devices` (Chrome: `chrome://inspect/#devices`),
включить Discover network targets, Configure → `localhost:19222` → Done.
У вкладки HH выбрать inspect и Toggle screencast, если страница не отображается.
Этот способ просмотра описан в [документации Chrome](https://developer.chrome.com/docs/automation-and-testing/debug-headless).

После входа владелец сообщает, что готов. До этого автоматическая проверка
личного кабинета не запускается. По завершении этапа остановить именно
task-labelled контейнер и локальный SSH tunnel; volume сохраняется.
Не удалять volume без поручения владельца.

## Что ещё не проверено

Вход владельца подтверждён read-only проверкой раздела резюме 15 октября 2026.
Авторизация сохранилась при штатном перезапуске браузера с тем же volume;
временный канал управления закрыт. CAPTCHA в этой проверке не появилась.
Успешный вход не гарантирует отсутствие дополнительных проверок в будущем.

Для повторной read-only проверки используется `node src/verifySession.js`
с `JARVIS_HH_VERIFY_SESSION=1`, тем же owner volume, sandbox и без CDP/ports.
Одновременный запуск с браузером, уже владеющим профилем, запрещён. Скрипт
проверяет uid/0700 перед чтением и выводит только закрытый статус.

Основное резюме выбрано владельцем и сопоставлено с карточкой HH. Проверка
формы сначала дала ложный запрет из-за скрытого tooltip. Использование фактической
видимости исправило проверку: основной режим — «Скрыто от выбранных работодателей».
Существующий стоп-лист прочитан на DE; inspect блокирует его компании, а при
неполных данных возвращает manual-required. Список и видимость не меняются.
Подготовка письма и журнал отправки проверены на fixtures; реальная отправка
ещё не подключена. Telegram/PostgreSQL проверки не заменяют browser
E2E отправки. Публичные результаты не разрешают реальный отклик.

## Приватный сервис чтения

Compose-профиль `job-search-de` содержит отдельные `job-browser` и
`job-collector`. Браузер находится только в сети `job-browser-rpc`, без host
ports, DB/model/Telegram env и CDP. Сборщик также подключён к backend для PG.
RPC принимает закрытые `search`, `vacancy`, `resumes`, `connection`, `inspect`
с отдельным read-секретом и единственным owner UUID. `submit`/`reconcile`
выключены по умолчанию; требуют `JARVIS_JOB_BROWSER_APPLY_ENABLED=1` и другого
случайного `JARVIS_JOB_BROWSER_APPLY_TOKEN`. Apply credential получает только
bot server и browser, сборщик располагает read credential. Server подключён
к RPC-сети; профиль браузера и его cookies серверу не передаются.

Runtime требует `JARVIS_JOB_BROWSER_ENABLED=1`, `JARVIS_JOB_BROWSER_OWNER_ID`
и случайный `JARVIS_JOB_BROWSER_TOKEN` длиной 32–256 символов. Приватный профиль
0700 принадлежит uid `pwuser`; owner binding записывается однажды и не допускает
замены UUID. Основное резюме читается из приватного manifest, другое автоматически
не подставляется. Health проверяет процесс RPC, а не вход в HH.

`JARVIS_JOB_BROWSER_PROFILE_VOLUME` указывает на уже существующий volume
ручного входа. До выпуска нужно сопоставить owner UUID с реальным владельцем
Jarvis и выбрать этот volume в закрытом окружении DE. Сессия остаётся на месте.
Compose не создаёт пустую замену существующему профилю.

Sandbox включён; контейнеру оставлена только capability `SYS_CHROOT`.
Проверка с удалением всех capabilities показала, что Chromium не может
создать sandbox. Вариант с `SYS_CHROOT`, `no-new-privileges` и официальным
seccomp прошёл реальные Chromium-проверки. Профиль хранится в
[`deploy/job-browser/seccomp_profile.json`](../deploy/job-browser/seccomp_profile.json)
из указанной выше pinned версии Playwright. WebSocket и все изменяющие
запросы сервиса чтения блокируются, включая запросы popup/frame.

HH не применил проверенные date windows. Сервис задаёт `search_period`, 20
карточек и сортировку по публикации; сборщик проверяет точные даты вакансии.
Несогласованные count/pages, неполная страница, лимит выдачи или неизвестный
DOM дают ошибку с сохранением прогресса, а не успешный checkpoint.

Проверки без Chromium: `node --test job-browser/test/*.test.js` из корня.
Явные Chromium-проверки внутри pinned image:
`node --test test/hhBrowserAcceptance.cjs` и
`node --test test/browserRuntimeAcceptance.cjs`. Второй сценарий требует
свежий tmpfs `/home/pwuser/profile` с uid/gid 1001 и mode 0700; профиль
реального владельца для него запрещён. Fixtures не обращаются к HH.

Единая цепочка Chromium → RPC → collector → PostgreSQL проверяется командой
`npm run test:jobs:browser --prefix server` из корня (нужен отдельный test PG).
В Windows допускается `PLAYWRIGHT_CHANNEL=msedge`; это отдельное свидетельство
интеграции, а pinned Chromium DE проверяется приведёнными выше acceptance.

## Журнал и подготовка отправки — ещё без live submit

`ApplicationLedger` работает на Linux с приватным каталогом 0700 и файлами
0600. Операция, пара owner/vacancy/resume и хеш точного письма публикуются
атомарно после fsync. Конкурентные claims допускают единственный final click.
После unknown перезапуск или новый operation ID не разрешает ещё один клик.
Результаты неизменяемы; чужой owner, подмена пары/письма, symlink, неверные
права и повреждённый файл блокируют действие. Тексты писем не сохраняются.

`prepareApplicationPage` проверяет основное резюме и форму, раскрывает поле,
заполняет точный одобренный текст и проверяет значение повторно. До передачи
к final click блокируются все изменяющие запросы, включая autosave. Модуль
сам кнопку отправки не нажимает. `GuardedSubmission` связывает typed driver
с журналом, закрывает страницу и сверяет исходную операцию при reconcile.

`HhApplicationDriver` подключён через opt-in runtime/RPC. Перед штатным кликом
он повторно читает работодателя, стоп-лист и форму. Разрешён ровно один
native POST с точными vacancy/resume/letter, без изменения видимости по странам,
ответов на тесты или неизвестных полей. Успех требует native topic/chat и
статуса нужного резюме/вакансии. Read-only reconcile проверяет собственный
application bubble и точный текст исходного письма; отсутствие доказательства
оставляет unknown. Живое чтение прошлого отклика HH подтвердило положительную
и отрицательную проверки текста; новой отправки в HH ещё не было.

`test/hhSubmissionAcceptance.cjs` использует явно тестовый endpoint и proof,
проверяет потерю ответа, рестарт, новый ID и read-only reconcile настоящим
Chromium. Он не доказывает совпадение endpoint/proof с HH. Linux unit-журнал
проверяется `node --test test/applicationLedger.test.js` в контейнере без сети;
на Windows эти два теста явно пропускаются, а на DE проходят.

`test/hhApplicationDriverAcceptance.cjs` использует наблюдаемую структуру формы,
native receipt и application chat. Общая HTML-фикстура находится в `test/helpers/`.
Единый серверный `test/jobBrowserApplicationsAcceptance.cjs` дополнительно
проверяет Telegram job handler → PostgreSQL → authenticated RPC → этот driver,
durable intent до POST и рестарт с точным письмом. Воспроизводимый Linux-стенд:

```sh
docker compose -p jarvis-job-apply-acceptance -f deploy/job-browser/compose.acceptance.yml up --build --abort-on-container-exit --exit-code-from acceptance
docker compose -p jarvis-job-apply-acceptance -f deploy/job-browser/compose.acceptance.yml down
```

Он собирает зависимости по lockfiles, использует внутреннюю сеть и tmpfs PG,
не имеет host ports, личного HH volume или production env. Тестовый trust доступ
PostgreSQL ограничен этой одноразовой сетью. Сценарии не отправляют настоящие отклики.
