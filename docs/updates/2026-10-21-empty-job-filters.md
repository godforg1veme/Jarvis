# Пустые фильтры и ввод списком / Empty job filters and multiline input

[Русский](#русский) | [English](#english)

## Русский

По поручению владельца новые профили поиска начинают с пустых запросов и
исключений, без зарплаты, города и ограничения формата работы. Удалены скрытые
правила, которые пропускали только AI-профессии и исключали продажи. Сохранённые
настройки остальных пользователей автоматически не сбрасываются.

В Telegram: «Поиск работы → Настройки → Поисковые запросы → Добавить».
Можно отправить несколько фраз одним сообщением, каждую с новой строки:

```text
Менеджер по закупкам
Снабжение
Логистика
```

Каждая строка — отдельный запрос HH. Пустые строки пропускаются, точные повторы
не добавляются. Запросы — до 100 фраз по 2–200 символов, исключения — до 50 фраз
по 1–100 символов. Если строка неверна или список переполнен, ничего не сохраняется,
ввод остаётся доступным для исправления. Бот показывает весь добавляемый список
перед одним подтверждением. Есть очистка списка и снятие отдельных ограничений.
Удаление последнего запроса выключает поиск. Без запросов включение и сбор
запрещены; новые запросы начинают свой период поиска с новым checkpoint.
Интервал, глубина первоначальной выдачи и уведомление о расходах остаются
рабочими настройками, а не подставленными предпочтениями профессии.

Сохраняются действующее право jobs, private chat, числовая Telegram-личность,
revision, expiry и однократное потребление ввода/подтверждения. Новых callback
форм и guided kinds нет. Адресная очистка Сени выполняется только после
проверки его UUID и Telegram ID; факты, сопроводительные, резюме и история откликов
не удаляются. Старые ожидающие карточки его поиска снимаются с доставки.

Локально прошли 785 server unit, 66 Telegram gate и 10 PostgreSQL acceptance.
ПК: Edge fixture с настоящими Telegram message/menu handlers и отдельной БД
прошёл ввод несколькими строками, предпросмотр, сохранение, удаление повторов
и очистку. Это локальная проверка, а не настоящее нажатие из клиента Telegram.
Независимая проверка прав не нашла блокирующих замечаний; найденная возможность
сохранить пустой активный поиск закрыта также в repository и старом редакторе.
Фактический результат установки и очистки будет записан после выпуска.

## English

At the owner's request, new job-search profiles start with empty queries and
exclusions, no salary or city preference, and no work-format restriction.
Implicit AI-only and sales-exclusion rules were removed. Other users' saved
settings are not reset automatically.

In Telegram, open “Job search → Settings → Search queries → Add”. Send multiple
phrases in one message, with one phrase per line, as in the example above.
Each line is a separate HH search. Blank lines are skipped and exact duplicates
are omitted. Queries allow up to 100 phrases of 2–200 characters; exclusions
allow up to 50 phrases of 1–100 characters. An invalid line or an overfull list
saves nothing and leaves input available for correction. The bot previews the
entire addition before one confirmation. Lists can be cleared and individual
restrictions removed. Removing the last query disables search. Empty queries
cannot activate or run collection; changed queries reset their checkpoint.
Polling interval, initial lookback and spending notification remain operational
settings, rather than prefilled job preferences.

Current jobs permission, private chat, numeric Telegram identity, revision,
expiry and single consumption remain enforced. No new callback syntax or guided
kinds were added. The targeted Senya reset requires both his UUID and Telegram
ID; facts, cover letters, resume and application history are retained. His old
queued vacancy cards are removed from pending delivery.

Local verification passed 785 server unit tests, 66 Telegram gate checks and
10 PostgreSQL acceptance tests. On PC, an Edge fixture using real Telegram
message/menu handlers and an isolated database passed multiline input, preview,
save, deduplication and clear. This is local verification, not a real Telegram
client tap-through. Independent permission review found no blockers; the
reported ability to save an active empty search was also closed in the
repository and legacy editor. Installation and reset results will be recorded
after deployment.
