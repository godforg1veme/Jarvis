# Резюме и ручная правка сопроводительного Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Передавать выбранное личное резюме в генерацию и разрешить ручную замену текста любого черновика перед подтверждением отправки.

**Architecture:** Чтение резюме использует ограниченный HH browser RPC и существующий пользовательский browser profile. Новый серверный контекст передаётся jobPrompt как данные. Ручная правка создаёт дочерний черновик через отдельный guided input без вызова модели и делает прежние подтверждения устаревшими.

**Tech Stack:** CommonJS, Fastify/PostgreSQL, существующий Playwright в job-browser, Telegram guided input; новых production-зависимостей нет.

**Spec:** [Принятая спецификация](../specs/2026-10-24-shared-model-instructions-design.md), разделы данных резюме и ручной правки.

## Global Constraints

- «Основной источник опыта — выбранное резюме текущего пользователя».
- «Текущие явные поправки имеют приоритет».
- «Правится сопроводительное, не резюме».
- «Jarvis сохраняет текст дословно, без нового AI-переписывания».
- «Резюме не публикуется в логах и не отправляется поисковому сервису».
- Сохранять scope, private chat, текущие права, revision, expiry, single consumption и отдельное подтверждение отправки.
- До реальной Telegram-правки прочитать оба контракта целиком и отправить pre-edit notice. Согласие на кнопку уже есть в текущем чате; не просить его повторно при соответствии согласованному пути.
- БД только изолированная тестовая; новые kind требуют forward-only migration с актуальным номером.

### Task 1: Ограниченное чтение содержимого выбранного резюме

**Files:**
- Create: `job-browser/src/hhResumeReader.js`, `job-browser/test/hhResumeReader.test.js`, `server/src/jobs/jobResumeContextService.js`, `server/test/jobResumeContext.test.js`.
- Modify: `job-browser/src/hhBrowser.js`, `job-browser/src/rpcProtocol.js`, `job-browser/src/rpcServer.js`, `job-browser/src/profileManager.js` только если нужен scoped read helper.
- Modify: `server/src/jobs/jobBrowserClient.js`, `job-browser/test/rpcServer.test.js`, `server/test/jobBrowserClient.test.js`.

**Interfaces:**
- Browser RPC `resume_content` с закрытыми args `{ resumeId }`, существующим read token, проверенным userId UUID.
- `browserClient.forUser(userId).readResume({ resumeId }) -> { resumeId, title, experience, skills, education, summary, grammaticalGender }`.
- Каждое текстовое поле <=12000 символов, общий serialised snapshot <=60000 символов, grammaticalGender только `male | female | unknown`; нет контактов, адреса, фото и внутренних storage keys.
- `JobResumeContextService({ pool, browserClient, accessService }).getSelected({ scope }) -> { resumeId, connectionRevision, snapshot }`.

- [ ] Перед реализацией исследовать текущие `readResumes`, `readResumePrivacy`, networkPolicy и branded page signals. Найти/добавить локальную HH fixture страницы резюме с проверяемым ID. Не угадывать DOM селекторы или gender по имени. Выбрать несколько явных семантических блоков в fixture и текущем поддерживаемом reader стиле.
- [ ] Написать reader и RPC тесты: чужой/невыбранный ID, поменявшийся выбор, login/captcha, неизвестная страница, превышение размера, отсутствие контактов в snapshot.
- [ ] Запустить `node --test job-browser/test/hhResumeReader.test.js job-browser/test/rpcServer.test.js server/test/jobBrowserClient.test.js`; подтвердить ожидаемое отсутствие нового RPC.
- [ ] Добавить закрытую валидацию resume_content по образцу inspect:

```js
if (value.operation === 'resume_content') return exact(args, ['resumeId'])
  && typeof args.resumeId === 'string' && /^[a-zA-Z0-9]{1,100}$/.test(args.resumeId);
```

- [ ] HH метод выполняется через существующий `run`, проверяет `resumeId === this.primaryResumeId` и наличие в readResumes перед открытием `https://hh.ru/resume/${resumeId}`. Расширить только явный read-only resume path, сохранив сетевые блокировки записей и CAPTCHA-порядок. Не обходить unknown выдачей сырого innerText всей страницы.
- [ ] В server service проверить scope/access и выбранный `job_connections.resume_id`, прочитать snapshot, повторно проверить access/connection revision и ID. При изменении выбора вернуть JOB_REVISION_CONFLICT; при недоступности JOB_HH_RESUME_UNAVAILABLE. Не выбирать альтернативное резюме автоматически.
- [ ] Запустить узкие тесты и `npm test --prefix job-browser`, коммит: `feat: read selected HH resume as scoped letter context`.

### Task 2: Данные резюме в запросе письма

**Files:**
- Modify: `server/src/jobs/jobDraftService.js`, `server/src/jobs/jobPrompt.js`, `server/src/jobs/jobRuntime.js`, `server/src/jobs/jobTelegramService.js`.
- Test: `server/test/jobResumeContext.test.js`, `server/test/jobLetterModes.test.js`, `server/test/jobDraftAcceptance.cjs`.

**Interfaces:**
- DraftService options получает `resumeContextService`; buildJobPrompt получает `resumeContext = null`.
- Данные user message включают `selectedResume: snapshot`; rules остаются в system message.
- task payload хранит только resumeId/connectionRevision для определения исходной попытки, не тело резюме.

- [ ] Добавить интеграционные проверки генерации owner/member с различными selected resume; fake model записывает полученные messages, но не делает предположений о качестве реальной модели.
- [ ] Получать контекст до создания billable model task; сохранить исходные requestId/checkpoints. После получения проверить выбор, а непосредственно перед записью draft повторно проверить connection revision, сохранив прежний draft при конфликте.
- [ ] Расширить JSON данных, не подменяя подтверждённые profile fact IDs:

