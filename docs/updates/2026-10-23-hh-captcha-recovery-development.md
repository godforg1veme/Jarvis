# Восстановление HH CAPTCHA / HH CAPTCHA recovery

[Русский](#русский) | [English](#english)

## Русский

23 октября 2026 года. Локальный ремонт согласован владельцем и проверен в ветке
`codex/hh-captcha-recovery`. В GitHub не опубликован, работающий browser на DE
не обновлялся. Desktop и server runtime не менялись.

### Причина и границы вывода

После ручного ответа в 17:29 МСК сохранилась квитанция HTTP 302 на стадии
`response`, без проверки результата. В 17:29:31 browser сообщил unhealthy и
перезапустился. Причина самого unhealthy по этому логу не установлена.
Сервер сохранил unknown, затем запрос обновления картинки; за пять часов было
111 общих ошибок подготовки. Эти коды не позволяли различить загрузку,
форму, картинку и отказ reader.

В отдельном Chromium без личной сессии на DE воспроизведён конкретный дефект
на исходной вакансии: точный target отдаёт HTTP 200 и валидный JobPosting,
но описание находится в скрытом branded static markup HH. Его `innerText`
пуст, хотя текстовые узлы содержат описание. Reader отклонял страницу как
`JOB_HH_DOM_CHANGED`; проверка target оставляла ручную паузу. Сравнение старого
и исправленного reader в одном изолированном контексте дало:

| Проверка | Старый reader | Исправленный reader |
| --- | --- | --- |
| HTTP исходной вакансии | 200 | 200 |
| Проверка target | false, reader_failed | true, verified |
| Отправки ответа CAPTCHA | 0 | 0 |

Это подтверждает дефект и ремонт reader на настоящем HH. Содержимое текущей
личной вкладки не прочитано, поэтому не доказывает единственную причину всех
111 ошибок. Старые 403 OCR и причина перезапуска остаются отдельными вопросами.

### Изменения

Reader сохраняет приоритет видимого описания. Скрытый fallback ограничен
единственным штатным branded блоком, 100000 символами и 20000 узлами обхода;
script/style/template/noscript не входят в текст. Пустое, неоднозначное,
постороннее скрытое и чрезмерное содержимое отклоняется. Лимит проверяется
до накопления дочерних узлов в стеке.

Broker пишет только закрытую причину подготовки: открытие, состояние страницы,
форма, картинка/повтор ключа или проверка target. Ошибки закрытия renderer во
время чтения/ожидания сохраняют категорию недоступной страницы. Публичный RPC
ответ, кнопки Telegram и серверная очередь прежние; server-код не менялся.
Тексты ответов, URL, DOM, cookies, изображения и исключения в логи не добавлены.
Unknown/restart не разрешает повторный ответ; успешное чтение точного target
снимает паузу без POST. OCR budget и durable claims сохраняются.

### Проверки

- Новые Chromium tests сначала воспроизвели дефект на старом reader.
- Linux: полный browser suite и настоящий HTTPS CAPTCHA fixture — 100/100,
  без пропусков, в отдельном контейнере `--network none`, с sandbox и без
  production profile/env/volumes. Проверены unknown/restart, один native POST,
  stale/expiry, crash, точный target и отсутствие повторной отправки.
- Полный server suite — 792/792; обязательный Telegram gate — 66/66.
- Новые проверки защищают hidden branded fallback, неоднозначность, чужой
  адрес, CAPTCHA, HTTP 403, неверный JSON-LD, script/style/template/noscript,
  длинное/широкое дерево, закрытую вкладку и секретность диагностических кодов.
- Независимая ревизия выявила потерю кода при закрытии вкладки и недостаточный
  предел стека; оба участка исправлены и покрыты регрессиями.

### Что осталось

Для устранения живой блокировки нужен согласованный выпуск только job-browser;
оба source checkout VPS обновляются по обычному release workflow. Перезапуск
server/collector и сборка Desktop не требуются. После установки проверить
сохранённый личный refresh request, фактическое снятие паузы/возобновление сбора
и Telegram. Нельзя обещать отсутствие новых CAPTCHA или отказов внешнего HH.
Основное руководство: [browser](../../job-browser/README.md#восстановление-после-captcha).

## English

October 23, 2026. The owner approved the local repair, tested on branch
`codex/hh-captcha-recovery`. It has not been published to GitHub or installed
in the running DE browser. Desktop and server runtime were not changed.

### Cause and limits of the evidence

After the manual answer at 17:29 Moscow time, an HTTP 302 receipt remained at
the `response` stage without result verification. At 17:29:31, the browser
reported unhealthy and restarted. This log does not establish why it became
unhealthy. The server retained unknown, then a picture refresh request; it
reported 111 generic preparation errors over five hours. Those codes did not
distinguish loading, form, picture or reader failures.

A separate Chromium without the personal session reproduced a concrete defect
on the original vacancy on DE: the exact target returns HTTP 200 and valid
JobPosting metadata, but HH keeps its description in hidden branded static
markup. Its `innerText` is empty although its text nodes contain the description.
The reader rejected it as `JOB_HH_DOM_CHANGED`, leaving the manual pause active.
Comparing the old and repaired readers in one isolated context produced:

| Check | Old reader | Repaired reader |
| --- | --- | --- |
| Original vacancy HTTP | 200 | 200 |
| Target verification | false, reader_failed | true, verified |
| CAPTCHA answer submissions | 0 | 0 |

This confirms the reader defect and repair against actual HH. The current
personal tab was not inspected, so this does not prove a single cause for all
111 errors. Earlier OCR 403 responses and the restart cause remain separate.

### Changes

The reader still prefers the visible description. Hidden fallback requires
one standard branded block and is limited to 100000 characters and 20000
traversed nodes; script/style/template/noscript content is excluded. Empty,
ambiguous, unrelated hidden or oversized content is rejected. The limit is
checked before child nodes accumulate in the traversal stack.

The broker logs only closed preparation reasons: opening, page availability,
form, picture/reused key or target verification. Renderer closure during
reading/waiting retains the unavailable-page category. The public RPC response,
Telegram buttons and server queue are unchanged; no server code changed.
Answers, URLs, DOM, cookies, images and exception text were not added to logs.
Unknown/restart does not authorize another answer; successful exact-target
reading releases the pause without POST. OCR budget and durable claims remain.

### Verification

- New Chromium tests first reproduced the defect with the old reader.
- Linux: full browser suite plus the real HTTPS CAPTCHA fixture — 100/100,
  no skips, in a separate sandboxed `--network none` container without the
  production profile, environment or volumes. Covered unknown/restart, one
  native POST, stale/expiry, crash, exact target and no repeated submission.
- Full server suite — 792/792; required Telegram gate — 66/66.
- New checks cover hidden branded fallback, ambiguity, a different target,
  CAPTCHA, HTTP 403, invalid JSON-LD, script/style/template/noscript, long/wide
  trees, unavailable tabs and private diagnostic codes.
- Independent review found lost error classification on tab closure and an
  insufficient stack bound; both were fixed and covered by regressions.

### Remaining work

Resolving the live block requires an approved job-browser-only release;
both VPS source checkouts follow the normal release workflow. Server/collector
restarts and a Desktop build are unnecessary. After installation, verify the
retained personal refresh request, actual pause release/collection and Telegram.
New CAPTCHA challenges or external HH failures cannot be ruled out.
Primary guide: [browser](../../job-browser/README.md#восстановление-после-captcha).
