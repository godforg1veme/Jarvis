# Орбитальная панель мониторинга / Orbital monitoring

## Русский

Итог уточнений владельца: мобильный баланс оставлен; в инфраструктуре сразу
видны процессор, память, диск и нагрузка за минуту. Остальные семь показателей
находятся в раскрытии «Дополнительные показатели», доступном с клавиатуры.
Ожидающие команды сохраняют сообщение об ожидании, без нового серверного API.
Ответы применены; локальный этап завершён, публикации не было.

Следующий этап, 21 октября: доработаны все девять разделов. Единые состояния
загрузки, недоступности и устаревших данных сохраняют заголовки и последние
снимки; повторная загрузка выполняет только чтение. Ошибка парсера больше
не превращается в сообщение об отсутствии ошибок. Команды сервисов показывают
ожидание, успех, ошибку или неподтверждённый итог без внутренних кодов.
На телефоне панель прокручивается внутри доступной высоты, а нижняя навигация
занимает отдельную строку и не перекрывает управление. Метрики, устройства,
парсер, события, копии и сессии получили общую типографику и отступы.
Переназначение подключения защищено от двойного нажатия; перед отправкой
проверяется актуальный исходный и целевой профиль. После операции обновляется
список, код устройства сохраняется в окне, фокус возвращается в доступный элемент.
40/40 unit, build, bootstrap, service dialogs, четыре ширины и все девять страниц
под production CSP прошли. Браузер отдельно проверяет отсутствие перекрытия
панели нижней навигацией и возврат фокуса после исчезновения кнопки устройства.
Проверки использовали синтетические данные. VPS и реальный FPS телефона не проверены.
Нет GET-эндпоинта для чтения итога ожидающей команды: автоматического повтора POST
не добавляли. Выбор мобильной плотности, начальных метрик и способа проверки
итога команды оставлен владельцу. После ответов потребуется следующий проход.

Уточнение 21 октября: выбранный владельцем сайдбар B реализован. Вместо карточек —
список с фильтрами и одним раскрытым сервисом; управление учитывает capabilities,
логи открываются отдельно. Локальный Inter, тонкая прокрутка и прозрачная панель
поверх единого движущегося неба. Общий фон теперь CSS-слой, Canvas прозрачный;
pause, reduced motion и hidden останавливают фон вместе со сценой. Панель до 780 px.
Unit 24/24, build, девять разделов на четырёх ширинах, native dialogs и production
CSP (включая локальный шрифт) прошли. Ревизия исправлений пройдена: результат
команды сохраняется после смены строки, фокус возвращается, отзыв capabilities
проверяется перед отправкой. Ниже сохранена история прежних итераций сайдбара.

Выбранная сцена `A-reference-milky-v4` перенесена в React Three Fiber: узкий
Млечный Путь поставляется локальным WebP (183 КБ), орбиты разнесены, скорости
вращения различаются, скорость движения индивидуально меняется в ограниченных
пределах. Ортографическая камера сохраняет пропорциональный зазор тел и колец
на всём переходе. Редкие фоновые события длятся 1,6 секунды; первое возможно
через 62 секунды активной анимации, следующие — с длинными неравными интервалами.
Pause, reduced motion и hidden останавливают декорации; скрытая вкладка также
останавливает переход камеры. При ошибке загрузки текстуры остаются звёзды.
Новая структура сайдбара пока не принята: подготовлены три изображения для
обсуждения, существующие команды и подтверждения остаются прежними.

Финальная browser-проверка дополнительно покрывает скрытие вкладки во время
перехода камеры, навигацию при ошибке загрузки неба и покрытие фона после resize
в reduced motion. Проверка production CSP подтверждает декодирование локального
WebP. Геометрия имеет консервативные границы с кольцами и спутниками; безопасный
zoom вписывает их в кадр с запасом, включая текущий фокус во время перехода.

