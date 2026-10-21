# Вход HH и управление с телефона / HH sign-in and phone controls

## Русский

21 октября 2026 по поручению владельца изменения опубликованы в GitHub `main`
и установлены на DE. Исходники DE/NL синхронизированы; оба source guard прошли.

Код приложения: `6ad285e4623afdbd612adf9032e7cec3cfa31a79`.
[Локальная разработка и полный перечень проверок](2026-10-21-hh-login-touch-development.md).

Работающий release: `a8168aa4658bc1fc4f25ede714bccbbecd9ebac1`,
`/home/deploy/releases/jarvis-a8168aa-hh-login-touch`. Последующие MD-коммиты
не меняют его runtime. Server и сборщик используют образ
`sha256:f0c204fb4180a67d30bb579153869a0612ebf1aadf8ae6c575d279569ee667fb`,
browser — `sha256:71769ff48a38a55444d0a2ca4d60f16fe881edbf76a2896dc9b7f86155da78cc`.

Исправлены запрещённые запросы HH для получения кода и входа. Личная временная
ссылка отправляется пользователю текстом и URL-кнопкой в Telegram, доступна
также в Mini App. В окне HH работают тапы, выбор поля и ввод с клавиатуры
телефона; нижняя панель сохранена. Неизвестная доставка и потерянный ответ
ввода не приводят к повтору операции. Профили и подтверждение резюме личные.

Миграция 040 применена. Сборщик и server остановлены штатно; обновлены только
server, job-browser и сборщик. Server/browser healthy, restart count всех трёх
равен нулю. Сверены 330 файлов server/shared, 330 файлов сборщика и 43 файла
browser; все совпадают с принятой версией. Публичный `jobConnect.js` совпал
с файлом установленного образа. HTTPS live/ready, Mini App и окно HH — 200;
анонимный `/mini/api/me` — ожидаемый 401.

Окружение приложения, volume профиля владельца и участников, прочие volumes и
inode смонтированного секрета сохранены. При пересборке общий базовый Node image
получил Node 22.23.4; отличается только системная переменная `NODE_VERSION`,
настройки Jarvis прежние. PostgreSQL, OCR, ASR и tunnel сохранили container IDs.
Desktop, VPN и Host Agent не менялись; по 17 модулей Host Agent на каждом узле
совпадают с GitHub, службы активны. Незавершённая Operations UI не включена в выпуск.

До публикации прошли server 783/783, Telegram gate 66/66, 14 проверок на
отдельной PostgreSQL и браузерные fixtures 390/1280 px. Сам Linux image прошёл
783 server и 79 browser tests без пропусков, полный pipeline из 42 миграций
с pgvector и 14 acceptance на отдельной внутренней Docker-сети без production
данных, профилей и окружения. Тестовая БД и сеть удалены. В Windows browser
suite дал 70 passes и 9 Linux-only skips. Настоящий вход HH и системная
клавиатура iPhone ещё требуют проверки. Старое временное окно входа после
перезапуска нужно заменить новой ссылкой; подтверждённые профили сохранены.

## English

On October 21, 2026, with owner authorization, the change was published to
GitHub `main` and installed on DE. DE/NL source checkouts are synchronized;
both source guards passed.

Application code: `6ad285e4623afdbd612adf9032e7cec3cfa31a79`.
[Local development and full verification details](2026-10-21-hh-login-touch-development.md).

Installed release: `a8168aa4658bc1fc4f25ede714bccbbecd9ebac1`,
`/home/deploy/releases/jarvis-a8168aa-hh-login-touch`. Later Markdown commits
do not change its runtime. Server and collector image:
`sha256:f0c204fb4180a67d30bb579153869a0612ebf1aadf8ae6c575d279569ee667fb`;
browser: `sha256:71769ff48a38a55444d0a2ca4d60f16fe881edbf76a2896dc9b7f86155da78cc`.

Allow the HH requests for requesting a code and signing in. The personal
temporary link is delivered as private Telegram message text and a URL button,
and remains available in the Mini App. The HH window supports taps, field
selection and phone-keyboard input, retaining the bottom panel. Unknown
delivery and lost input acknowledgements do not replay operations. Profiles
and resume confirmation remain personal.

Migration 040 is applied. Collector and server stopped gracefully; only server,
job-browser and collector were updated. Server/browser are healthy; all three
have zero restarts. All 330 server/shared files, 330 collector files and 43
browser files match the accepted code. Public `jobConnect.js` matches the
installed image. Public HTTPS live/ready, Mini App and HH entry returned 200;
anonymous `/mini/api/me` returned the expected 401.

Application environment, owner/member profile volume, other volumes and the
mounted secret inode were preserved. The rebuilt shared base image uses Node
22.23.4; only the system `NODE_VERSION` variable differs, with Jarvis settings
unchanged. PostgreSQL, OCR, ASR and tunnel retained their container IDs.
Desktop, VPN and Host Agent were unchanged; all 17 Host Agent modules on each
node match GitHub and their services are active. Unfinished Operations UI work
is excluded from the release.

Before publication: server 783/783, Telegram gate 66/66, 14 isolated PostgreSQL
checks and 390/1280 px browser fixtures passed. The Linux images passed all
783 server and 79 browser tests without skips, the complete 42-migration
pgvector pipeline and 14 acceptance tests on an isolated internal Docker
network without production data, profiles or environment. The test database
and network were removed. Windows browser tests had 70 passes and 9 Linux-only
skips. Real HH sign-in and the iPhone system keyboard remain unverified. Create
a fresh link after the browser restart; confirmed profiles were preserved.