```js
const data = {
  vacancy: { title: vacancy.title, company: vacancy.company, description: String(vacancy.description || '').slice(0, 60000) },
  selectedResume: resumeContext?.snapshot || null,
  facts: profile.facts, approvedStyleExamples: profile.examples,
  sourceLetter: sourceText, previousText, ownerEditRequest: instruction,
};
```

- [ ] Источник опыта: selectedResume плюс пользовательские facts/sourceLetter/current request. Стиль примеров не является опытом. При конфликте текущая явная поправка приоритетна только для запроса. Не сохранять её автоматически в profile.
- [ ] При невозможности получить выбранное резюме сохранить прежний черновик и дать безопасный статус; не выдавать генерацию по одному названию резюме за адаптацию по опыту. Нет model-quality fallback или AI-проверяющего.
- [ ] Запустить unit suite, затем `node --test server/test/jobDraftAcceptance.cjs` на изолированном PostgreSQL. Коммит: `feat: ground cover letters in the selected personal resume`.

### Task 3: Дословная ручная правка любого черновика

**Files:**
- Modify: `server/src/jobs/jobTelegramViews.js`, `jobTelegramCallbacks.js`, `jobTelegramService.js`, `jobLetterFlow.js`, `jobDraftService.js`, `jobDraftRepository.js`.
- Modify: `server/src/telegram/telegramInteractionRepository.js`, `server/src/telegram/bot.js` если outbound grammar требует новый action.
- Create: следующая миграция `server/src/db/migrations/046_job_manual_draft_edit.sql`, если номер свободен при выполнении; при занятом номере взять следующий после текущего максимального, существующие миграции не менять.
- Test: `server/test/jobLetterModes.test.js`, `server/test/jobLetterModesAcceptance.cjs`, `server/test/telegramInteractionRepository.test.js`, `server/test/telegramArchitectureContract.test.js`.
- Modify: `docs/telegram-menu-contract.md`.

**Interfaces:**
- Callback `job:manual_edit:<draft UUID>`, label «Редактировать текст» в draftView для всех letter_mode.
- Новый kind `job_draft_manual_edit`; контекст `{targetId: draft.id, revision: 1}` с проверкой current draft ID. UUID представляет неизменяемую версию; новый текст получает новый UUID.
- `draftService.replaceManual({ scope, draftId, text }) -> newDraft`.

- [ ] Перед правкой отправить pre-edit notice: draftView → callback grammar/bot gate → JobTelegramService → JobLetterFlow → scoped guided input → replaceManual → draftView → существующее send/confirm. Указать симптом, сохранение полномочий и приёмку owner/member. Проверить фактическую in-place пагинацию длинного письма, не менять её автоматически.
- [ ] Добавить тесты через настоящие message/menu handlers и реальный interaction repository, без stub begin: invalid retry не потребляет ввод; успешный текст потребляется один раз; чужой scope, expired и stale draft отклоняются; модель не вызывается; прежнее send confirmation не работает.
- [ ] Создать forward-only CHECK migration, полностью сохранив актуальные kind и добавив job_draft_manual_edit; синхронно расширить repository KINDS и callback/outbound allowlist. Проверить закрытую shape и реальный PostgreSQL CHECK.
- [ ] Добавить кнопку; при нажатии показывать отдельно полный черновик и инструкцию прислать новый текст целиком, не включать статус «Письмо ещё не отправлено» внутрь копируемого письма. Сохранить AI edit отдельной кнопкой.
- [ ] Реализовать manual branch без `generate`:

```js
if (interaction.kind === 'job_draft_manual_edit') {
  // Проверка текста, scope, current draft и single consumption до записи.
  return draftView(await j.draftService.replaceManual({ scope, draftId: targetId, text }));
}
```

- [ ] В replaceManual атомарно проверить текущий draft и актуальные vacancy/profile revision; создать дочерний mode=custom через existing append, перевести старые apply confirmations в stale. Сохранить внутренние пробелы/переносы и текст дословно: прежний `append` делает trim, поэтому ручной путь требует явного `preserveText` параметра или отдельного атомарного метода. Не менять нормализацию остальных режимов. Непустоту проверять через text.trim(), в БД сохранять оригинал; лимит 10000 и проверка credentials остаются.
- [ ] Привязать consume и append к одной транзакции либо существующему надёжному оригинальному interaction ID: после сбоя не терять успешный ввод и не создавать второй draft при повторном update. Не поглощать interaction до validation. Ни отправка, ни изменение базового письма здесь не выполняются.
- [ ] Запустить `node --test server/test/jobLetterModes.test.js server/test/telegramInteractionRepository.test.js server/test/telegramArchitectureContract.test.js`, затем PostgreSQL `node --test server/test/jobLetterModesAcceptance.cjs server/test/jobTelegramAcceptance.cjs server/test/jobApplicationsAcceptance.cjs` и полный Telegram regression gate из menu contract, затем `npm test --prefix server`.
- [ ] Обновить menu contract в том же diff; коммит: `feat: allow direct manual editing of cover letter drafts`.

## Приёмка

Проверки по коду не заменяют живые нажатия. После порученного выпуска проверить
owner и member: выбранное резюме, генерация, ручная правка, новая preview,
отмена, устаревшее подтверждение. Настоящий отклик отправлять только с отдельным
пользовательским подтверждением. Записать фактический результат RU/EN в update;
docs/README отражает только подтверждённое состояние.
