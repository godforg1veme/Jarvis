# Бесплатный OCR и ограниченная попытка капчи HH

15 октября 2026. Реализовано в локальной ветке `codex/hh-captcha-ocr-review`.
GitHub main и production не обновлялись. Изолированные тестовые контейнеры на DE
не получали рабочий профиль, credentials Jarvis или production PostgreSQL.
Пользователь поручил реализацию после проверки безопасности; поручения на этот
выпуск ещё нет. Настоящий ответ капчи HH не отправлялся.

## Результат

ddddocr не выбран: обе модели не поддерживают полный русский алфавит.
Tesseract rus не распознал полученный образец в 24 вариантах; EasyOCR gen2
приблизился к визуальной расшифровке, но точного совпадения не дал.

Выбрана официальная `PaddlePaddle/cyrillic_PP-OCRv5_mobile_rec_onnx`,
snapshot `2cef88145434beb8afa9dd82d77d799eb1ad7b29`, 8 048 799 байт,
SHA-256 `5371ee1ddaa7983cc62d0818d99e982b6804638c85e4f960d59a574094e172e5`.
Проверены hash, верхнеуровневый ONNX-граф (обычные операции, без внешних tensors),
официальный алфавит PaddleOCR и повторная проверка Defender каталога без обнаружений.
Никакой Python-код моделей не загружался и не исполнялся. Нативные зависимости
закреплены по версиям и wheel hashes; OSV не вернул известных advisories для
шести выбранных версий. Это не полный аудит всех бинарных инструкций и не
гарантия отсутствия неизвестных уязвимостей.

На одном реальном обрезанном изображении после выпрямления дуги получено
19 точных совпадений с визуальной расшифровкой в серии вариантов. Готовый
networkless worker через настоящий Node UNIX-socket client распознал тот же
образец верно за 634 ms. Это проверка одного образца, не независимая оценка
точности и не доказательство принятия ответа HH. Изображение и ответы вне Git.

## Поведение

- Первый признак капчи сохраняет owner-bound incident и назначает повтор
  примерно через две минуты. Progress и checkpoint сохраняются.
- Worker без сети получает только ограниченный PNG, выполняет CPU OCR и
  требует согласия вариантов. Результат — два русских слова; он никогда
  не является промптом, shell-командой или объявленным действием Jarvis.
- Browser разрешает один пустой POST инициализации и один POST ответа
  только для точной формы HH, main frame, backurl и исходных hidden-полей.
  Инициализация и ответ резервируются на диске до отправки. `isBot` не подменяется.
- `route.fetch` явно использует `maxRedirects:0,maxRetries:0`. Ответная
  навигация не переносит POST на другой адрес. Восстановление подтверждается
  отдельным чтением страницы; неизвестный результат после restart не повторяется.
- Неудача создаёт одно фиксированное Telegram attention через существующую
  очередь. Проверки owner/conversation/private chat действуют и при claim.
  Никаких новых кнопок, callback, guided kind, OCR или исключений в сообщении.

Новый worker `job-ocr` имеет отдельный Compose profile `job-captcha-de`.
Флаг `JARVIS_HH_CAPTCHA_RECOVERY` по умолчанию `0`. Доступ к cookies/профилю
остаётся у browser, apply credential и подтверждение письма сохраняются.
Модель OpenRouter и её бюджет не используются для капчи.

## Проверено

- 628 server unit tests; 65 Telegram regression tests.
- 15 PostgreSQL/RPC/runtime acceptance: отдельный networkless pgvector
  контейнер с tmpfs, 33 настоящие миграции, сохранение progress, delay,
  deduplication, owner revocation, чужой chat и доставка фиксированного notice.
- 30 Linux/browser tests: существующие application/privacy/ledger проверки,
  новые протоколы и журнал, реальный Chromium и отдельный локальный HTTPS HH
  fixture. Проверены cookies, 307/308, лишние POST, подмена hidden-полей,
  неизвестный результат и restart. После дополнительного ограничения CSS
  screenshot выполнен отдельный повтор затронутых acceptance.
- 3 worker unit tests и 5 проверок отказов через настоящий UNIX HTTP socket:
  неверный PNG, слишком большой Content-Length, chunked, duplicate length,
  неправильный Content-Type.
- Worker запущен с network none, read-only rootfs, единственным socket volume,
  без профиля/секретов и с memory limit 512 MiB; IPC из read-only browser volume
  работает. Временный worker и его socket volume удалены после проверки.
- Итоговый worker image собран; Compose config с тестовыми переменными подтвердил
  network none, read-only, cap_drop ALL, один socket mount, отсутствие credentials
  и портов, а также выключенный по умолчанию флаг. Проверки ограниченного screenshot
  и ошибки чтения после POST прошли отдельным повтором Chromium/HTTPS acceptance.

## Выпуск и оставшаяся приёмка

Нужно разрешение владельца на GitHub main и обновление VPS по release-workflow.
Для DE изменяются server, collector, browser и добавляется worker. Сначала
проверить запас ресурсов, собрать/проверить worker, затем миграцию и runtime,
сохранить HH profile volume и mounts. Worker должен быть healthy до включения
флага browser. NL получает исходники; Desktop и VPN не требуют обновления.

После выпуска предстоит проверить одну настоящую попытку капчи и возобновление
сбора. При неподдержанном изображении, неуверенном OCR или неизвестном результате
предусмотрен отказ с уведомлением. Успех на одном образце не обещает прохождение
каждой последующей капчи.

Документы: [design](../superpowers/specs/2026-10-15-hh-captcha-recovery-design.md),
[plan](../superpowers/plans/2026-10-15-hh-captcha-recovery.md),
[worker](../../job-ocr/README.md), [первоначальный security review](2026-10-15-hh-captcha-ocr-review.md).
