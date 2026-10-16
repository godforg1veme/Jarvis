# Учёт откликов HH / HH application tracking

16 октября 2026 / 16 October 2026. Реализовано локально, не опубликовано.
Implemented locally, not deployed at the time of this record.

Позднее установлено на DE / Subsequently deployed on DE:
[результат выпуска / release result](2026-10-16-job-application-tracking-release.md).

## Русский

«Поиск работы → Отклики» объединяет собственные операции Jarvis и доступную
историю HH, включая другие резюме. Первый вход ставит импорт в очередь;
обновление запускается кнопкой. Периодических проверок и уведомлений нет.
Карточка разделяет результат отправки и статус работодателя, показывает источник,
известное резюме, надёжную дату отклика либо дату обнаружения. Сохранённое собственное
письмо доступно; старые письма и переписки не скачиваются, AI при импорте не вызывается.

Причина прежнего общего ответа установлена: HH уже содержал отклик, а server
терял специальный результат browser. Теперь подтверждённый существующий отклик
сохраняется и отображается как «На эту вакансию уже есть отклик. Повторный не отправлен.»
Скрытая кнопка не считается доказательством. Неопределённая собственная операция
сохраняет исходный ID и прежнюю проверку точного письма.

Migration 035 добавляет наблюдения, события статусов и устойчивую очередь.
Страницы применяются атомарно, повтор не создаёт дубли, сбой/CAPTCHA сохраняет
контрольную точку. Неполный импорт не удаляет данные и не выдаётся за успешный.
Owner/private scope проверяется до чтения и после browser RPC.

Проверено:

- Server: 649/649; PostgreSQL acceptance: 24/24, включая семь новых сценариев.
- Telegram gate: 65/65; Chromium fixtures: 4/4.
- Browser unit suite: 44 пройдено, четыре прежних Linux-only теста пропущены на Windows.
- Read-only проба готового reader в реальной сессии: 7 активных записей и архив
  из 410 записей на 21 странице; проверены первая, вторая и последняя страницы.
  Полный импорт в production не запускался. Изменения HH блокировались;
  исходные browser/collector контейнеры восстановлены после пробы.

Полная runtime migration проверка с pgvector и пользовательская проверка списка
в Telegram остаются для выпуска. На VPS работает прежний код. После отдельного
поручения нужны GitHub main, синхронизация обоих VPS и установка server/browser
на DE с migration 035. Collector и Desktop пересобирать не требуется.

## English

Job search → Applications merges Jarvis submission operations with available HH
history, including other resumes. First opening queues an import; a button refreshes
it. There are no scheduled account checks or notifications. Detail cards separate
submission results from employer states and show source, known resume and a reliable
application date or discovery date. Known own approved letters remain available;
historical letters and chats are not downloaded, and imports make no AI calls.

The earlier generic reply came from a confirmed existing HH application whose
specific browser outcome was lost by the server. Confirmed existing applications
are now recorded and explained without resubmission. A hidden button is insufficient
proof. Unknown own operations retain their original ID and exact-letter reconciliation.

Migration 035 adds observations, status events and a durable queue. Each page commits
atomically; retries avoid duplicates and failures/CAPTCHA preserve the checkpoint.
Incomplete imports keep existing records and remain explicitly incomplete.
Owner/private scope is checked before reading and after browser RPC.

Verification: server 649/649; PostgreSQL acceptance 24/24 including seven new cases;
Telegram gate 65/65; Chromium fixtures 4/4. Browser units passed 44 tests, with four
existing Linux-only tests skipped on Windows. A read-only real-session probe confirmed
7 active records and an archive of 410 records across 21 pages, checking the first,
second and last archive pages. No full production import ran. HH mutations were
blocked and the original browser/collector containers were restored afterward.

Full runtime migrations with pgvector and user acceptance in Telegram remain for
release. VPS nodes still run the previous code. Publication requires separate owner
authorization, GitHub main and both VPS source synchronization, plus the DE server
and browser rollout with migration 035. Collector and Desktop need no rebuild.

## Ссылки / References

- [Согласованный сценарий / Approved design](../superpowers/specs/2026-10-16-job-application-tracking-design.md)
- [План / Plan](../superpowers/plans/2026-10-16-job-application-tracking.md)
- [Контракт Telegram / Telegram contract](../telegram-menu-contract.md)
- [Проверки / Verification commands](../verification.md)
