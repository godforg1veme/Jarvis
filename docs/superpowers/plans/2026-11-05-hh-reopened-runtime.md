# Reopened HH runtime investigation

**Goal:** закрыть повторные отказы HH и heap OOM после выпуска 168d823.
**Authorization:** владелец поручил ремонт, GitHub/VPS/MD и длительную проверку;
неопределённые исходные операции не переотправляются. Автопоиск сейчас off.
**Evidence:** VK 138448900 получил неизвестный non-2xx результат; исходный
HTTP status/category не сохранён. Шесть GET-проверок и дополнительная ручная
сверка не доказали sent. CRM 138563100 остановлен до application по трём
вопросам; модель выбрала manual. После предыдущего окна ещё 4 V8 heap OOM,
при этом WebSocketRoute=0: прежний page-scoped ремонт не закрыл всю проблему.

- [x] Аудит источников/веток/PR; scope-bound чтение исходных операций.
- [x] Исключить повтор POST, сохранить неизвестный результат исходного ID.
- [x] Разделить HTTP redirect/auth/forbidden/rate/server/client и bounded
  XSRF/origin/CAPTCHA причины без raw body/Location.
- [x] Добавить закрытые server-side cache/dispatcher/progress и V8 counters;
  положительно проверить удержанный/освобождённый APIResponse.
- [x] Проверить candidate в Linux/runtime и независимой ревизией.
- [x] Установить диагностический candidate с сохранением off/профиля/ledger:
  58f39f7 на DE, оба VPS source синхронизированы; env/mounts/hash verified.
- [x] Установить конкретный второй источник retained heap; исправить и
  воспроизвести до/после с реальной характерной нагрузкой.
- [ ] Устранить подтверждённую причину отказа HH с сохранением single-send.
- [x] Проверить более длительное окно и post-GC retained heap, не объявлять
  успех только по 30 минутам без crash.
- [ ] Обновить русский/английский результат и синхронизировать выпуск.

6 ноября: browser f543cc4, server/collector 93eed34 установлены. Linux soak
60 минут, 8919 cycles, routes0, heap44→44MiB; 146 browser/16 native/3 runtime,
server943 +2DB skip. Живой отклик заблокирован настоящей CAPTCHA: предыдущий
POST403, cookie/token match, statehuman; не повторялся. Pre-model CAPTCHA
ошибка теперь pending+15min backoff; живой тест подтвердил0LLM/0apps и off24.
Результат: docs/updates/2026-11-06-hh-page-cleanup.md. Полное закрытие исходного
HH отказа не заявлено; требуется человек и новый живой тест после подтверждения.

## Route lifecycle repair under verification

Linux baseline: 100 страниц с 30 delayed GET каждая, обычный close оставил
1524 server routes (client objects=16, post-GC heap=60 MiB). Public cleanup
останавливает оставшиеся ресурсы через window.stop перед close, с отдельным
deadline и закрытым failure code; контекстный security guard сохраняется.
Применять только после результата операции. Для reconciliation подтверждение
должно попасть в ledger до escalation cleanup failure. Регрессионный тест
по умолчанию проверяет helper и нулевое удержание; baseline включается явно.

Fresh read-only VK probe: visible applied action=false, application reference
invalid. Это не доказательство отсутствия старой отправки и не разрешает POST.
