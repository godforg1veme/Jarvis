# Mini App: списки, карточки и история

[Русский](#русский) | [English](#english)

## Русский

26 октября локально выполнен этап 4
[плана](../superpowers/plans/2026-10-26-mini-app-button-reliability.md), после
[переходов к меню бота](2026-10-26-mini-app-handoffs-development.md).
Ветка `codex/mini-app-button-reliability` не опубликована; VPS и Desktop не менялись.

Память, документы, устройства и Life OS получили обновление и загрузку следующих
записей. Поиск сохраняется после догрузки и обновления и явно ограничен
загруженными записями. Карточки раскрывают полное название/текст памяти и
доступные сведения о состоянии. Это не просмотр тела и не скачивание документа.
Пустой список отличается от раздела, не подключённого на сервере.

Страницы содержат до 30 записей; текущая миссия Life OS показывается дополнительно
на первой странице. Ближайшие сроки договорённостей сохраняют приоритет, записи
без срока идут далее. Неактивная память, удалённые документы и отозванные
устройства не возвращаются. Обновление начинает просмотр заново; новые записи
не сдвигают уже начатый проход. Ошибка догрузки сохраняет показанный список.
Повторное нажатие не создаёт параллельную догрузку, а запоздавшая страница не
перезаписывает результат обновления или другого раздела.

История диалога Mini App явно отделена от Telegram. Предыдущие сообщения
догружаются перед текущими; ошибка чтения сохраняет историю и черновик.
Механизм сверки неизвестного сообщения по исходному UUID остаётся прежним.

Сервер использует read-only `SectionReader`, явно подключённый в runtime.
Непрозрачный указатель страницы связан с пользователем, разделом и разговором,
живёт 10 минут и хранится только в ограниченной памяти процесса. После истечения,
перезапуска или вытеснения нужно обновить список. Каждая страница повторно
проверяет текущие права. Указатель содержит только серверные SQL-якоря; тела
документов, storage keys и credentials в нём не хранятся.

Миграция 050 добавляет индексы для такого чтения. На новой отдельной локальной
PostgreSQL 16.13 с настоящим pgvector прошёл полный pipeline: 52 файла по миграцию 050.
Проверки нового набора прошли: **7/7**; вместе с прежними Mini App PostgreSQL
наборами проверяется **20** сценариев. Они охватывают 65 записей каждого раздела,
одинаковые точные timestamps, чужие/просроченные указатели, старую историю,
отзыв права, добавление и скрытие записей и порядок договорённостей.
Полный server suite: **874/874**, без пропусков. Сборка и восемь браузерных
наборов прошли, включая новый сценарий списков на 390/1280 px; последние
изменения оформления карточек отдельно перепроверены этим набором.

Этап проверен главным агентом. Независимая ревизия недоступна: оба помощника
остановились по лимиту аккаунта до реализации своих частей. Настоящие Telegram
WebView, телефон и owner/member приёмка остаются для разрешённого выпуска.
Для установки всей ветки нужны миграции 049 и 050. Далее остаются пользовательские
действия через общие серверные сервисы и ручная сверка HH unknown без повторного
исполнения неопределённой операции.

## English

On October 26, stage 4 of the
[plan](../superpowers/plans/2026-10-26-mini-app-button-reliability.md) was completed
locally, following [bot-menu handoffs](2026-10-26-mini-app-handoffs-development.md).
The `codex/mini-app-button-reliability` branch is unpublished; VPS and Desktop
installations are unchanged.

Memory, documents, devices and Life OS now offer refresh and loading additional
records. Filtering survives both actions and explicitly covers loaded records.
Cards expand to show the full title/memory text and available status information.
This does not preview or download document bodies. Empty lists are distinguished
from sections whose server service is unavailable.

Pages contain up to 30 records; the current Life OS mission is shown separately
on the first page. Upcoming commitment deadlines retain priority, followed by
undated records. Inactive memories, deleted documents and revoked devices are
excluded. Refresh starts a new traversal; newly added records do not shift an
existing traversal. A failed page read retains the displayed list. Repeated taps
cannot launch parallel page loads, and late pages cannot overwrite refreshes or
another section.

Mini App chat history is explicitly separate from Telegram. Earlier messages
load before current ones; failed reads preserve history and the draft. Original
UUID reconciliation of uncertain messages is unchanged.

The server explicitly wires a read-only `SectionReader` into runtime. Opaque
page cursors are bound to the user, section and conversation, expire after ten
minutes and live only in bounded process memory. Expiry, restart or eviction
requires refreshing the list. Every page rechecks current access. Cursor state
contains only server SQL anchors, never document bodies, storage keys or credentials.

Migration 050 adds paging indexes. A fresh isolated local PostgreSQL 16.13 with
real pgvector passed the complete pipeline of 52 migration files through 050. The new acceptance suite
passed **7/7**; combined with existing Mini App PostgreSQL suites, **20** scenarios
are checked. They cover 65 records per section, identical precise timestamps,
foreign/expired cursors, older history, access revocation, added/hidden records
and commitment ordering. The full server suite passed **874/874** without skips.
The build and eight browser suites passed, including list scenarios at
390/1280 px; the latest card styling was rechecked with that suite separately.

This stage was reviewed by the main agent. Independent review was unavailable:
both helpers stopped at the account usage limit before implementing their parts.
Actual Telegram WebView, physical-phone and owner/member acceptance remain for
an authorized release. Installing the branch requires migrations 049 and 050.
Remaining work includes user actions through shared server services and manual
HH unknown reconciliation without re-executing an uncertain operation.
