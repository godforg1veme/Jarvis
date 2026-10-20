# Надёжность Desktop и локальные проверки / Desktop reliability and local checks

## Русский

Согласованный объём: A03, A06 и A07 из оценки 20 октября. Существующие действия, права, подтверждения и визуальная структура сохраняются. Новых production-зависимостей, обновления библиотек, массового рефакторинга и outbox нет.

A03: фиксированный набор безопасных cloud/server unit-проверок запускается одной командой test:core. Runner учитывает failure, нулевой набор и неожиданные skipped; отдельно сообщает о незапущенных PostgreSQL, Linux, browser и live-проверках. Это проверка объявленного набора, а не готовность выпуска.

A06: отдельный небольшой HTTP helper ограничивает полный запрос вместе с чтением body по времени и байтам. Он используется для authenticated HTTP и pairing, не повторяет POST автоматически. Идентификатор исходящего сообщения сохраняется до отправки, связан с сервером и устройством, переживает перезапуск без хранения текста или аудио. Неизвестный результат остаётся доступным для проверки по исходному ID. Новый read-only endpoint использует существующую desktop_requests и текущую проверку пользователя/устройства; он не исполняет действие. Completed возвращает сохранённый безопасный ответ, processing/failed/not-found объясняются без предложения повторить неизвестное действие под новым ID. Создание remote command не получает автоматического retry: неизвестный исход обозначается честно, полноценное изменение его серверной идемпотентности не входит в эту работу.

A07: пустой чат объясняет актуальное состояние подключения; поле сообщения имеет постоянное понятное имя. Существующие стиль, раскладка и маршрутизация действий сохраняются.

Проверки: bounded streaming, медленные headers/body, отмена и очистка ресурсов; запись ID до fetch, сбой записи и перезапуск; чтение статуса без повторного POST; чужие user/device и закрытые ответы; runner failures/zero/skip; состояния и доступное имя в браузере. Обновление установленного EXE и VPS требует отдельного поручения.

## English

Approved scope: A03, A06 and A07. Preserve existing actions, permissions, confirmations and layout. No production dependencies, dependency upgrades, broad refactor or outbox.

A03 adds a fixed safe cloud/server unit manifest with truthful failure, zero-test, skip and excluded-environment reporting. A06 bounds the full Desktop HTTP operation, including body reads and pairing, without automatic POST retries. Persist a server/device-scoped message ID before sending, without storing text or audio, and recover its status through a read-only endpoint backed by existing desktop_requests. Unknown outcomes remain explicit. Command creation is never blindly retried; changing its idempotency contract is outside this scope. A07 updates connection hints and gives the composer a stable accessible name.

Validate streaming limits, deadlines, cancellation, persisted IDs, restart/write failure, status-only recovery, user/device scope, runner negative cases and browser states. VPS publication and Desktop installation require a separate request.
