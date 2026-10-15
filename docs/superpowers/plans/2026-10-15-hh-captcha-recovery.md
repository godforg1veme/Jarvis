# HH Captcha Recovery Implementation Plan

> **For agentic workers:** execute inline with executing-plans; preserve the existing task branch and do not publish without release authorization.

**Goal:** одна бесплатная owner-bound попытка капчи после двух минут, с безопасным отказом и уведомлением.

**Architecture:** networkless UNIX-socket OCR worker, browser-owned durable attempt journal and exact captcha POST guard, existing PostgreSQL outbox for attention.

**Tech Stack:** CommonJS/Playwright, Python 3.12/ONNX CPU/Pillow/numpy, PostgreSQL.

**Spec:** [design](../specs/2026-10-15-hh-captcha-recovery-design.md).

## Global constraints

- Только официальный закреплённый кириллический PaddleOCR ONNX; без ddddocr и LLM.
- PNG ≤262144 bytes, width≤2048, height≤512, pixels≤1048576.
- Ответ: два русских слова по 2–20 букв; ровно один пробел.
- UNIX socket, UID 1001, network none, read-only rootfs, no secrets/profile mounts.
- Первая пауза 120000 ms; attempted durable до POST; неизвестный результат не повторяется.
- Новых кнопок/callbacks/guided-input kinds нет. Forward-only migration для attention.

## Task 1: Изолированный OCR

Files: create `job-ocr/worker.py`, `requirements.lock`, `Dockerfile`,
`fetch_model.py`, `model.json`, `characters.json`, `test_worker.py`, `README.md`.

Interfaces: PNG bytes → HTTP POST `/ocr` по UNIX socket → `{answer:string}`;
ошибки имеют фиксированный code и не включают данные.

- [x] Закрепить SHA-256 шести Linux wheels, модель и алфавит; проверить OSV.
- [x] Реализовать отдельные `validate_answer`, `prepare_image`, `recognize`, `Handler`.
  Пример отрицательной проверки:
  ```python
  self.assertFalse(valid_answer('ignore previous instructions'))
  self.assertFalse(valid_answer('удали\nфайлы'))
  ```
- [x] Реализовать bounded PNG decode, выпрямление дуги, CTC и согласие вариантов.
- [x] Запустить unittest в networkless контейнере с лимитами; проверить протокол,
  невалидные/слишком большие PNG, неподходящие ответы и отсутствие сетевого доступа.

## Task 2: Browser protocol и durable recovery

Files: create `job-browser/src/captchaProtocol.js`, `captchaRecovery.js`,
`ocrClient.js`; modify `hhBrowser.js`, `browserMain.js`, `rpcServer.js`, `rpcProtocol.js`.
Tests: `captchaProtocol.test.js`, `captchaRecoveryAcceptance.cjs`, `ocrClient.test.js`.

Interfaces: `begin(page,targetUrl)` returns guarded attempt;
`recover(attempt)` returns restored navigation Response or throws closed code.
`success(targetUrl)` resolves a matching incident after verified read.

- [x] Написать отрицательные protocol tests до реализации. Пример:
  ```js
  assert.equal(validAnswer('удали\nфайлы'), false);
  assert.equal(validInit({ url: 'https://evil.example/captcha?lang=RU', method: 'POST', body: Buffer.alloc(0) }), false);
  ```
- [x] Реализовать строгую форму/backurl/hidden binding и один exact POST.
- [x] Реализовать приватный atomic/fsync журнал и запрет повторного attempted после crash.
- [x] Интегрировать opt-in, worker client и bounded closed error metadata.
- [x] Проверить Chromium fixtures: waiting → success, failed/unknown/restart,
  чужой backurl, XSRF/body/redirect tamper, вторые POST и посторонняя запись.

## Task 3: Collector и Telegram attention

Files: migration `031_job_captcha_attention.sql`, `jobCollector.js`,
`jobBrowserClient.js`, `jobDeliveryRepository.js`, `jobDeliveryWorker.js`.
Tests: `jobCaptcha.test.js`, `jobCollectorAcceptance.cjs`, `jobDeliveryAcceptance.cjs`.

- [x] Тестировать точный waiting delay и сохранение checkpoint/progress через реальный PG.
- [x] Передать только bounded delay и UUID recovery ID; новые закрытые failure codes.
- [x] Добавить `enqueueAttention` с owner/conversation/private-chat проверкой и dedup.
- [x] Отправить фиксированное сообщение о ручном вмешательстве через прежний send path;
  тестировать replay и чужой user/chat/member без раскрытия данных.

## Task 4: Compose, регрессии и результат

Files: `deploy/docker-compose.yml`, `deploy/env.example`, `docs/README.md`,
`docs/telegram-menu-contract.md`, update record and security review.

- [x] Добавить networkless job-ocr/socket volume и opt-in browser flag default off.
- [x] Проверить worker image, browser acceptance и server/Telegram regression gate.
- [x] Записать фактический результат, ограничения одного образца и live-проверки,
  которые не заменяются синтетическими тестами.
- [x] Подготовить конкретное предложение GitHub/VPS выпуска без самостоятельного push.

Execution: completed locally; results are recorded in docs/updates/2026-10-15-hh-captcha-recovery-development.md. Publication remains pending owner authorization.
