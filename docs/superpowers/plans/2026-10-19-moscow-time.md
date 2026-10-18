# Единое московское время: реализация и выпуск

Поручение владельца 19 октября: все пользовательские даты/часы отображать
в МСК UTC+3, исправить пример с 23:46 → 02:46, обновить MD о моделях и времени,
сразу опубликовать в GitHub и на обоих VPS. Установка Desktop отдельно подтверждена владельцем и выполнена.

## Решение

`shared/time.js` задаёт фиксированный `Etc/GMT-3`, форматирование с меткой МСК,
строгий разбор календаря и времени без пояса как +03:00. ISO Z/offset сохраняют
абсолютный момент. PostgreSQL, wire timestamps, expiry, дедупликация и существующие
reminders не сдвигаются. В браузерах зона явная, не зависит от устройства.

## Шаги

- [x] Проверить Telegram menu/message/guided input и все first-party date formatters.
- [x] Исправить parser create/reschedule до consumption: неверная дата сохраняет ввод;
  валидная потребляется один раз с прежними scope/revision/expiry проверками.
- [x] Обновить server Telegram/jobs/Operations, Mini App Life details, Desktop
  Life OS/Vision, file list и доверенное серверное время модели.
- [x] Unit tests в UTC/LA/Tokyo и на границе полуночи, browser Life OS в трёх зонах,
  Operations tests/build, полный server suite.
- [x] Настоящий PostgreSQL: полные migrations, handlers, invalid retry, foreign
  user/chat, single consumption, reschedule и expiry на отдельной БД.
- [x] Сборка Desktop `npm run dist:win`; EXE установлен по отдельному запросу,
  144 файла и native/runtime сверены.
- [x] Git main, source guard на DE/NL, immutable server release с сохранённым env,
  Linux tests, замена только server, health и сравнение container IDs.
- [x] Bilingual MD результата, статус моделей, незакрытые клиентские проверки и
  фактическое состояние установленного Desktop; синхронизация MD обоих VPS.

Результат: [выпуск МСК](../../updates/2026-10-19-moscow-time-release.md).
