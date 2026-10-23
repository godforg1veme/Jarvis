# Единый дизайн внутренних экранов / Unified Mini App interiors

**Goal:** Завершить согласованный графитовый дизайн во всех существующих внутренних экранах Mini App, сохранив орбитальную оболочку и поведение подтверждений.

**Scope:** Диалог, память, документы, устройства, Life OS, информационные VPN/Operations, пользователи/роли/права/аудит, подключение HH, выбор резюме, автоподнятие, отдельная Jarvis-страница входа HH. Сама внешняя страница провайдера внутри снимка сохраняет своё оформление.

**Architecture:** `interior.css` задаёт общие поверхности, контроли и состояния. `sectionViews.js` строит безопасные read-only карточки и локальный фильтр. `app.js`, `admin.js`, `jobConnection.js` и `jobResumes.js` сохраняют существующие API и подтверждения, добавляя представление состояний. Сборка и явная серверная allowlist включают новые файлы.

**Stack:** Существующие JavaScript modules, HTML/CSS, CommonJS/Fastify, Three.js и Playwright/Edge. Новых production-зависимостей нет.

## Ограничения

Не добавлять несуществующие действия удаления, загрузки или управления VPN/VPS. Не обходить права и не выводить внутренние IDs личных ресурсов. Недоверенный текст вставлять через `textContent`. Не менять origin-bound подтверждения и исходные IDs неизвестных действий. Время показывать в МСК. Никакого push/deploy без поручения.

## Шаги

- [x] Проверить существующий UX/UI diff, свежую main, worktrees и открытые PR.
- [x] Реализовать карточки и локальный поиск личных данных, информативные VPN/Operations карточки без вымышленных кнопок.
- [x] Оформить чат, пустой диалог, загрузку, ошибку и неизвестный результат; сохранять черновик и receipt.
- [x] Оформить все редакторы доступа, readonly-защиту владельца, подтверждение, unknown и историю; добавить локальное восстановление ошибки чтения.
- [x] Оформить HH-подключение, выбор/обновление резюме, автоподнятие и подтверждения, отдельное окно ввода.
- [x] При вводе на телефоне разворачивать панель устойчиво до явного сворачивания, чтобы кнопки не смещались при потере фокуса.
- [x] Проверить состояния на 320/390/844/1280 px; осмотреть скриншоты.
- [x] Завершить общий регрессионный прогон и записать результат на русском и английском.

## English

Complete the agreed graphite design throughout the existing Mini App interiors,
including personal read-only lists, chat, access administration and all Jarvis HH
surfaces. Retain APIs, current rights, drafts, original operation IDs and source
confirmation boundaries. Add reusable presentation modules and test the actual
built screens, filters, empty/error/confirmation/unknown states and mobile input
behavior. External provider pixels are unchanged. Work remains local.
