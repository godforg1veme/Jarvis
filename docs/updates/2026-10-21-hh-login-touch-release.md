# Вход HH и управление с телефона / HH sign-in and phone controls

## Русский

21 октября 2026 владелец поручил публикацию и обновление VPS. Выпуск готовится;
состояние установки будет записано здесь после проверок.

Код приложения: `6ad285e4623afdbd612adf9032e7cec3cfa31a79`.
[Локальная разработка и полный перечень проверок](2026-10-21-hh-login-touch-development.md).

Исправлены запрещённые запросы HH для получения кода и входа. Личная временная
ссылка отправляется пользователю текстом и URL-кнопкой в Telegram, доступна
также в Mini App. В окне HH работают тапы, выбор поля и ввод с клавиатуры
телефона; нижняя панель сохранена. Неизвестная доставка и потерянный ответ
ввода не приводят к повтору операции. Профили и подтверждение резюме личные.

План установки: синхронизация исходников DE/NL; отдельный release на DE,
миграция 040 и обновление server, job-browser и общего образа сборщика.
Профиль владельца, отдельные профили участников, секреты и прежний прогресс
сборщика сохраняются. Desktop, VPN и Host Agent не меняются.

До публикации прошли server 783/783, Telegram gate 66/66, 14 проверок на
отдельной PostgreSQL и браузерные fixtures 390/1280 px. В Windows job-browser
70 passed, 9 Linux-only checks skipped. Настоящий вход HH и системная
клавиатура iPhone остаются для проверки пользователем после установки.

## English

On October 21, 2026 the owner authorized publication and the VPS update.
The release is being prepared; installation results will be recorded here
after verification.

Application code: `6ad285e4623afdbd612adf9032e7cec3cfa31a79`.
[Local development and full verification details](2026-10-21-hh-login-touch-development.md).

Allow the HH requests for requesting a code and signing in. The personal
temporary link is delivered as private Telegram message text and a URL button,
and remains available in the Mini App. The HH window supports taps, field
selection and phone-keyboard input, retaining the bottom panel. Unknown
delivery and lost input acknowledgements do not replay operations. Profiles
and resume confirmation remain personal.

Installation plan: synchronize DE/NL source checkouts; stage a separate DE
release, apply migration 040 and update server, job-browser and the collector's
shared image. Preserve owner/member profiles, secrets and collector progress.
Desktop, VPN and Host Agent remain unchanged.

Before publication: server 783/783, Telegram gate 66/66, 14 isolated PostgreSQL
checks and 390/1280 px browser fixtures passed. On Windows, job-browser had
70 passes and 9 Linux-only skips. Real HH sign-in and the iPhone system keyboard
still need user acceptance after installation.
