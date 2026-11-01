# Восстановление HH и полного резюме / HH session and complete resume repair

1 ноября 2026 / November 1, 2026. Код / Code: `e9da033`.

## Русский

После первого выпуска автопоиска чтение «Моих резюме» возвращало HTTP 403.
Заголовок `Server: ddos-guard` оказался недостаточным доказательством сетевой
блокировки: страница показывала форму повторного входа HH. Пользователь прошёл
личный вход по временной ссылке бота. Штатный сервис подтвердил сессию и восстановил
прежнее основное резюме. Новое резюме вместо него не выбиралось.

После входа обнаружен отдельный дефект: новый HH editor хранит карьерные блоки
без прежних h2/h3. Старый fallback извлекал часть структурированного состояния,
а строгий режим правильно отказывался считать этот снимок полным.
Reader теперь распознаёт полное состояние, привязанное к точному hash выбранного
резюме. Он сохраняет компании, должности, даты и описания всех записей опыта,
оба списка навыков, уровни навыков, образование, языки, «О себе» и известные
предпочтения работы. Контакты, имя и фотография остаются внутри browser context.

Проверка полноты требует явных типизированных массивов и отсутствия hiddenFields
и загрузки. Неполный legacy SSR остаётся недоступным для автоматических откликов.
Неподдерживаемые непустые курсы или сертификаты также останавливают чтение;
пропускать их молча reader не будет. Разметка и состояние HH остаются недоверенными.
Кнопки, личные права, подтверждения и правила отправки не менялись.

Проверки и установка:

- Синтетический reader: 10/10. Windows browser: 101 успешно, 10 Linux-only
  пропусков; новый Linux-образ: 111/111 без пропусков.
- Серверные проверки RPC и resume context: 7 успешно, 2 PostgreSQL-сценария
  пропущены без отдельной БД; серверный код в этом исправлении не менялся.
- Живое резюме вернуло HTTP 200: все 6 записей опыта, 29 keySkills,
  34 resumeApplicantSkills, 2 записи образования и 2 языка. Отдельно проверено
  включение исходных компаний, дат, описаний, навыков и «О себе» без потери текста.
- На DE установлен `jarvis-complete-resume-browser:e9da033`. Переменные окружения,
  mount sources, постоянный профиль и sandbox сохранены; browser healthy.
  После установки серверный RPC `requireComplete:true` успешно прочитал резюме.
- Исходники Windows и обоих VPS синхронизированы с main. Server, collector,
  Desktop, VPN и Host Agent не требовали обновления.
- Ранее включённый и не поставленный пользователем на паузу поиск возвращён
  из attention в расписание; checkpoint и фильтры сохранены. Автопоиск с LLM
  остаётся выключенным до личного включения пользователем.
- Серверная проверка состояния автопоиска: `available:true`, `reason:null`.
  Старый незавершённый проход истории встретил `JOB_COLLECTION_WINDOW_EXPIRED`;
  его диапазон не объявлен прочитанным. Сбор свежих вакансий работает отдельной
  очередью; сохранённые диапазоны не удалялись.

Первый реальный автоматический отклик работодателю ещё не проверен.
Содержимое резюме, cookies, телефон, пароль и login ticket в запись не включены.
Ранее обнаруженный отказ HH больше не препятствует полному чтению этого профиля.

## English

After the initial autonomous-search release, My resumes returned HTTP 403.
The `Server: ddos-guard` header alone did not prove a network block: the page
displayed HH's sign-in form. The user completed personal sign-in through the
bot's temporary link. The existing service confirmed the session and restored
the previously selected primary resume.

A separate reader defect then surfaced. The new HH editor uses career cards
without the old h2/h3 structure. The legacy fallback extracted only part of the
structured state, so strict mode correctly refused to call it complete.
The reader now recognizes complete state bound to the selected resume hash.
It preserves every experience entry's company, role, dates and description,
both skill lists and skill levels, education, languages, About and known work
preferences. Contacts, personal name and photo stay inside the browser context.

Completeness requires explicitly typed arrays, no hiddenFields and no loading.
Partial legacy SSR remains unavailable to autonomous applications. Nonempty
courses or certificates with unsupported schemas also stop reading instead of
being silently omitted. HH content stays untrusted. Buttons, personal access,
confirmations and submission rules are unchanged.

Verification and deployment:

- Synthetic reader: 10/10. Windows browser: 101 passed, ten Linux-only skips.
  New Linux image: 111/111 with no skips.
- Server RPC/resume-context checks: seven passed, two PostgreSQL checks skipped
  without a dedicated test database. No server code changed in this repair.
- The live resume returned HTTP 200 with all six experience entries, 29 keySkills,
  34 resumeApplicantSkills, two education entries and two languages. Original
  companies, dates, descriptions, skills and About text were checked for inclusion.
- DE runs `jarvis-complete-resume-browser:e9da033`. Environment, mount sources,
  persistent profile and sandbox were preserved; browser is healthy. Installed
  server RPC successfully read the resume with `requireComplete:true`.
- Windows and both VPS sources are synchronized with main. Server, collector,
  Desktop, VPN and Host Agent needed no update.
- The previously active, unpaused search was rescheduled from attention while
  retaining its checkpoint and filters. LLM automation remains off pending
  personal activation.
- Server automation state reports `available:true`, `reason:null`. An old
  unfinished history pass encountered `JOB_COLLECTION_WINDOW_EXPIRED`; its range
  was not marked complete. Fresh collection uses a separate queue. Saved ranges
  were not deleted.

The first real autonomous employer application remains unverified. No resume
contents, cookies, phone, password or login ticket are included in this record.
The earlier HH refusal no longer prevents complete reading for this profile.
