# Бесплатные модели первыми / Free-first model routing

[Русский](#русский) | [English](#english)

## Русский

Более новый результат: [выпущено и включено на DE](2026-10-19-free-first-routing-release.md). Ниже сохранён локальный этап.

19 октября 2026. Реализовано локально по согласованному порядку; GitHub и VPS
этой правкой ещё не обновлялись. Предыдущие локальные изменения MD для агентов
сохранены. План: [free-first routing](../superpowers/plans/2026-10-18-free-first-routing.md).

Новый режим основного текстового ассистента включается
`JARVIS_OPENROUTER_FREE_FIRST=true`, при `JARVIS_MODEL_PROVIDER=openrouter`.
По умолчанию он выключен. Порядок бесплатных моделей:

1. `nvidia/nemotron-3-super-120b-a12b:free`
2. `nvidia/nemotron-3-ultra-550b-a55b:free`
3. `google/gemma-4-31b-it:free`
4. `google/gemma-4-26b-a4b-it:free`
5. `nvidia/nemotron-3.5-super-vl:free`
6. `dots-studio/dots-3-note-preview:free`
7. `poolside/laguna-s-2.1:free`

Платные кандидаты берутся из `OPENROUTER_MODEL` и
`OPENROUTER_FALLBACK_MODEL`: в согласованном выпуске это DeepSeek 0731 и V4.1 Flash.
Их порядок вычисляется по оценке входа, лимиту выхода и цене за запрос.
Оценка токенов консервативная, по UTF-8 bytes; это не точный токенизатор и не
обещание минимального фактического счёта. Если один из этих согласованных ID
станет бесплатным, он перейдёт после семи free-кандидатов, перед платными.

Все запросы режима используют основной `OPENROUTER_API_KEY`. Старые резервные
аккаунты и Gemini не продолжают эту очередь; при выключенном режиме прежняя
фабрика провайдеров работает как раньше. Явные модели HH/Vision не менялись.
Существующая валидация пар fallback key/model сохраняется.

Каталог `/models/user` и квота `/key` обновляются при первом обращении и затем
по истечении 15 минут при использовании. Фонового опроса в простое нет.
Новые ID не добавляются. Исчезнувшая модель и free-модель с ненулевой/неизвестной
ценой пропускаются; цены платных кандидатов обновляются. Неизвестный контекст,
неподходящие инструменты и неподдержанный tiered pricing исключают кандидата.
Каталог ограничен 8 MiB/10 секундами, refresh объединяется для одновременных
запросов. Если свежий каталог получить нельзя, запрос закрывается без генерации;
после сбоя metadata действует 30-секундная пауза перед новой попыткой.

Для бесплатного кандидата отправляется нулевой `provider.max_price`, для платного —
потолки из проверенного каталога. Prompt/completion limits OpenRouter измеряются
в долларах за миллион токенов, catalog pricing — за токен; перевод проверен тестом.
Смена провайдера внутри запроса отключена. Доступная общая квота 0 сразу
пропускает всю бесплатную очередь. После 429 перечитывается квота и действует
пауза модели не меньше минуты с учётом Retry-After, максимум час.

Обычный текст может перейти дальше после 404/429/502/503/504 в пределах общего
дедлайна. При доступных инструментах после отправки запроса переключение
запрещено. Сетевой неизвестный результат, timeout, auth error и неверный ответ
не повторяются другой моделью. Ошибки не раскрывают ключи или сырые ответы API.

Проверки: 14 новых routing tests; focused suite 33/33; полный server suite
756/756, без пропусков. Проверены порядок, квота, cooldown, исчезновение,
изменение цены, обновление кэша, ограничения размера, неизвестные цены,
units, paid ranking, action no-retry и сохранение ручного режима.
Проверка после добавления защиты от переполнения цены также прошла: 756/756.

В предыдущем ручном live probe через основной ключ Nemotron Super вернул `OK`,
usage cost и отдельная квитанция generation показали $0, расход ключа не изменился.
Gemma вернула 429. Это не живая приёмка нового router: его запросы пока fixture.
Для включения нужен отдельный согласованный выпуск на DE, включение флага,
Linux image tests и обновление исходников обоих VPS. Desktop EXE не меняется.

## English

Newer result: [released and enabled on DE](2026-10-19-free-first-routing-release.md). The local stage is preserved below.

October 19, 2026. Implemented locally in the approved order; this change has not
been published to GitHub or the VPS nodes. Earlier local agent-documentation
changes are preserved. Plan: [free-first routing](../superpowers/plans/2026-10-18-free-first-routing.md).

The main text assistant opts in through `JARVIS_OPENROUTER_FREE_FIRST=true`
with `JARVIS_MODEL_PROVIDER=openrouter`; the default is disabled. Free priority:

1. `nvidia/nemotron-3-super-120b-a12b:free`
2. `nvidia/nemotron-3-ultra-550b-a55b:free`
3. `google/gemma-4-31b-it:free`
4. `google/gemma-4-26b-a4b-it:free`
5. `nvidia/nemotron-3.5-super-vl:free`
6. `dots-studio/dots-3-note-preview:free`
7. `poolside/laguna-s-2.1:free`

Paid candidates come from `OPENROUTER_MODEL` and `OPENROUTER_FALLBACK_MODEL`:
DeepSeek 0731 and V4.1 Flash for the approved rollout. They are ranked using
estimated input size, output limit and per-request price. UTF-8 byte counting
is conservative, not an exact tokenizer or a guarantee of the lowest actual
bill. If an approved paid ID becomes free, it moves after the seven free models,
ahead of paid ones.

All requests in this mode use the primary `OPENROUTER_API_KEY`. Legacy backup
accounts and Gemini do not continue this queue; disabling the mode restores
the existing provider factory. Explicit HH/Vision models are unchanged.
Existing fallback key/model pair validation remains.

The `/models/user` catalog and `/key` quota refresh on first use, then on use
after 15 minutes. There is no idle background poll. New IDs are not added.
Removed models and free candidates with nonzero/unknown prices are skipped;
paid prices refresh. Unknown context, unsuitable tool support and unsupported
tiered pricing exclude a candidate. Catalog reads are bounded to 8 MiB/10 seconds
with single-flight refresh. If fresh metadata cannot be obtained, no generation
is sent; metadata failures apply a 30-second retry backoff.

Free candidates send zero `provider.max_price`; paid candidates send the validated
catalog caps. OpenRouter prompt/completion caps use dollars per million tokens,
while catalog prices are per token; conversion has a regression test. In-request
provider fallback is disabled. A known shared quota of zero skips the whole free
queue. A 429 rereads quota and cools down that model for at least a minute,
respecting Retry-After up to an hour.

Plain text can continue after 404/429/502/503/504 within the shared deadline.
Requests with available tools never switch after dispatch. Unknown network
outcomes, timeouts, authentication errors and invalid responses never retry
another model. Errors expose neither keys nor raw API responses.

Verification: 14 new routing tests; focused suite 33/33; complete server suite
756/756 with no skips. Coverage includes order, quota, cooldown, removal,
repricing, cache refresh, size limits, unknown prices, units, paid ranking,
action no-retry and preserved manual mode. The full suite also passed after
adding numeric-price overflow protection: 756/756.

An earlier manual live probe with the primary key returned `OK` from Nemotron
Super: usage cost and the separate generation receipt showed $0, with unchanged
key spending. Gemma returned 429. This is not live acceptance of the new router;
its requests currently use fixtures. Enabling requires a separately approved DE
release, the opt-in flag, Linux image tests and source updates on both VPS nodes.
Desktop EXE is unchanged.
