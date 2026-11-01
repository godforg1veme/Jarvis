function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  if (className) element.className = className;
  return element;
}

export function createJobAutomationPanel({ api, parent }) {
  let state = null;
  let busy = false;
  let disposed = false;
  let requestVersion = 0;
  const root = node('section', null, 'job-automation');
  const title = node('h3', 'Автопоиск с LLM');
  const status = node('p', 'Загружаем состояние…', 'job-automation-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const description = node('p', 'При включении Jarvis читает твоё выбранное резюме и подтверждённые факты, оценивает найденные вакансии и сам откликается на подходящие. Неподходящие вакансии пропускает без сообщений. Если нужен тест или дополнительные поля, сообщит в личный Telegram. При расходах API $2 за месяц пришлёт одно уведомление; поиск продолжится. При выключении вакансии снова приходят тебе для ручного отклика.', 'muted');
  const controls = node('div', null, 'job-controls');
  const toggle = node('button', 'Включить автопоиск и автоотклики', 'primary');
  toggle.type = 'button';
  toggle.addEventListener('click', () => { void change().catch(error => showError(error)); });
  const renew = node('button', 'Обновить разрешение', 'secondary');
  renew.type = 'button';
  renew.addEventListener('click', () => { void change(true).catch(error => showError(error)); });
  controls.append(toggle, renew);
  root.append(title, status, description, controls);
  parent.append(root);

  function render() {
    if (disposed) return;
    root.setAttribute('aria-busy', String(busy));
    toggle.disabled = busy || !state || (!state.enabled && state.available === false);
    toggle.className = state?.enabled ? 'secondary' : 'primary';
    toggle.textContent = state?.enabled ? 'Выключить автопоиск' : 'Включить автопоиск и автоотклики';
    renew.hidden = !state?.enabled || state?.available !== false;
    renew.disabled = busy;
    if (state) status.textContent = state.enabled ? state.available === false
      ? 'Автопоиск включён, но выполнение приостановлено. Проверь поиск, подключение HH, выбранное резюме и модель. После смены резюме обнови разрешение.' : 'Автопоиск включён.' : state.available === false
      ? 'Автопоиск выключен. Для включения нужны активный поиск, подключённый HH, выбранное резюме и доступная модель.'
      : 'Автопоиск выключен. Вакансии приходят для ручного отклика.';
  }
  function showError(error) {
    if (disposed) return;
    status.textContent = error?.code === 'conflict' ? 'Состояние изменилось. Загрузили актуальную версию; проверь его перед повторным нажатием.'
      : error?.code === 'forbidden' ? 'Доступ к поиску работы больше не действует.'
        : error?.code === 'unknown' ? 'Результат запроса неизвестен. Сначала проверим текущее состояние; повторное включение не отправлено.'
          : 'Автопоиск пока недоступен. Сначала включи поиск по фразам в боте, подключи HH и выбери основное резюме; затем обнови раздел.';
  }
  async function load() {
    if (disposed) return;
    const version = ++requestVersion;
    busy = true; render();
    try {
      const next = await api.request('/jobs/automation');
      if (disposed || version !== requestVersion) return;
      state = next; render();
    } catch (error) { if (!disposed && version === requestVersion) { state = null; showError(error); } }
    finally { if (!disposed && version === requestVersion) { busy = false; render(); } }
  }
  async function change(requestedState) {
    if (disposed || busy || !state) return;
    const enabled = requestedState === undefined ? !state.enabled : requestedState;
    const expectedRevision = state.revision;
    busy = true; render();
    try {
      const next = await api.request('/jobs/automation', 'POST', { enabled, expectedRevision });
      if (!disposed) state = next;
    } catch (error) {
      // A lost response may follow a successful commit. Read the server state;
      // never send the mutation a second time on an uncertain outcome.
      if (!disposed) {
        try { state = await api.request('/jobs/automation'); }
        catch { state = null; showError(error); }
      }
    } finally { if (!disposed) { busy = false; render(); } }
  }
  const onVisibility = () => { if (!document.hidden && !busy) void load(); };
  document.addEventListener('visibilitychange', onVisibility);
  void load();
  return { dispose() { disposed = true; requestVersion++; document.removeEventListener('visibilitychange', onVisibility); root.remove(); } };
}