По ранее выбранному направлению реализован компактный инспектор шириной 380–440 px и
высотой до 680 px. Основной текст карточек увеличен до 14–15 px; добавлены
слои поверхностей и небольшая сводка по реальному списку сервисов. Прокрутка
находится внутри панели, заголовок закреплён, тонкий бегунок проявляется при
взаимодействии. Доступные команды и подтверждения сохранены.

Исправлена вертикальная композиция после длительного просмотра: прежняя
прецессия постепенно поворачивала всю систему почти на 90° примерно за 95 секунд.
Теперь наклон мягко колеблется в небольших пределах; планеты продолжают движение.
Browser-проверка подтверждает восстановление полной ширины сцены после закрытия
инспектора. Добавлены 1700 звёздных точек, мягкая процедурная дымка Млечного Пути,
спутники и разные детали поверхностей; движение останавливается вместе со сценой.

После выбора владельцем более тёмного варианта: шапка содержит только поиск
по девяти реальным разделам, снизу находятся пять иконок без подписей и номеров.
Парсер доступен рядом с сервисами; копии и сессии — рядом с обзором. Все планеты
сохранены. Сеть и точки на тёмных сферах процедурные. Планеты двигаются по
эллипсам и вращаются; линии орбит медленно поворачиваются по той же траектории.
Подписи следуют за объектами, наведение обновляется при неподвижном курсоре.
Сайдбар плавно появляется и закрывается, скрываемое содержимое становится inert.
Поиск и навигация не прерывают окна подтверждения и переназначения устройства.
Окно переназначения вынесено в portal, чтобы стили сайдбара не ограничивали overlay.

21 октября 2026. Готова локальная первая итерация редизайна Operations UI.
Изменения находятся в `codex/orbital-monitoring`, без push и развёртывания.
Существующая панель получила 3D-ядро и шесть планет для навигации. Все девять
разделов сохранены; инциденты/события и копии/сессии объединены только в группы
навигации. Справа открываются настоящие страницы, а не демонстрационные карточки.

Сайдбар, карточки, таблицы, формы, вход и диалоги переведены в общую тёмную
стилистику со светлым текстом. Значимые состояния сохраняют спокойные цвета.
На узком экране сцена помещается целиком, рабочая область находится под ней.
Поддержаны клавиатура, возврат фокуса, история, расширение панели, reduced motion,
пауза и навигация при недоступном WebGL. Сводка и обзор используют один источник
данных; ошибка обновления явно обозначает последнее полученное состояние.

Запрошенный стек: React Three Fiber 9.8.2 и Three.js 0.186.1. Сцена процедурная,
без внешних моделей, загружается отдельно; утверждённая текстура неба локальная.
Основной JS — около 74 КБ gzip, 3D-модуль — около 257 КБ gzip. Vite предупреждает о размере 3D-модуля.
API, серверные права и подтверждения команд сохранены; backend не менялся.

Доработка 21 октября: общий период движения и фиксированные фазовые промежутки
устраняют обгоны и пересечения. Подписи учитывают проекции тел и внешних колец.
Звёзд стало 2400, они ярче; сохранена анимация полосы Млечного Пути и материалы
планет. Добавлена регрессионная выборка зазоров на протяжении 4000 секунд.
Текущее оформление сайдбара владельцем не принято: сравниваются реальные
референсы перед переработкой границ, типографики, прокрутки и фона.

Проверки:

- Operations unit: 24/24; TypeScript и production build проходят.
- Orbital browser-набор: девять страниц на 1440, 662, 390 и 320 px, без overflow
  и необработанных ошибок. Дополнительно устранён overflow во время появления панели.
- Bootstrap: 503, network, 403 и 401; восстановление и скрытие панели при отзыве сессии.
- Диалоги сервисов: native modal, вложенный Escape, возврат фокуса, устаревшие
  ответы и отправка команды один раз.
