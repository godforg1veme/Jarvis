# Вход HH: исправление, личная ссылка и управление с телефона

## Русский

Согласовано владельцем 21 октября 2026 в текущей задаче. Изменения готовятся
локально; публикация и установка требуют отдельного поручения.

Работающий браузер Jarvis блокирует POST `/account/otp_generate` и
`/account/login/by_code`, которые использует текущая страница HH. Добавить
именно эти пути в закрытый список входа для всех личных профилей. Сохранить
проверки HTTPS origin, действия человека, срока и отдельного профиля.

При нажатии «Подключить HH» пользователь получает временную ссылку в Mini App
и в своём личном Telegram: текстом и URL-кнопкой «Открыть вход HH». Существующая
нижняя клавиатура Telegram сохраняется. Адресат определяется сервером по
проверенной личности и привязке private chat, никогда из тела запроса. Ссылка
содержит прежний ограниченный ticket, исключённый из истории Jarvis и логов.
Неизвестная доставка не запускается повторно автоматически и не создаёт
другую сессию под новым ID. Результат доставки сообщается отдельно от создания.

Окно HH сохраняет текущий снимок браузера. Тап по странице нажимает элемент;
тап по редактируемому полю открывает клавиатуру телефона и направляет ввод в
выбранное поле. Сервер возвращает только закрытые метаданные полей, без их
значений. Нажатия кнопок не открывают клавиатуру. Ввод идёт последовательно,
с прежним sequence и сверкой неопределённого результата. Нижняя панель ввода,
«Ввести в HH», Enter, Tab и отмена остаются запасным управлением.

Профили пользователей, проверка jobs, отзыв прав, TTL, guest-cookie и отдельное
подтверждение основного резюме в исходной Mini App сохраняются. Новые production
зависимости не нужны. Телефон, пароль и код не записываются в БД, логи или storage.

Приёмка: закрытые auth-пути и запрет остальных POST; личная доставка и отказ
чужому чату; повторы/unknown/expiry/revocation; браузерные fixtures на телефоне
и ПК с тапами, редактированием, клавиатурой и запасной панелью. Успешная fixture
не считается настоящим входом HH или проверкой экранной клавиатуры iOS.

## English

Approved by the owner on October 21, 2026 in this task. Development is local;
publication and installation require a separate instruction.

Allow the two verified HH authentication POST paths, `/account/otp_generate`
and `/account/login/by_code`, in every personal profile while retaining the
closed HTTPS origin policy and human-action/session guards.

Connecting HH provides the temporary link in the Mini App and in that user's
private Telegram chat, as text and an “Открыть вход HH” URL button. Keep the
existing bottom keyboard. Resolve recipients from verified server identity and
private-chat binding. Exclude bearer links from Jarvis history and logs. Track
delivery separately; never automatically replay an uncertain send or create a
new operation to hide an unknown outcome.

Keep the screenshot-based HH window. Tapping a field selects it and opens the
phone keyboard; tapping a button clicks it without opening a keyboard. Return
only bounded field metadata, never values. Serialize input with existing
sequence/reconciliation rules and retain the bottom input panel, send, Enter,
Tab and cancel controls as fallback.

Preserve user isolation, current jobs permission, revocation, TTL, guest-cookie
and resume confirmation in the originating Mini App. No new production
dependencies or persisted phone/password/code values. Verify auth policy,
private delivery, duplicates/unknown/expiry/revocation and mobile/desktop
browser fixtures. Real HH sign-in and the iOS keyboard require live acceptance.
