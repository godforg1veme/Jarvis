# HH: замеры CPU и повторное использование резюме

[Русский](#русский) | [English](#english)

## Русский

2 ноября по поручению владельца лимит DE HH browser увеличен с 1 до 2 CPU
через `docker update`, без перезапуска контейнера или сессии. На хосте 6 CPU.
Лимит сохранён в приватных Compose overlays обоих действующих release-каталогов;
в рабочей ветке `codex/hh-throughput` обновлён общий Compose default.
Браузер healthy, restart count 0, OOM не было; память оставлена 1 GiB.
GitHub и исходники VPS этим изменением не обновлялись.

Позже в тот же день владелец поручил проверить 3 CPU. После сравнения лимит
оставлен 3 CPU и сохранён в тех же приватных overlays и локальном Compose default.
Контейнер и сессия сохранены, health healthy, restart count 0, OOM не было.

### Замеры

Одинаковое полное выбранное резюме читалось через штатный owner-bound RPC.
Последовательность: 2 CPU, 1 CPU, снова 2 CPU, по три чтения на серию.
Измерялось полное время RPC, включая ожидание очереди, сеть и разбор страницы.
Содержимое резюме в отчёт и метрики не записывалось, отклики не отправлялись.

| Лимит | Три чтения, секунды | Среднее |
| --- | --- | --- |
| 2 CPU, первая серия | 6,799; 11,923; 11,170 | 9,964 |
| 1 CPU | 19,033; 23,311; 25,304 | 22,549 |
| 2 CPU, повторная серия | 7,179; 7,609; 11,386 | 8,725 |

Среднее всех шести чтений при 2 CPU — 9,344 секунды: в 2,41 раза быстрее,
на 58,6% меньше времени. Это небольшая выборка под текущей нагрузкой;
она не доказывает такое же ускорение полного отклика. Фоновый сбор не выключался.
Браузер после увеличения лимита использовал 157–166% CPU в отдельных пробах.

Дополнительное сравнение 3/2/3 CPU (три чтения на серию):

| Лимит | Три чтения, секунды | Среднее |
| --- | --- | --- |
| 3 CPU, первая серия | 7,656; 9,872; 11,379 | 9,636 |
| 2 CPU, новая контрольная серия | 10,700; 10,991; 10,776 | 10,822 |
| 3 CPU, повторная серия | 7,207; 11,158; 10,866 | 9,744 |

Шесть чтений при 3 CPU в среднем заняли 9,690 секунды: на 10,5% меньше новой
контрольной серии при 2 CPU. Предыдущая средняя при 2 CPU была 9,344 секунды,
поэтому устойчивый выигрыш третьего CPU этой небольшой выборкой не доказан.
Итоговый лимит 3 CPU оставлен по поручению владельца.

Автоматика ещё до изменения CPU получила новую ошибку модели для вакансии
138648254, в 14:28:37 МСК, и перешла в существующий backoff. Поэтому сравнение
общей пропускной способности откликов не состоялось; неизвестный запрос не повторялся.

### Повторное использование резюме

В `JobResumeContextService` подготовлен кэш в памяти на 60 секунд, до 32 снимков.
Ключ включает пользователя, ID резюме, revision подключения и полноту.
Полный снимок подходит для неполного запроса, неполный не заменяет полный.
Одновременные запросы разделяют одно чтение; ошибки не сохраняются.
Каждый вызов проверяет актуальные права и выбранное подключение до использования
снимка и после ожидания. Возвращается копия. Изменение текста резюме прямо на HH
при неизменном подключении может быть видно с задержкой до 60 секунд.

Новый сервис отдельно проверен с настоящим owner-bound чтением, без установки
в работающий процесс: первое обращение 10 576 мс, последующие 5 и 4 мс,
всего один browser RPC. Результат не означает, что кэш уже используется автоматикой.

Проверки: полный серверный набор — 921 passed, 2 PostgreSQL skipped;
отдельно профильный набор с изолированной PostgreSQL — 9/9 passed без пропусков.
Проверены TTL, полнота, копирование, ошибки, параллельные запросы, разделение
пользователей, отзыв доступа и смена подключения во время чтения, лимит записей.
Тестовая БД и закрытая Docker-сеть удалены после проверки.

После этих проверок владелец поручил оставить 3 CPU и установить изменения.
Код кэша выпущен на DE; browser image и Desktop не менялись.
Отбор вакансий, распознавание формы и причина новой ошибки модели в эту задачу
не входят и остаются отдельными незакрытыми вопросами.

### Выпуск

Код `2c8d0dfce324c33271f27a7fadd6a863943a6439` опубликован в GitHub main.
DE server использует `jarvis-hh-throughput-server:2c8d0df` из immutable release
`/home/deploy/releases/jarvis-2c8d0df-hh-throughput`; замена завершена
2 ноября в 14:45:42 МСК. Windows и исходники обоих VPS синхронизированы.

Source/release guard, preflight и CAPTCHA-конфигурация прошли. Все 384 файла
src/shared в образе совпали с опубликованным кодом. Полный набор в новом образе
с публичными исходниками/fixtures: 921 passed, 2 PostgreSQL skipped.
Первый запуск тестов с одним test-каталогом выявил недостающие соседние fixtures;
после добавления полного публичного дерева набор прошёл без ошибок.

Server healthy, restart count 0; внутренние live/ready и публичные curl-smoke
прошли с HTTP 200. Окружение и mounts совпали, inode секрета сохранён,
семь остальных контейнеров не менялись. Browser сохранил профиль и лимит 3 CPU.
Сверка установленного сервера проверила 386 файлов и Compose inputs.
NL получил исходники; Host Agent, VPN и Desktop не менялись. Общая Desktop-сверка
по-прежнему отмечает только отсутствующий неиспользуемый клиентом
`shared/jobQuestionnaire.js`, известный по предыдущему выпуску.

Кэш действует в работающем сервисе для будущих обращений. Ускорение полного
автоматического отклика после установки пока отдельно не измерено.

## English

On November 2, the owner requested increasing the DE HH browser limit from 1 to
2 CPUs. `docker update` applied it without restarting the container or session.
The host has 6 CPUs. The limit is saved in the private Compose overlays of both
active release directories; the shared Compose default is updated locally in
`codex/hh-throughput`. Browser health is healthy, restart count is 0, no OOM
occurred; memory remains 1 GiB. GitHub and VPS source checkouts were not updated.

Later the same day, the owner requested testing 3 CPUs. After the comparison,
the limit remains at 3 CPUs and is saved in the same private overlays and local
Compose default. The container and session were preserved; health is healthy,
restart count is 0, and no OOM occurred.

### Measurements

The same complete selected resume was read through the standard owner-bound RPC.
The sequence was 2 CPUs, 1 CPU, then 2 CPUs again, with three reads per series.
Measurements cover the entire RPC, including queue wait, network and page parsing.
No resume content was written to reports or metrics; no applications were sent.

| Limit | Three reads, seconds | Mean |
| --- | --- | --- |
| 2 CPUs, first series | 6.799; 11.923; 11.170 | 9.964 |
| 1 CPU | 19.033; 23.311; 25.304 | 22.549 |
| 2 CPUs, repeated series | 7.179; 7.609; 11.386 | 8.725 |

The six reads at 2 CPUs averaged 9.344 seconds: 2.41 times faster, taking 58.6%
less time. This small sample under current load does not establish the same
speedup for a complete application. Background collection remained active.
Individual browser CPU samples after the increase reached 157–166%.

Additional 3/2/3 CPU comparison, with three reads per series:

| Limit | Three reads, seconds | Mean |
| --- | --- | --- |
| 3 CPUs, first series | 7.656; 9.872; 11.379 | 9.636 |
| 2 CPUs, new control series | 10.700; 10.991; 10.776 | 10.822 |
| 3 CPUs, repeated series | 7.207; 11.158; 10.866 | 9.744 |

Six reads at 3 CPUs averaged 9.690 seconds, taking 10.5% less time than the new
2-CPU control series. The earlier 2-CPU mean was 9.344 seconds, so this small sample
does not establish a sustained benefit from the third CPU. The final limit
remains at 3 CPUs following the owner's request.

Before the CPU change, automation encountered another model error for vacancy
138648254 at 14:28:37 Moscow time and entered its existing backoff. Consequently,
overall application throughput could not be compared; the unknown request was
not repeated.

### Resume reuse

`JobResumeContextService` now has a locally prepared 60-second in-memory cache
with at most 32 snapshots. Its key includes the user, resume ID, connection
revision and completeness. A complete snapshot can serve a partial request;
a partial snapshot cannot serve a complete request. Concurrent requests share
one read; failures are not cached. Every call verifies current access and the
selected connection before using the snapshot and after waiting. Callers receive
a copy. Changes to resume text directly on HH with an unchanged connection may
take up to 60 seconds to become visible.

A separate probe of the new service used a real owner-bound read without
installing it into the running process: the first call took 10,576 ms, subsequent
calls took 5 and 4 ms, with one browser RPC in total. This does not mean automation
already uses the cache.

Validation: full server suite 921 passed, 2 PostgreSQL checks skipped; the focused
suite separately passed 9/9 with isolated PostgreSQL and no skips. Coverage
includes TTL, completeness, copying, failures, concurrent requests, user isolation,
access revocation and connection changes during a read, and bounded entries.
The test database and internal Docker network were removed after validation.

After these checks, the owner authorized keeping 3 CPUs and deploying the changes.
The cache is now deployed on DE; the browser image and Desktop did not change.
Vacancy selection, form recognition and the cause of the new model error are
outside this task and remain open.

### Deployment

Code `2c8d0dfce324c33271f27a7fadd6a863943a6439` was published to GitHub main.
DE server uses `jarvis-hh-throughput-server:2c8d0df` from immutable release
`/home/deploy/releases/jarvis-2c8d0df-hh-throughput`; cutover completed on
November 2 at 14:45:42 Moscow time. Windows and both VPS source checkouts are synchronized.

Source/release guards, preflight and CAPTCHA configuration passed. All 384
src/shared image files matched published code. The complete suite in the new image
with public source/fixtures passed 921 tests, with two PostgreSQL skips.
The first test attempt mounted only the test directory and exposed missing
neighboring fixtures; the complete public source tree resolved those failures.

Server is healthy with zero restarts; internal live/ready and public curl smoke
checks passed with HTTP 200. Environment and mounts match, the secret inode was
preserved, and seven other containers were retained. The browser retained its
profile and 3-CPU limit. Installed-server verification checked 386 files and
Compose inputs. NL received source only; Host Agent, VPN and Desktop were unchanged.
The broad Desktop check still flags only the missing, unused-by-client
`shared/jobQuestionnaire.js`, known from the previous release.

The running service now uses the cache for future requests. Complete automatic
application throughput after deployment has not been measured separately.