- Новый WebGL browser-набор: выбор ядра через raycast, HTML-навигация, история,
  расширение, актуальная сводка, восстановление после ошибки, мобильная прокрутка,
  пауза, reduced motion и потеря контекста. Навигация также проверена без WebGL
  при первом открытии.
- Production assets отдельно проверены под существующей серверной CSP: стили,
  WebGL, раздел сервисов и вложенное подтверждение без нарушений CSP.
- Независимая ревизия выявила три дефекта: устаревшая сводка, неверный возврат
  фокуса и мобильная прокрутка. Все исправлены и повторно просмотрены.

Проверки используют вымышленные данные, не подтверждают реальный Telegram-вход,
VPS или FPS телефона. Desktop и Mini App не изменялись.

Для просмотра реального приложения с тестовыми данными:

```powershell
node scripts/previewOperations.cjs
```

Открыть `http://127.0.0.1:5188/ops/`. Это отдельный loopback preview-runner:
изменяющие запросы отклоняются, production-сборка не содержит его middleware.
Скриншоты находятся в игнорируемом `.superpowers/orbital-operations/`.
Результат ещё предстоит принять визуально; установка на VPS не выполнялась.

## English

Owner answers applied: retain the current mobile balance; show processor,
memory, disk and one-minute load first. Seven additional metrics use a native,
keyboard-accessible disclosure. Pending commands keep their existing message;
no new server API was added. Local refinement is complete and not published.

Next stage, October 21: all nine sections were refined. Shared loading, unavailable
and stale states retain headings and last successful snapshots; retry only reads.
Parser failures no longer look like an empty successful result. Service commands
show pending, success, error or unconfirmed outcomes without internal error codes.
On mobile the panel scrolls within available height, while the dock has a separate
row and no longer covers controls. Metrics, devices, parser, events, backups and
sessions share readable typography and spacing. Connection reassignment prevents
double submission and rechecks source and target profiles before sending. The list
refreshes after success, the device code remains visible and focus returns to an
available element. All 40 unit tests, build, bootstrap, service dialogs, four widths
and all nine pages under production CSP passed. Browser checks explicitly cover dock
separation and focus after the device trigger disappears. Fixtures do not verify
VPS behavior or actual phone FPS. There is no GET endpoint for pending command
outcomes; no automatic POST retry was added. Mobile density, initial metrics and
command outcome lookup remain owner questions; another pass follows the answers.

October 21 clarification: owner-approved sidebar B is implemented. A filtered
list with one expanded service replaces cards; controls respect capabilities,
and logs open separately. Local Inter, a quiet scrollbar and a translucent panel
sit over one moving sky. The shared background is now a CSS layer behind a
transparent Canvas; pause, reduced motion and hidden state stop both together.
Panel height is up to 780 px. All 24 unit tests, build, nine sections at four
widths, native dialogs and production CSP (including the local font) passed.
Follow-up review confirmed preserved command outcomes after row switches,
focus return and capability revocation checks before submission. Earlier sidebar
iterations are retained below as history.

The approved `A-reference-milky-v4` scene now runs in React Three Fiber: the
narrow Milky Way ships as a local 183 KB WebP, orbits are separated, axial spins
vary and individual orbital speeds vary within bounded phase envelopes. An
orthographic camera preserves proportional body/ring clearance throughout its
transitions. Rare ambient events last 1.6 seconds, with the first possible after
62 active seconds and long unequal intervals thereafter. Pause, reduced motion
and hidden tabs stop decorations; hidden tabs also suspend camera transitions.
Missing sky texture falls back to stars. Three sidebar structure images are
ready for discussion; the new workspace structure has not been accepted.

Final browser coverage also includes hiding the tab during a camera transition,
navigation with a missing sky asset and sky coverage after reduced-motion resize.
The production CSP check verifies local WebP decoding. Conservative geometry
bounds include rings and satellites; safe zoom keeps all bodies inside the frame
with a margin, including intermediate camera focus positions.

