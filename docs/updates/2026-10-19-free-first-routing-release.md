# OpenRouter: выпуск бесплатной очереди / Free-first routing release

[Русский](#русский) | [English](#english)

## Русский

19 октября 2026 по поручению владельца выпущена очередь основного текстового
ассистента. Server release `39869218f2cbfb74b170c52e6db0b956637855c2`, каталог
`/home/deploy/releases/jarvis-3986921-free-first`, image
`sha256:61b24945e5e6ebb32f1d3b1cb27847f44a6ab1a61fcecdf4d8ae8645327f7cfe`.
Исходники Windows, GitHub main и обоих VPS синхронизированы. В публикацию вошли
выжимка чата и общие MD-файлы для агентов.

На DE включён `JARVIS_OPENROUTER_FREE_FIRST=true`. Порядок бесплатных:
Nemotron Super → Nemotron Ultra → Gemma 31B → Gemma 26B A4B → Nemotron Super VL →
Dots3-Note → Laguna S 2.1. Далее из двух DeepSeek выбирается наиболее дешёвый
по оценке входа и лимиту выхода. Второй платный ID, `deepseek/deepseek-v4.1-flash`,
добавлен к существующему `deepseek/deepseek-v4-flash-0731`; используется тот же
основной ключ. Явные HH/Vision модели не менялись.

Обновляются доступность, цены и квота из account catalog при использовании
после 15 минут. Список ID не пополняется автоматически. Free-кандидат,
переставший быть бесплатным, пропускается. Согласованный платный ID, ставший
бесплатным, перемещается после семи free-кандидатов. Для free передаётся нулевой
потолок цены; изменение цены между проверками не разрешает платный free-запрос.
При недоступном свежем каталоге генерация не начинается. Полный контракт:
[запись разработки](2026-10-19-free-first-routing-development.md).

Проверено:

- Встроенный Linux image: 756/756 server tests, без пропусков. Локально тот же
  полный набор прошёл; отдельный focused suite — 33/33, включая 14 routing tests.
- Живой запрос из нового image через `createAnswerProvider`: выбран
  `nvidia/nemotron-3-super-120b-a12b:free`, один POST, HTTP 200, ответ `OK`.
  Использовано 26 prompt / 20 completion tokens, usage cost $0. Отдельная
  generation-квитанция по исходному ID подтвердила total cost $0.
  Платная отправка в тестовом probe была дополнительно запрещена.
- Compose/config сверены до запуска. Обнаруженное отсутствие передачи opt-in
  флага исправлено до переключения production. В новом окружении изменены только
  флаг и пара fallback model/key; остальные значения и секреты сохранены.
- Пересоздан только server. Все остальные container IDs сохранены; server
  healthy, restart count 0. Host Agent и VPN на DE/NL активны.
- Публичные live/ready и Mini App — 200, анонимный `/mini/api/me` — 401.
- Сверка установленного кода прошла: server 323 файла, Desktop 143, Host Agent
  по 17 на каждом VPS. Desktop 1.0.2 не требовал пересборки.

Живой probe проверяет новый provider, не отправляет сообщения пользователям
и не меняет историю диалогов. Реальный платный fallback намеренно не вызывался;
он, общая квота, исчезновение и переоценка моделей проверены fixtures.
Автоматический refresh после настоящего 15-минутного интервала и длительная
работа под нагрузкой отдельно не подтверждены. Запрос с доступными инструментами
после отправки не повторяется другой моделью; network unknown также не повторяется.

## English

On October 19, 2026, the main text assistant queue was released with owner
authorization. Server release `39869218f2cbfb74b170c52e6db0b956637855c2`, directory
`/home/deploy/releases/jarvis-3986921-free-first`, image
`sha256:61b24945e5e6ebb32f1d3b1cb27847f44a6ab1a61fcecdf4d8ae8645327f7cfe`.
Windows, GitHub main and both VPS source checkouts are synchronized. The release
also includes the chat handoff and shared agent Markdown files.

DE enables `JARVIS_OPENROUTER_FREE_FIRST=true`. Free priority:
Nemotron Super → Nemotron Ultra → Gemma 31B → Gemma 26B A4B → Nemotron Super VL →
Dots3-Note → Laguna S 2.1. Then the cheapest of two DeepSeek candidates is selected
using estimated input and the output limit. The second paid ID,
`deepseek/deepseek-v4.1-flash`, was added to the existing
`deepseek/deepseek-v4-flash-0731`, using the same primary key. Explicit HH/Vision
models are unchanged.

Availability, prices and quota refresh from the account catalog on use after
15 minutes. New IDs are never automatically added. Free candidates that acquire
a price are skipped. An approved paid ID becoming free moves after the seven
free candidates. Zero price caps protect free requests between refreshes.
Generation does not start without fresh metadata. Full contract:
[development record](2026-10-19-free-first-routing-development.md).

Verified:

- Built Linux image: 756/756 server tests, no skips. The same complete suite
  passed locally; the focused suite passed 33/33, including 14 routing tests.
- A live `createAnswerProvider` probe from the new image selected
  `nvidia/nemotron-3-super-120b-a12b:free`: one POST, HTTP 200, reply `OK`.
  Usage was 26 prompt / 20 completion tokens, with $0 cost. A separate generation
  receipt, reconciled using the original ID, confirmed $0 total cost.
  The probe additionally blocked paid dispatch.
- Compose/config were checked before startup. Missing opt-in forwarding was
  fixed before production switched. Only the flag and fallback model/key pair
  changed in the environment; all other values and secrets were preserved.
- Only the server container was recreated. Other container IDs stayed unchanged;
  the server is healthy with restart count 0. Host Agent/VPN services are active
  on DE/NL.
- Public live/ready and Mini App return 200; anonymous `/mini/api/me` returns 401.
- Installed-code comparison passed: 323 server files, 143 Desktop files and 17
  Host Agent files on each VPS. Desktop 1.0.2 needed no rebuild.

The live probe tests the new provider without messaging users or altering their
conversation history. Real paid fallback was deliberately not triggered; it,
shared quota, model removal and repricing use fixture coverage. Refresh after
an actual 15-minute interval and sustained-load behavior remain unverified.
Tool-capable requests never retry another model after dispatch; unknown network
outcomes also never retry.
