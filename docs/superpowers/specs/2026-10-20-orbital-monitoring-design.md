# Орбитальная панель мониторинга / Orbital monitoring

## Русский

Принят сайдбар Б (`B-transparent-v2.png`): список сервисов с раскрытием одной
строки, фильтры «Все»/«Требуют внимания», состояние и время проверки, команды
по capabilities, логи по явному действию. Native подтверждение и идемпотентность
сохраняются. Панель прозрачная поверх единого движущегося звёздного фона;
крупная кириллица, мягкие разделители, без вложенных карточек.

Принятие 21 октября после Blender-проб: выбран `A-reference-milky-v4` с узким
Млечным Путём. Фон разрешён как локальный asset по референсу владельца;
это заменяет прежнее ограничение «без текстур». Сохранить разнесённые эллипсы,
разные скорости вращения, ограниченное индивидуальное изменение скорости на
орбите и редкие фоновые события. Проверять проекцию выбранной/hover-планеты и
переходы камеры. Три эскиза структуры сайдбара обсуждаются до его реализации.

Дополнение после просмотра: принят компактный инспектор с карточками
380–440 px, более крупным текстом, закреплённым заголовком и тонкой прокруткой.
Больше звёзд и мягкая анимированная полоса Млечного Пути. Наклон орбит остаётся
ограниченным при долгой работе; после закрытия панели возвращается полная ширина.

Уточнение 21 октября: выбран более тёмный вариант с тонкой сетью и точками на
сферах. Планеты движутся по эллипсам и вращаются; орбиты поворачиваются вместе
с ними по одной модели движения. Сверху остаётся только поиск по разделам.
Снизу — компактная панель из пяти иконок без видимых подписей и номеров.
Сайдбар мягко выезжает и закрывается; закрывающаяся область недоступна вводу.
Поиск и навигация не прерывают открытые модальные операции.

Согласовано владельцем 20 октября 2026: сначала изменяем существующую Operations
Console. Mini App и Desktop в этот этап не входят. Основа — пользовательский
визуальный brief: монохромная система, технологическое ядро, шесть разных планет,
сдержанное движение и существующий рабочий интерфейс справа.

Ядро открывает текущий обзор. Планеты открывают инфраструктуру, сервисы,
устройства, парсер, события (инциденты и журнал), обслуживание (резервные копии
и сессии). Все девять существующих hash-маршрутов сохраняются. Начальный экран
показывает систему; выбор раскрывает настоящую страницу справа и перемещает
композицию влево. Панель можно расширить и закрыть, оставаясь внутри системы.

React Three Fiber 9 и Three.js создают процедурную сцену без загрузки внешних
моделей; одобренная текстура неба и шрифт Inter поставляются локально. Поверхности различаются
геометрией, кольцами и спутниками. Ограничены pixel ratio, число объектов и свет.
Навигация продублирована обычными кнопками с клавиатурным фокусом. Reduced motion,
пауза, скрытая вкладка и WebGL fallback учитываются отдельно. На узком экране
рабочая панель располагается под сценой; таблицы и карточки перестраиваются.

Уточнение владельца: сайдбар целиком следует той же чёрно-белой стилистике,
включая карточки, формы, кнопки, списки и диалоги. Зелёная тема не сохраняется.
API, права, SSE, обновление данных, формы и подтверждения не меняются.
Демонстрационные данные используются только через browser fixtures; production
не получает обход входа. Цвет важных состояний остаётся различимым. Статус
связи и давность данных не подменяются декоративным «всё работает».

Проверка: unit tests навигации, штатные Operations tests/build, все девять
разделов на 1440, 390 и 320 px, реальный WebGL, выбор/возврат/расширение,
reduced motion, fallback, browser history и сохранение service confirmation.
Скриншоты — локальные артефакты. Push, deploy и установка не входят в поручение.

## English

Sidebar B (`B-transparent-v2.png`) is approved: service list with one expanded
row, All/Needs attention filters, health/freshness, capability-based actions and
explicit log viewing. Preserve native confirmation and idempotency. Translucent
workspace over one shared moving starfield, readable Cyrillic, quiet separators
and no nested card frames.

October 21 acceptance after Blender studies: `A-reference-milky-v4` and its
narrow Milky Way are approved. The reference-derived sky ships as a local asset,
superseding the earlier no-texture constraint. Keep separate ellipses, individual
spin rates, bounded orbital-speed modulation and rare ambient events. Verify
projected selected/hover bounds and camera transitions. Discuss three sidebar
structure concepts before implementing a new workspace.

Accepted after preview: a compact card inspector, 380–440 px wide, with larger
text, sticky heading and quiet scrolling. More stars and a soft animated Milky
Way band. Bound orbital tilt during long sessions; restore full scene width
after closing the workspace.

October 21 refinement: choose the darker direction with fine surface links
and points. Planets travel along ellipses and spin; orbit lines precess using
the same motion model. The header contains section search only. The compact
bottom dock has five icons without visible labels or decorative numbers.
The workspace slides in and out; closing content is inert. Search and navigation
must not interrupt open modal operations.

Approved by the owner on October 20, 2026: redesign the existing Operations
Console first. Mini App and Desktop are outside this iteration. Follow the
provided visual brief: a monochrome system, a technological core, six distinct
planets, restrained motion and the existing workspace on the right.

The core opens Overview. Six planets open Infrastructure, Services, Devices,
Parser, Activity (Incidents and Events), and Maintenance (Backups and Sessions).
Preserve all nine hash routes. The initial screen shows the system; selection
reveals the actual page on the right and moves the composition left. Users can
expand or close the workspace without leaving the system.

React Three Fiber 9 and Three.js render procedural objects without external
models; the approved sky texture and Inter font ship locally. Objects differ through geometry, rings
and satellites. Bound pixel ratio, object count and lighting. Ordinary buttons
provide keyboard navigation. Respect reduced motion, pause and hidden tabs;
provide WebGL fallback. On narrow screens place the workspace below the scene
and reflow tables and cards.

Owner clarification: the entire sidebar follows the same black-and-white style,
including cards, forms, buttons, lists and dialogs. Replace the old green theme.
Preserve APIs, permissions, SSE, refresh, forms and confirmations. Synthetic
data stays in browser fixtures; production receives no authentication bypass.
Keep meaningful status colors. Connection and data freshness must reflect
available evidence rather than decorative health claims.

Verify navigation unit tests, existing Operations tests/build, all nine sections
at 1440/390/320 px, actual WebGL, selection/return/expansion, reduced motion,
fallback, browser history and service confirmation. Screenshots remain local.
Push, deployment and installation are outside the authorized scope.
