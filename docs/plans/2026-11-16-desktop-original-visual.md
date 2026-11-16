# Original dashboard visual in Desktop

## Русский

Пользователь отверг упрощённые сферы после установки и уточнил: за основу
берём именно нашу веб-панель управления. Это уточнение принятого дизайна.

Сцена собирается из настоящих OrbitalScene, SharedSky и их зависимостей
в отдельный локальный IIFE/CSS. Desktop сохраняет свои IPC, навигацию,
подтверждения и личные данные. Одно ядро занимает всё пространство; меню
и компактные голос/зрение располагаются поверх общего неба. Кнопки разделов
и планеты открывают существующие экраны. Без новых production-зависимостей,
без ослабления CSP, без внешнего сайта внутри привилегированного окна.

План:

- [x] Проверить исходную сцену и пути ресурсов, сохранить постороннюю работу.
- [x] Добавить отдельную Vite-сборку, относительные локальные ресурсы и setup hook.
- [x] Подключить оригинальные компоненты, убрать вторую сцену, связать названия
  и клики с Desktop-разделами. Непривязанному клиенту оставить форму входа.
- [x] Проверить браузерные сценарии и реальный Electron; получить скриншот.
- [x] Сборка, установка EXE, публикация в main и обновление обоих VPS по поручению владельца; [результат](../updates/2026-11-16-desktop-original-visual-install.md).

## English

The user rejected the simplified spheres after installation and specified our
actual web dashboard as the source. This refines the previously accepted design.

Build the actual OrbitalScene, SharedSky and their dependencies into a local
IIFE/CSS. Preserve Desktop IPC, navigation, confirmations and personal data.
One core fills the space; navigation and compact voice/vision controls sit over
one shared sky. Buttons and planets open existing Desktop screens. Add no
production dependencies, keep CSP intact and embed no external privileged page.

Completed: source/path audit, dedicated Vite build and setup hook, original
component integration, removal of the duplicate scene, Desktop destination
labels, unpaired sign-in preservation, browser and native Electron checks,
and screenshot capture. EXE installation was authorized and completed locally; see the
[acceptance result](../updates/2026-11-16-desktop-original-visual-install.md).
Source publication and both VPS updates were subsequently authorized and completed.
