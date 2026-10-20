# Надёжность Desktop, локальная разработка / Desktop reliability, local development

## Русский

20 октября 2026. Реализованы A03, A06 и A07 из оставшихся предложений аудита.
Изменения локальные, в ветке `codex/desktop-reliability`. Push, VPS, сборка и
установка EXE не выполнялись. Новых production-зависимостей и migrations нет.

`npm run test:core` запускает явный состав из `scripts/coreTestManifest.json`.
Он отклоняет падение, нулевой набор, skipped/todo и отдельно перечисляет
незапущенные окружения. Проверки доступны по [verification](../verification.md).

HTTP Desktop, включая pairing, имеет общий deadline 120 секунд, потоковый лимит
обычного JSON 2 МиБ и отмену чтения. Для Visual Memory сохранён существующий
допустимый размер кадра с отдельным ограниченным бюджетом base64-ответа.
Запись ID text/voice предшествует POST. Локальный файл содержит только ID, тип,
время и scope сервера/устройства, переживает перезапуск и удаляется после показа
ответа. При сбое записи отправка блокируется, а существующие ID сохраняются.

Ручная кнопка проверяет результат по прежнему ID и не отправляет действие снова.
GET использует существующую таблицу desktop_requests, актуальные права и привязку
пользователя/устройства. Ошибка чтения оставляет отправку доступной для проверки.
Смена привязки отсекает запоздавшие результаты. Существующие подтверждения
восстановленного ответа сохраняют конкретный command ID и серверные проверки.
Пустой чат объясняет актуальное подключение, поле сообщения имеет постоянное имя.

| Проверка | Результат |
| --- | --- |
| test:core, runner | 5/5 |
| test:core, cloud/Desktop | 102/102 |
| test:core, server unit | 778/778 |
| Браузерные fixtures | 1440×900 и 760×560; доступное имя, состояния, ack/recovery, без повторного POST, переполнения и page errors |
| Desktop IPC boundary и package assets | Пройдены |
| git diff --check | Пройден |

Пропусков в core нет. Регрессии проверяют зависшие headers/body, переполнение,
поздний ответ после timeout, отмену, перезапуск между HTTP и показом, сбои записи,
устаревшие списки и смену scope, чужое устройство, отзыв прав, отсутствие артефактов
и закрытых полей. Браузерные скриншоты находятся в игнорируемом build.

Ограничения:

- PostgreSQL, Linux, живой Electron, голос с микрофона и обрыв настоящей сети
  в этой задаче не проверялись. SQL и маршруты проверены fixture-тестами.
- Обновить нужно server и Desktop вместе. Установленные файлы Desktop отличаются
  от локальной разработки; два новых client-модуля в установленной копии отсутствуют.
  Публикация и `npm run dist:win` с установкой требуют поручения владельца.
- Completed не восстанавливает одноразовый VPN-файл из потерянного ответа.
  Интерфейс прямо сообщает об этом; credentials не сохраняются в request log.
- Processing/failed/not_found не разрешают повтор действия. Создание отдельной
  remote command пока не имеет caller ID для восстановления потерянного ответа;
  ошибка обозначает неопределённость, автоматического retry нет.
- Для cached response используется консервативный снимок доступных прав источников
  при начале запроса, включая возможные данные из истории. Старые записи без
  снимка требуют всех прав источников. Полный учёт происхождения старой истории
  не добавлялся: отзыв права до нового запроса сам по себе не удаляет прежний
  текст из истории, передаваемой модели. Это существующее ограничение истории.

Обновление зависимостей, locks неиспользуемых Python-сред, общий outbox и массовое
разделение модулей оставлены за пределами этого этапа. Обязанность HTTP helper и
локального request store выделена небольшими модулями без смены маршрутизации.

## English

October 20, 2026. A03, A06 and A07 are implemented locally on
`codex/desktop-reliability`. No push, deployment, EXE build or installation was
performed. No production dependencies or database migrations were added.

`test:core` uses an explicit manifest and rejects failed, empty, skipped or todo
required suites. It passed 5 runner, 102 cloud/Desktop and 778 server unit tests
with no skips. Browser fixtures passed at 1440×900 and the minimum Desktop size
760×560, covering accessible names, connection states, recovery, ack failure,
no repeated POST, overflow and page errors. IPC boundary, package assets and
diff whitespace checks passed.

Desktop HTTP, including pairing, has a full 120-second deadline, streaming body
limits and cancellation. Ordinary JSON is limited to 2 MiB; Visual Memory has a
separate bounded allowance preserving its existing 8 MiB image contract in base64.
Text/voice IDs are persisted before POST, scoped to server/device, without text,
audio or response bodies. IDs survive restart and are removed after renderer
display acknowledgement. Write failure blocks new sends and preserves evidence.
Read-only status recovery uses the existing desktop_requests table, current
permissions and user/device scope. It never repeats the action. Delayed results
from an old scope and stale lists are ignored. Existing command confirmation IDs
and checks are preserved. Connection hints and the composer name are corrected.

Real PostgreSQL, Linux, Electron, microphone and network-loss acceptance were not
run. SQL/routes use fixtures. Server and Desktop must be updated together; the
installed EXE still contains the previous code. Publication and installation
require the owner's request. One-time VPN files cannot be recovered from a lost
response; the UI states this explicitly and credentials are not stored in the
request log. Processing/failed/not_found do not authorize repeating actions.
Standalone command creation still lacks caller-ID recovery; uncertainty is
reported and no automatic retry is introduced.

Cached results conservatively retain source permissions available when a request
started, including possible history-derived data. Legacy records require all
source permissions. Full provenance of old conversation history remains outside
this change: revoking access before a new request does not erase old text already
present in model history. Dependency upgrades, inactive Python locks, a general
outbox and broad module refactoring were deferred.
