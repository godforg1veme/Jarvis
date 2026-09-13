(function lifeOsModule() {
  const cloud = window.jarvisCloud;
  const root = document.getElementById('life-os');
  const content = document.getElementById('life-os-content');
  const sync = document.getElementById('life-os-sync');
  if (!root || !content) return;

  const state = { view: 'mission', mission: null, bootstrap: null, timeline: [], nextCursor: null, projectId: null, busy: false };
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (text, className, handler, label = '') => {
    const node = el('button', className, text); node.type = 'button';
    if (label) node.setAttribute('aria-label', label);
    node.addEventListener('click', handler); return node;
  };
  const formatDate = (value, includeTime = true) => value ? new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit', month: 'short', ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(new Date(value)) : 'Без срока';
  const sourceLabel = (source) => ({ telegram: 'Telegram', desktop: 'Desktop', vision: 'Vision', knowledge: 'Документ', device: 'Устройство', orchestrator: 'Действие', life_os: 'Life OS' }[source] || source);

  function setSync(text, tone = '') { sync.textContent = text; sync.className = `life-os-sync${tone ? ` is-${tone}` : ''}`; }
  function setView(view) {
    state.view = view;
    document.querySelectorAll('[data-life-view]').forEach((item) => item.classList.toggle('is-active', item.dataset.lifeView === view));
  }
  function viewHead(kicker, title) {
    const head = el('header', 'life-view-head');
    const copy = el('div'); copy.append(el('p', 'life-kicker', kicker), el('h3', '', title));
    head.append(copy, el('time', 'life-view-date', new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()).toUpperCase()));
    return head;
  }
  function empty(title, detail) { const node = el('div', 'life-empty'); node.append(el('strong', '', title), el('span', '', detail)); return node; }
  function section(title, count) {
    const node = el('section', 'life-section');
    const heading = el('h4', 'life-section-title'); heading.append(el('span', '', title), el('span', 'life-count', String(count)));
    node.append(heading); return node;
  }
  function chip(text, tone = '') { return el('span', `life-chip${tone ? ` is-${tone}` : ''}`, text); }

  function projectCard(project) {
    const area = state.mission?.areas?.find((item) => item.id === project.areaId);
    const card = button('', 'life-project-card', () => openProject(project.id), `Открыть контекст проекта ${project.name}`);
    card.append(el('small', '', `${area?.name || 'БЕЗ ОБЛАСТИ'} · ${project.status.toUpperCase()}`), el('h4', '', project.name), el('p', '', project.summary || 'Контекст будет собираться из событий, документов и договорённостей.'));
    const progress = el('div', 'life-progress'); const bar = el('span'); bar.style.width = project.status === 'completed' ? '100%' : project.status === 'paused' ? '36%' : '64%'; progress.append(bar); card.append(progress);
    return card;
  }

  function eventRow(event, feedback = false) {
    const row = el('article', 'life-row');
    row.append(el('time', 'life-row-time', formatDate(event.occurredAt)));
    const body = el('div'); body.append(el('h4', '', event.summary));
    const metadata = el('div'); metadata.append(chip(sourceLabel(event.source), event.trust === 'trusted' ? 'trusted' : event.trust === 'inferred' ? 'inferred' : ''));
    metadata.append(chip(`${Math.round(event.confidence * 100)}%`));
    for (const link of (event.links || []).slice(0, 2)) metadata.append(chip(`${link.targetType} · ${link.origin}`, link.origin));
    body.append(metadata); row.append(body);
    if (feedback) {
      const controls = el('div', 'life-row-controls');
      controls.append(button('Не тот проект', 'life-row-action', async () => {
        const result = await cloud.recordLifeFeedback(event.id, { kind: 'wrong_project', note: '' });
        if (result?.ok) await loadTimeline();
      }, `Отметить неверную связь проекта для события ${event.summary}`));
      controls.append(button('Скрыть', 'life-row-action', async () => {
        const result = await cloud.recordLifeFeedback(event.id, { kind: 'dismissed', note: '' });
        if (result?.ok) { state.timeline = state.timeline.filter((item) => item.id !== event.id); renderTimeline(); }
      }, `Скрыть событие ${event.summary}`));
      row.append(controls);
    }
    return row;
  }

  function commitmentRow(item) {
    const row = el('article', 'life-row'); row.append(el('time', 'life-row-time', formatDate(item.dueAt)));
    const body = el('div'); body.append(el('h4', '', item.title));
    const meta = el('div'); if (item.projectName) meta.append(chip(item.projectName)); meta.append(chip(`${Math.round(item.confidence * 100)}%`, item.confidence < .8 ? 'inferred' : 'trusted')); body.append(meta); row.append(body);
    row.append(button('Готово', 'life-row-action', async () => {
      const result = await cloud.updateLifeCommitment(item.id, item.revision, 'completed');
      if (result?.ok) await refreshMission();
    }, `Отметить выполненным: ${item.title}`));
    return row;
  }

  function proposalCard(proposal) {
    const card = el('article', 'life-proposal'); card.append(el('p', 'life-kicker', proposal.risk === 'changing' ? 'ТРЕБУЕТ ПОДТВЕРЖДЕНИЯ' : 'БЕЗОПАСНОЕ ПРЕДЛОЖЕНИЕ'), el('h4', '', proposal.title), el('p', '', proposal.explanation));
    const evidence = el('div', 'life-evidence', proposal.evidence?.length ? `Основания: ${proposal.evidence.map((item) => item.summary).join(' · ')}` : 'Основание сохранено в Event Spine.'); card.append(evidence);
    const actions = el('div', 'life-actions');
    actions.append(button(proposal.risk === 'changing' ? 'Подтвердить действие' : 'Принять', 'life-button-primary', async () => mutateProposal(proposal, 'confirm')),
      button('Не сейчас', 'life-button-quiet', async () => mutateProposal(proposal, 'dismiss')));
    card.append(actions); return card;
  }

  async function mutateProposal(proposal, action) {
    setSync('Сохраняю решение…');
    const result = action === 'confirm' ? await cloud.confirmLifeProposal(proposal.id, proposal.revision) : await cloud.dismissLifeProposal(proposal.id, proposal.revision);
    if (!result?.ok) { setSync(result?.error || 'Не удалось сохранить', 'error'); return; }
    await refreshMission();
  }

  function renderMission() {
    const data = state.mission;
    content.replaceChildren(viewHead('01 / ACTIVE CONTEXT', 'Что важно сейчас'));
    const layout = el('div', 'life-grid'); const primary = el('div', 'life-stack'); const secondary = el('aside', 'life-stack');
    if (data.currentMission) {
      const mission = el('article', 'life-mission'); mission.append(el('span', 'life-mission-index', 'CURRENT MISSION / 001'), el('h4', '', data.currentMission.name), el('p', '', data.currentMission.summary || 'Jarvis собирает решения, договорённости и последние действия в один продолжимый контекст.'), button('Продолжить с контекстом →', '', () => openProject(data.currentMission.id)));
      primary.append(mission);
    } else primary.append(empty('Нет активной миссии', 'Создайте проект — Jarvis начнёт связывать с ним события и договорённости.'));
    const projectSection = section('Активные проекты', data.projects.length); const projects = el('div', 'life-project-list'); data.projects.slice(0, 6).forEach((item) => projects.append(projectCard(item))); projectSection.append(projects); primary.append(projectSection);
    const eventSection = section('Последние сигналы', data.recentEvents.length); if (data.recentEvents.length) data.recentEvents.slice(0, 7).forEach((item) => eventSection.append(eventRow(item))); else eventSection.append(empty('Timeline пока пуст', 'События появятся после сообщения, голоса, Vision или действия.')); primary.append(eventSection);
    const proposalSection = section('Предложения', data.proposals.length); if (data.proposals.length) data.proposals.slice(0, 4).forEach((item) => proposalSection.append(proposalCard(item))); else proposalSection.append(empty('Ничего не требует решения', 'Jarvis покажет здесь только объяснимые предложения с основаниями.')); secondary.append(proposalSection);
    const commitmentSection = section('Договорённости', data.commitments.length); if (data.commitments.length) data.commitments.slice(0, 8).forEach((item) => commitmentSection.append(commitmentRow(item))); else commitmentSection.append(empty('Открытых договорённостей нет', 'Фразы вроде «завтра продолжу…» появятся здесь с источником и уверенностью.')); secondary.append(commitmentSection);
    const deviceSection = section('Исполнительный контур', data.devices.length); data.devices.forEach((device) => { const row = el('article', 'life-row'); row.append(el('span', 'life-row-time', device.status === 'online' ? 'ONLINE' : 'OFFLINE')); const body = el('div'); body.append(el('h4', '', device.name), el('p', '', device.status === 'online' ? 'Готов выполнять подтверждённые действия' : 'Локальные действия недоступны')); row.append(body); deviceSection.append(row); }); secondary.append(deviceSection);
    layout.append(primary, secondary); content.append(layout); content.focus();
  }

  function renderTimeline() {
    content.replaceChildren(viewHead('02 / LIVING TIMELINE', 'Память в движении'));
    const sectionNode = section('Значимые события', state.timeline.length);
    if (!state.timeline.length) sectionNode.append(empty('Событий пока нет', 'Напишите Jarvis или включите разрешённый источник — лента соберётся автоматически.'));
    else state.timeline.forEach((item) => sectionNode.append(eventRow(item, true)));
    if (state.nextCursor) sectionNode.append(button('Показать более ранние события', 'life-button-quiet', loadMoreTimeline));
    content.append(sectionNode); content.focus();
  }

  function renderProjects() {
    const projects = state.mission?.projects || state.bootstrap?.projects || [];
    content.replaceChildren(viewHead('03 / PROJECT SPACE', 'Проекты и области'));
    const sectionNode = section('Все активные направления', projects.length); const grid = el('div', 'life-project-list'); projects.forEach((item) => grid.append(projectCard(item))); sectionNode.append(projects.length ? grid : empty('Создайте первый проект', 'Он станет устойчивым контейнером для событий, документов и следующих шагов.')); content.append(sectionNode); content.focus();
  }

  function renderContext(context) {
    setView('projects'); content.replaceChildren(viewHead('PROJECT / CONTEXT RECOVERY', context.project.name));
    const layout = el('div', 'life-grid'); const primary = el('div', 'life-stack'); const secondary = el('aside', 'life-stack');
    const continuation = el('article', 'life-mission'); continuation.append(el('span', 'life-mission-index', 'LAST CONTINUATION POINT'), el('h4', '', context.continuation?.summary || 'Контекст проекта ещё формируется'), el('p', '', context.project.summary || 'Jarvis отделяет проверенные результаты, ваши исходные формулировки и машинные выводы.')); primary.append(continuation);
    const facts = section('Проверенные факты', context.verifiedFacts.length); context.verifiedFacts.forEach((item) => facts.append(eventRow(item))); if (!context.verifiedFacts.length) facts.append(empty('Пока без проверенных результатов', 'Успешные действия и индексированные документы появятся здесь.')); primary.append(facts);
    const user = section('Ваш контекст', context.userContext.length); context.userContext.forEach((item) => user.append(eventRow(item))); primary.append(user);
    const commitments = section('Открытые договорённости', context.commitments.length); context.commitments.forEach((item) => commitments.append(commitmentRow(item))); secondary.append(commitments);
    const documents = section('Связанные документы', context.documents?.length || 0); (context.documents || []).forEach((document) => { const row = el('article', 'life-row'); row.append(el('span', 'life-row-time', document.status?.toUpperCase() || 'READY')); const body = el('div'); body.append(el('h4', '', document.name), el('p', '', `${document.category || 'document'} · источник знаний`)); row.append(body); documents.append(row); }); secondary.append(documents);
    const inferences = section('Машинные связи', context.inferredLinks.length); context.inferredLinks.forEach((item) => inferences.append(eventRow(item))); if (context.inferredLinks.length) secondary.append(inferences);
    const suggestions = section('Предлагаемый следующий шаг', context.suggestedNextSteps.length); context.suggestedNextSteps.forEach((item) => { const card = el('article', 'life-proposal'); card.append(el('h4', '', item.title), el('p', '', item.explanation)); suggestions.append(card); }); if (!context.suggestedNextSteps.length) suggestions.append(empty('Нет навязанных шагов', 'Jarvis предложит действие только при наличии достаточного основания.')); secondary.append(suggestions);
    layout.append(primary, secondary); content.append(layout); content.focus();
  }

  function renderError(message) {
    content.replaceChildren(viewHead('CONNECTION / RECOVERY', 'Mission Control недоступен'));
    const node = el('div', 'life-error'); node.append(el('strong', '', 'Облачный контекст не загрузился'), el('span', '', message || 'Проверьте подключение. Локальные действия не будут запущены без подтверждения.'), button('Повторить', 'life-button-quiet', refreshMission)); content.append(node); content.focus();
  }

  async function refreshMission() {
    if (state.busy) return; state.busy = true; setSync('Синхронизация…');
    try {
      const [mission, bootstrap] = await Promise.all([cloud.getMissionControl(), cloud.getLifeBootstrap()]);
      if (!mission?.ok) throw new Error(mission?.error || 'Нет соединения');
      state.mission = mission.missionControl; state.bootstrap = bootstrap?.ok ? bootstrap : state.bootstrap;
      setSync(`Обновлено ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`, 'live');
      if (state.view === 'mission') renderMission(); else if (state.view === 'projects') renderProjects();
    } catch (error) { setSync('Офлайн', 'error'); renderError(error.message); }
    finally { state.busy = false; }
  }

  async function loadTimeline(reset = true) {
    setView('timeline'); setSync('Собираю Timeline…');
    try {
      const result = await cloud.getLifeTimeline({ projectId: state.projectId || '', cursor: reset ? '' : state.nextCursor, limit: 40 });
      if (!result?.ok) throw new Error(result?.error || 'Timeline недоступен');
      state.timeline = reset ? result.items : state.timeline.concat(result.items); state.nextCursor = result.nextCursor;
      setSync('Timeline актуален', 'live'); renderTimeline();
    } catch (error) { setSync('Ошибка Timeline', 'error'); renderError(error.message); }
  }
  const loadMoreTimeline = () => loadTimeline(false);
  async function openProject(projectId) {
    setSync('Восстанавливаю контекст…');
    const result = await cloud.getLifeProjectContext(projectId);
    if (!result?.ok) { renderError(result?.error); return; }
    setSync('Контекст восстановлен', 'live'); renderContext(result.context);
  }

  async function open() {
    root.classList.add('is-open'); root.setAttribute('aria-hidden', 'false'); document.body.classList.add('life-os-open');
    document.getElementById('life-os-close').focus(); await refreshMission();
  }
  function close() { root.classList.remove('is-open'); root.setAttribute('aria-hidden', 'true'); document.body.classList.remove('life-os-open'); document.getElementById('life-os-open').focus(); }

  document.getElementById('life-os-open').addEventListener('click', open);
  document.getElementById('life-os-close').addEventListener('click', close);
  document.querySelectorAll('[data-life-view]').forEach((item) => item.addEventListener('click', async () => {
    const view = item.dataset.lifeView; setView(view);
    if (view === 'mission') { if (state.mission) renderMission(); else await refreshMission(); }
    if (view === 'timeline') await loadTimeline();
    if (view === 'projects') { if (!state.mission) await refreshMission(); else renderProjects(); }
  }));
  root.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !document.getElementById('life-project-dialog').open) close(); });

  const dialog = document.getElementById('life-project-dialog');
  document.getElementById('life-project-new').addEventListener('click', () => {
    const select = document.getElementById('life-project-area'); select.replaceChildren(new Option('Без области', ''));
    for (const area of (state.bootstrap?.areas || state.mission?.areas || [])) select.append(new Option(area.name, area.id));
    dialog.showModal(); document.getElementById('life-project-name').focus();
  });
  document.getElementById('life-project-form').addEventListener('submit', async (event) => {
    if (event.submitter?.value === 'cancel') return;
    event.preventDefault();
    const name = document.getElementById('life-project-name').value.trim(); if (!name) return;
    const result = await cloud.createLifeProject({ name, areaId: document.getElementById('life-project-area').value || undefined, summary: document.getElementById('life-project-summary').value.trim() });
    if (!result?.ok) { setSync(result?.error || 'Проект не создан', 'error'); return; }
    dialog.close(); event.target.reset(); setView('projects'); await refreshMission(); renderProjects();
  });
  if (cloud && typeof cloud.onOpenLifeOs === 'function') cloud.onOpenLifeOs(open);
  if (cloud && typeof cloud.onLifeProposal === 'function') cloud.onLifeProposal(async () => {
    if (root.classList.contains('is-open')) await refreshMission();
  });
  window.JarvisLifeOs = { open, close, renderMission, loadTimeline };
}());
