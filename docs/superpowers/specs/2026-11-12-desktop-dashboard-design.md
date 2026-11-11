# Тестовый Jarvis Desktop / Test Jarvis Desktop

## Русский

Пользователь согласовал графитовый макет 12 ноября: навигация слева,
большая рабочая область, планеты справа, анимированный звёздный фон.
Остаются JARVIS и названия действий. Убираются подписи «Личное пространство»,
«Общий диалог», «Данные синхронизированы», пояснение про контроль камеры
и микрофона, постоянная нижняя строка состояния. Ошибки, запросы разрешений
и подтверждения показываются по необходимости; состояние активного захвата
должно оставаться заметным.

Разделы: Главная, Ассистент, Life OS, Память, Документы, Поиск работы,
Устройства, Панель управления, Настройки. VPN остаётся доступным в личных
сервисах. Голос, зрение и визуальная память сохраняют действующую реализацию.
Настройки открывают действующие локальные настройки голоса и подключения.
Life OS сохраняет проекты, Timeline, людей, предпочтения и подтверждения.

Общие личные данные читаются и меняются на сервере того же пользователя,
без независимого Desktop-хранилища памяти, документов или HH.
Каждое чтение проверяет действующее право; отозванный device token закрывает
доступ. Загрузка раздела, возврат фокуса и обновление получают свежие данные;
неудачный запрос явно показывает ошибку. Запоздалые ответы чужого экрана
или старого подключения не заменяют актуальный экран.

Desktop сохраняет свой канал диалога и выполнение локальных команд.
История Mini App доступна отдельно; сообщения и подтверждения разных каналов
не сливаются и не получают полномочий другого клиента. Предыдущая история
Desktop загружается с сервера, текущие сообщения и восстановление неизвестных
результатов продолжают использовать исходные идентификаторы.

Для новых разделов расширяется закрытый IPC и device-authenticated API.
Общие personal/memory services используют явный серверный адаптер проверки
активного устройства внутри транзакции; Mini App сохраняет cookie/CSRF.
Telegram-вход, гостевые HH cookies и административные сессии не копируются
в Electron. Панель управления открывается обычным отдельным входом владельца.
HH использует действующие персональные сервисы и согласие; новые входы и VPN
продолжают предусмотренный переход в Telegram. Неизвестные операции проверяются
по исходному UUID, без автоматической повторной записи.

Тестовый EXE собирается локально, без push, публикации и изменения VPS.
Новые серверные пути проверяются на изолированном тестовом сервере; на прежнем
production API новый раздел показывает понятную недоступность. Для настоящей
проверки этих разделов на VPS потребуется отдельный согласованный выпуск.
Сборка не означает установку поверх используемого приложения.

Приёмка: независимый агент проверяет каждый пункт меню, загрузку и ошибки,
клавиатуру, отмену диалогов, узкое/широкое окно, stale responses, запреты доступа,
подтверждения, идемпотентность, сохранность голоса/зрения/Life OS. Браузерные
fixtures дополняются запуском настоящего Electron и проверкой упакованных файлов.
Реальное включение микрофона/камеры и отправка HH откликов не являются тестовыми
действиями без отдельного явного поручения.

## English

The user approved the graphite concept on November 12: left navigation, a large
workspace, planets on the right and an animated starfield. Keep the JARVIS brand
and action labels. Remove decorative explanatory copy and the permanent footer.
Show errors and confirmations when needed; active capture remains visible.

Sections are Home, Assistant, Life OS, Memory, Documents, Job Search, Devices,
Operations and Settings, with VPN available among personal services. Preserve
existing voice, vision, visual memory and all Life OS workflows.

Personal data comes from the same user's server records. Every request checks
current permissions and active device credentials. Refresh on section entry,
window focus and explicit refresh. Reject stale responses from previous sections
or connections. Desktop and Mini App conversations remain separate; Mini App
history is available separately without importing action authority or merging
confirmation channels. Desktop history and recovery keep their existing IDs.

Extend the closed IPC and authenticated device API. Reuse personal and memory
services with an explicit server-side transactional device authorizer while
retaining Mini App cookie/CSRF checks. Do not copy Telegram, HH guest or Operations
sessions into Electron. Keep existing Telegram handoffs for HH sign-in and VPN.
Inspect unknown results by their original UUID without blind replay.

Build a local test EXE without publishing or changing VPS state. Validate new API
paths on an isolated server. Existing production returns an honest unavailable
state until a separately authorized server release. Building does not install.

Independent acceptance covers every menu item, errors, keyboard, cancellation,
window sizes, stale responses, access revocation, confirmations, idempotency and
voice/vision/Life OS regressions. Include a real Electron launch and package
inspection. Do not activate capture or send live job applications for testing.
