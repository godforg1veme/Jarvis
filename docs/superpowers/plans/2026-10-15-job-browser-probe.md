# HH Browser Probe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Inline execution in the current task; no delegated agents.

**Goal:** Проверить чтение HH и наблюдаемые проверки безопасности с DE
настоящим Chromium до интеграции браузерной отправки.

**Architecture:** Изолированный пакет `job-browser`, отдельный временный
контейнер без доступа к Jarvis DB, Telegram и секретам. Нормализованный
отчёт содержит только закрытые признаки страницы, HTTP status и счётчики.
Производственные исходники и работающий Jarvis не обновляются.

**Tech Stack:** CommonJS, Node.js 22+, Playwright 1.64.0 и соответствующий
Chromium, non-root sandbox с официальным seccomp-профилем Playwright.

**Spec:** [Согласованный вариант](../specs/2026-10-15-job-search-without-api-options.md).

**Контрольная точка:** задачи 1–2 выполнены, публичные поиск/вакансия/login
на DE доступны с HTTP 200, sandbox включён. Пять локальных тестов проходят.
Из задачи 4 подготовлены private volume 0700, non-root контейнер, relay,
loopback binding и работающий SSH tunnel; оба `/json/version` отвечают 200.
Ожидается ручной вход владельца. Сам вход, резюме и отклики не проверены.
Результаты находятся в [записи разработки](../../updates/2026-10-15-job-search-development.md).

## Global Constraints

- Ни одного реального отклика, отправки кода входа или изменения аккаунта.
- Нет cookies, headers, HTML, CAPTCHA URL, credentials и текста личного кабинета в отчёте.
- Browser/CDP порты не публикуются; Docker socket, sudo и privileged отсутствуют внутри контейнера.
- CAPTCHA/429/access denied останавливают дальнейшие переходы пробы.
- Поведение неизвестной страницы не объявляется отсутствием защиты.
- Playwright и Chromium одобрены; push, PR и production release не поручены.

### Task 1: Закрытый отчёт и воспроизводимая проба

**Files:** `job-browser/package.json`, `package-lock.json`,
`src/pageSignals.js`, `src/probe.js`, `test/pageSignals.test.js`, `Dockerfile`.

**Interfaces:** `classifyPage({ status, pathname, text, iframeSources, scriptSources, vacancyLinks })`
возвращает `{ state, challenges, vacancyLinks }`. `probe()` посещает фиксированные
HH search/login адреса, печатает только классификацию и закрытый failure code.

- [x] Написать тест, что CAPTCHA/429/block/login определяются до обычного
  содержимого, неизвестная страница остаётся unknown, payload не копируется.

```js
assert.deepEqual(classifyPage({ status: 429, text: 'private fixture' }),
  { state: 'rate_limited', challenges: [], vacancyLinks: 0 });
assert.ok(!JSON.stringify(classifyPage({ status: 403, text: 'private fixture' })).includes('private fixture'));
```

- [x] Запустить `node --test job-browser/test/*.test.js`, увидеть ожидаемый
  отказ из-за отсутствующего модуля. Реализовать закрытые состояния:
  `captcha`, `rate_limited`, `access_denied`, `login_required`, `search`, `unknown`.
- [x] Собирать только видимые признаки: текст body с лимитом, домены iframe/script,
  canonical vacancy links. Не сохранять response bodies, storage state и screenshots.
- [x] Ограничить максимум тремя навигациями, 30 секунд на навигацию,
  прекратить при защите. Не подменять fingerprint и не включать stealth.
- [x] Добавить pinned Playwright, lockfile и Dockerfile с непривилегированным
  пользователем и `chromiumSandbox: true`. Проверить реальный lock через npm.
- [x] Прогнать тесты и проверить diff, сохранить локальный этап.

### Task 2: Настоящий Chromium на DE

**Files:** `job-browser/README.md`; временные артефакты вне production source.

- [x] Передать только пакет пробы в отдельный `/home/deploy/job-browser-probe-20261015`.
  Source checkouts не являются staging/release пробы и не изменяются.
- [x] Скачать официальный pinned seccomp профиль, проверить JSON, сохранить
  источник и SHA256. Собрать отдельный образ из официального Playwright image.
- [x] Запустить `docker run --rm --init --user pwuser --memory=1g --cpus=1
  --pids-limit=256 --shm-size=256m --security-opt seccomp=<profile> <probe-image>`.
  Без ports, host network, Jarvis mounts и окружения приложения.
- [x] При отказе sandbox исследовать причину, не переходить на root,
  privileged, host IPC или `--no-sandbox` ради успешной пробы.
- [x] Записать фактическую классификацию HH и пределы вывода, проверить
  healthy-состояние Jarvis после пробы; не называть это авторизованным E2E.

### Task 3: Контрольная точка и продолжение

**Files:** `docs/updates/2026-10-15-job-search-development.md`,
`docs/README.md`, основной план поиска и инструкция подключения.

- [ ] При доступной выдаче получить ссылки и одну полную вакансию, затем
  перейти к проектированию защищённого интерактивного входа владельца.
- [ ] При CAPTCHA/другой проверке сообщить точный наблюдаемый тип и спросить
  владельца о его способе участия; не угадывать провайдера по одному статусу.
- [ ] Отдельно перечислить ещё не проверенные: авторизация, резюме, форма,
  доказательство отправки, original-ID reconciliation и browser E2E.
- [ ] Сохранить собственные изменения локально. Ни одна fixture или публичная
  проба не разрешает реальный отклик и не означает полный выпуск функции.

### Task 4: Защищённый вход владельца после успешной публичной пробы

**Files:** `job-browser/src/ownerLogin.js`, `job-browser/src/loopbackRelay.js`,
`job-browser/test/loopbackRelay.test.js`, `job-browser/README.md`.

**Interfaces:** `createLoopbackRelay({ port, targetPort, bind })` возвращает
  Node TCP server; target всегда 127.0.0.1, единственный фиксированный CDP port.
  `ownerLogin()` запускается с явным opt-in, приватным Docker volume и TTL 30 мин.

- [ ] Проверить relay на loopback fixture: передача данных, закрытие при
  disconnect и отклонение неверных портов. Без подключения к HH.
- [ ] Сохранить профиль только в `/home/pwuser/profile` с mode 0700.
  Запустить persistent Chromium с sandbox, CDP внутри контейнера, без печати
  browser WebSocket URL и текстов страниц. В stdout только ready/closed/failure code.
- [ ] Пробросить CDP через контейнерный relay и единственный host binding
  `127.0.0.1:19222`; отдельная Docker network, без Jarvis DB/secrets и host mounts.
  Владельцу доступен только SSH-forward на Windows localhost. Нет публичного
  login endpoint, clipboard automation и передачи паролей через Telegram.
- [ ] Проверить binding через Docker metadata, TTL, отсутствие root/privileged,
  работу `/json/version` (только HTTP status) и healthy Jarvis. Никаких cookies
  и browser state в диагностике. Проверить owner UI через Chrome/Edge inspect.
- [ ] Предоставить владельцу готовый вход: открыть `edge://inspect/#devices`,
  Configure → `localhost:19222` → inspect → screencast. Владелец сам вводит
  номер/почту и код в видимой странице HH. До его ответа не читать личный кабинет.