The previously chosen direction was implemented as a compact inspector, 380–440 px wide and up to
680 px tall. Card text is now 14–15 px, with layered surfaces and a summary based
on the actual service list. Content scrolls inside the panel, the heading stays
visible and the thin scrollbar appears during interaction. Existing commands
and confirmations remain.

Fixed the vertical composition during long viewing sessions: the previous
precession turned the system nearly 90 degrees after about 95 seconds. Tilt now
oscillates within a small range while planets keep moving. Browser checks confirm
that closing the inspector restores the full scene width. Added 1700 star points,
a soft procedural Milky Way haze, satellites and varied surface details; all
motion stops together with the scene.

Following the owner's selection of the darker direction, the header contains
only search across the nine real pages; the bottom dock has five unlabeled icons
without decorative numbers. Parser shares the Services group; backups and
sessions share Overview. All planets remain. Procedural dark spheres have fine
links and points. Planets orbit and spin, while orbit lines precess using the
same path model. Labels follow objects; stationary-pointer hover is refreshed.
The workspace slides in and out, with closing content made inert. Search and
navigation cannot interrupt confirmation or device reassignment. A portal keeps
the reassignment overlay independent of workspace layout containment.

October 21, 2026. The first Operations UI redesign is ready locally on
`codex/orbital-monitoring`, without push or deployment. A 3D core and six planets
navigate the existing application. All nine pages remain; incidents/events and
backups/sessions only share navigation groups. The workspace contains actual
operational pages rather than mock cards.

The sidebar, cards, tables, forms, entry screen and dialogs share a dark theme
with light text. Meaningful states retain muted colors. On narrow screens the
whole scene fits above the workspace. Keyboard navigation, focus return,
history, panel expansion, reduced motion, pause and WebGL fallback are covered.
Overview and the footer share one data source; refresh failures mark stale data.

Requested stack: React Three Fiber 9.8.2 and Three.js 0.186.1. The procedural
scene has no external models and loads separately; its approved sky ships locally.
Main JS is about 74 KB gzip and the 3D chunk about 257 KB gzip; Vite reports a chunk-size warning.
APIs, server permissions and command confirmations remain; no backend changes.

Follow-up on 21 October: planets now share an orbital period with fixed phase
spacing to prevent overtaking and intersections. Label placement accounts for
projected bodies and outer rings. Stars are brighter and more numerous (2400),
with an animated Milky Way band. Planet materials are preserved. A sampled
4000-second clearance regression brings unit coverage to 15 passing tests.
The existing sidebar has not been accepted: actual design references are being
compared before its borders, typography, scrolling and background are revised.

Validation:

- Operations unit tests: 24/24; TypeScript and production build pass.
- Orbital browser suite: nine pages at 1440, 662, 390 and 320 px without overflow
  or unhandled errors. Panel-entry animation overflow was also fixed.
- Bootstrap: 503, network, 403 and 401; recovery and revoked-session handling.
- Service dialogs: native modal behavior, nested Escape, focus return, stale
  responses and single command submission.
- New WebGL browser suite: raycast selection, HTML navigation, history,
  expansion, live summary, refresh failure/recovery, mobile scrolling, pause,
  reduced motion and context loss. Navigation also works when WebGL is
  unavailable at startup.
- Production assets under the existing server CSP: styling, WebGL, the service
  workspace and nested confirmation pass without CSP violations.
- Independent review identified three defects: stale summary, wrong focus
  return and mobile scrolling. All were fixed and reviewed again.

Fixtures do not establish real Telegram login, VPS behavior or phone FPS.
Desktop and Mini App were not changed.

Run `node scripts/previewOperations.cjs` and open `http://127.0.0.1:5188/ops/`
to inspect the actual application with synthetic data. The separate loopback
runner rejects mutations; its middleware is absent from production builds.
Screenshots stay under ignored `.superpowers/orbital-operations/`. Visual owner
acceptance and a separately authorized VPS release remain outstanding.
