import { createJobResumePanel } from './jobResumes.js';
const UUID = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;

function button(parent, label, handler, className = 'secondary') {
  const node = document.createElement('button'); node.type = 'button'; node.className = className; node.textContent = label;
  node.addEventListener('click', () => { Promise.resolve(handler()).catch((error) => { parent.closest('.job-panel')?.querySelector('[data-job-status]')?.replaceChildren(document.createTextNode(error.message || 'Не удалось выполнить действие.')); }); });
  parent.append(node); return node;
}

function sessionKey(actor, kind) { return `jarvis-job-login:${kind}:${actor.telegramId}`; }
function safeSessionId(actor) {
  try { const value = sessionStorage.getItem(sessionKey(actor, 'session')); return UUID.test(value || '') ? value : null; }
  catch { return null; }
}

export function createJobConnectionPanel({ api, actor, anchor }) {
  let sessionId = safeSessionId(actor); let timer = null; let busy = false; let changing = false; let disposed = false;
  let generation = 0; let loadSequence = 0; let pollSequence = 0;
  const panel = document.createElement('section'); panel.className = 'job-panel';
  const heading = document.createElement('h2'); heading.textContent = 'Личный профиль HH';
  const status = document.createElement('p'); status.className = 'muted job-status'; status.dataset.jobStatus = '';
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const controls = document.createElement('div'); controls.className = 'job-controls job-connection-controls';
  const connectButton = button(controls, sessionId ? 'Создать ссылку для входа' : 'Подключить HH', start, 'primary');
  const linkBox = document.createElement('div'); linkBox.className = 'job-login-share'; linkBox.hidden = true;
  const link = document.createElement('a'); link.className = 'primary job-login-link'; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Открыть окно входа HH';
  const linkValue = document.createElement('input'); linkValue.type = 'url'; linkValue.readOnly = true; linkValue.className = 'job-login-link-value';
  linkValue.setAttribute('aria-label', 'Временная ссылка входа HH'); linkValue.addEventListener('focus', () => linkValue.select());
  const share = document.createElement('div'); share.className = 'job-controls';
  const refreshLink = button(share, 'Создать ссылку для телефона или ПК', () => start(), 'secondary');
  async function copyLinkToClipboard() {
    if (!link.href) throw new Error('Сначала создай ссылку для входа.');
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(link.href);
      message('Ссылка скопирована. Открой её только на своём телефоне или ПК в течение пяти минут.');
    } else {
      linkValue.focus(); linkValue.select();
      message('Ссылка выделена. Скопируй её и открой только на своём телефоне или ПК в течение пяти минут.');
    }
  }
  const copyLink = button(share, 'Скопировать ссылку', async () => {
    await copyLinkToClipboard();
  });
  const shareLink = button(share, 'Поделиться ссылкой', async () => {
    if (!link.href) throw new Error('Сначала создай ссылку для входа.');
    if (typeof navigator.share !== 'function') { await copyLinkToClipboard(); return; }
    await navigator.share({ title: 'Вход в HH', text: 'Временная ссылка для подключения моего HH к Jarvis', url: link.href });
  });
  linkBox.append(link, linkValue, share);
  const resumes = document.createElement('div'); resumes.className = 'job-resume-controls'; resumes.hidden = true;
  const resumeLabel = document.createElement('label'); resumeLabel.textContent = 'Основное резюме';
  const select = document.createElement('select'); select.setAttribute('aria-label', 'Основное резюме HH'); resumeLabel.append(select);
  resumes.append(resumeLabel);
  const confirm = button(resumes, 'Сохранить профиль', finish, 'primary');
  select.addEventListener('change', () => { confirm.disabled = !select.value; });
  const cancel = button(controls, 'Отменить подключение', cancelLogin); cancel.hidden = true;
  panel.append(heading, status, controls, linkBox, resumes); anchor.after(panel);
  const resumeManager=createJobResumePanel({api,actor,parent:panel});

  function message(value) { if (!disposed) status.textContent = value; }
  function store(key, value) { try { sessionStorage.setItem(sessionKey(actor, key), value); } catch {} }
  function clear(key) { try { sessionStorage.removeItem(sessionKey(actor, key)); } catch {} }
  function setSession(id) { sessionId = id; if (id) store('session', id); else clear('session'); }
  function clearTimer() { if (timer) clearTimeout(timer); timer = null; }
  function invalidate() { generation++; loadSequence++; pollSequence++; clearTimer(); return generation; }
  function current(token, id = sessionId) { return !disposed && token === generation && id === sessionId; }
  function showLink(ticket, delivery) {
    const target = new URL('/mini/job-connect/', location.origin);
    target.hash = new URLSearchParams({ ticket }).toString();
    link.href = target.href;
    linkValue.value = target.href;
    linkBox.hidden = false; refreshLink.hidden = false; copyLink.hidden = false; shareLink.hidden = false; cancel.hidden = false;
    connectButton.textContent = 'Показать текущую ссылку';
    refreshLink.textContent = 'Показать текущую ссылку';
    const notification = delivery === 'sent' ? 'Ссылка также отправлена тебе в личный Telegram.'
      : delivery === 'failed' ? 'Ссылку не удалось отправить в Telegram. Открой её здесь.'
        : delivery === 'unknown' ? 'Telegram не подтвердил доставку. Повторно сообщение не отправляем; открой ссылку здесь.' : '';
    message(`Открой окно HH на своём телефоне или ПК. ${notification} Ссылка действует 5 минут с создания; повторное нажатие не продлевает срок. Не пересылай её другим.`);
  }
  async function start() {
    if (busy || changing || disposed) return;
    const token = invalidate();
    busy = true; refreshLink.disabled = true; connectButton.disabled = true; panel.setAttribute('aria-busy', 'true'); message('Готовим временную ссылку для входа…');
    try {
      let requestId;
      try { requestId = sessionStorage.getItem(sessionKey(actor, 'request')); } catch {}
      if (!UUID.test(requestId || '')) requestId = crypto.randomUUID();
      store('request', requestId);
      const created = await api.request('/jobs/login', 'POST', { requestId });
      if (!current(token)) return;
      if (created.status === 'connected') {
        setSession(null); clear('request');
        await load(); return;
      }
      if (['expired','cancelled','revoked','failed'].includes(created.status)) {
        clear('request'); setSession(null); linkBox.hidden = true;
        throw new Error('Предыдущая ссылка завершена. Нажми «Подключить HH», чтобы создать новую.');
      }
      if (!created.sessionId) throw new Error('Не удалось подготовить ссылку. Нажми ещё раз.');
      setSession(created.sessionId);
      if (created.ticket) showLink(created.ticket, created.telegramDelivery);
      else { linkBox.hidden = true; cancel.hidden = false; message('Вход уже открыт. Продолжи в этом окне или отмени подключение, чтобы создать новую ссылку.'); }
      void poll();
    } catch (error) {
      if (!current(token)) return;
      if (sessionId) void poll();
      throw error;
    } finally {
      busy = false;
      if (current(token)) {
        refreshLink.disabled = false; connectButton.disabled = false; panel.setAttribute('aria-busy', 'false');
      }
    }
  }
  async function load() {
    if (disposed) return;
    const token = generation;
    const sequence = ++loadSequence;
    let data;
    try { data = await api.request('/jobs/connection'); }
    catch (error) {
      if (!current(token) || sequence !== loadSequence) return;
      throw error;
    }
    if (!current(token) || sequence !== loadSequence) return;
    if (!data.available) { message('Личное подключение HH временно не настроено.'); controls.hidden = true; linkBox.hidden = true; return; }
    if (data.connected) {
      setSession(null); clear('request'); clearTimer();
      controls.hidden = true; linkBox.hidden = true; resumes.hidden = true;
      message('HH подключён. Резюме и настройки обновления доступны ниже. Профиль хранится в твоём личном пространстве.');
      resumeManager.show();
      return;
    }
    controls.hidden = false;
    resumeManager.hide();
    if (sessionId) { connectButton.hidden = false; message('Проверяем состояние входа HH…'); void poll(); return; }
    message('Подключи свой профиль HH. Войти можно с телефона или компьютера через защищённую временную ссылку.');
    connectButton.hidden = false; connectButton.textContent = 'Подключить HH';
  }
  async function poll() {
    clearTimer(); if (!sessionId || disposed) return;
    const token = generation;
    const id = sessionId;
    const sequence = ++pollSequence;
    try {
      const state = await api.request(`/jobs/login/owned/status/${encodeURIComponent(id)}`);
      if (!current(token, id) || sequence !== pollSequence) return;
      if (state.status === 'confirmed') { invalidate(); setSession(null); clear('request'); await load(); return; }
      if (state.status === 'authenticated') {
        select.replaceChildren();
        const choices = state.resumes || [];
        if (choices.length > 1) {
          const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.disabled = true;
          placeholder.selected = true; placeholder.textContent = 'Выбери основное резюме'; select.append(placeholder);
        }
        for (const item of choices) { const option = document.createElement('option'); option.value = item.id; option.textContent = item.title; select.append(option); }
        confirm.disabled = choices.length !== 1;
        linkBox.hidden = true; controls.hidden = false; connectButton.hidden = true; cancel.hidden = false; resumes.hidden = false;
        message('Вход HH подтверждён. Выбери основное резюме, чтобы завершить подключение.'); return;
      }
      if (['cancelled','expired','revoked','failed'].includes(state.status) || ['expired','closed'].includes(state.state)) {
        invalidate();
        setSession(null); clear('request'); linkBox.hidden = true; resumes.hidden = true; cancel.hidden = true;
        connectButton.hidden = false; connectButton.textContent = 'Подключить HH';
        message('Сессия входа завершилась. Нажми «Подключить HH», чтобы начать заново.'); return;
      }
      connectButton.hidden = false; connectButton.textContent = 'Создать ссылку для входа';
      if (state.status === 'claimed') message(state.state === 'captcha'
        ? 'HH просит пройти дополнительную проверку в окне входа.'
        : 'Ожидаем вход в HH. Вернись сюда после завершения, затем выбери резюме.');
      timer = setTimeout(() => { void poll(); }, 2000);
    } catch (error) {
      if (!current(token, id) || sequence !== pollSequence) return;
      if (['unauthorized','forbidden','JOB_ACCESS_REVOKED','JOB_LOGIN_SESSION_INVALID','JOB_LOGIN_SESSION_EXPIRED'].includes(error.code)) {
        invalidate();
        setSession(null); clear('request'); linkBox.hidden = true; resumes.hidden = true; cancel.hidden = true;
        connectButton.hidden = false; connectButton.textContent = 'Подключить HH';
        message(error.message || 'Сессия входа недоступна. Запусти подключение снова.'); return;
      }
      message(error.message || 'Не удалось проверить вход. Повторяем…');
      timer = setTimeout(() => { void poll(); }, 3000);
    }
  }
  async function finish() {
    if (!sessionId || !select.value || busy || changing || disposed) return;
    const id = sessionId;
    const token = invalidate();
    changing = true;
    confirm.disabled = true;
    try {
      await api.request('/jobs/login/confirm', 'POST', { sessionId: id, resumeId: select.value });
      if (!current(token, id)) return;
      setSession(null); clear('request'); clearTimer(); resumes.hidden = true; controls.hidden = true; linkBox.hidden = true;
      message('Профиль HH подключён.'); await load();
    } catch (error) {
      if (!current(token)) return;
      throw error;
    } finally {
      changing = false;
      if (!disposed && token === generation) {
        confirm.disabled = false;
        if (sessionId === id) void poll();
      }
    }
  }
  async function cancelLogin() {
    if (!sessionId || busy || changing || disposed) return;
    const id = sessionId;
    const token = invalidate();
    changing = true;
    cancel.disabled = true;
    try {
      const result = await api.request('/jobs/login/cancel', 'POST', { sessionId: id });
      if (!current(token, id)) return;
      setSession(null); clear('request'); clearTimer(); linkBox.hidden = true; resumes.hidden = true; cancel.hidden = true;
      connectButton.hidden = false; connectButton.textContent = 'Подключить HH';
      if (result.status === 'connected') { clear('request'); message('Профиль HH уже подключён.'); await load(); }
      else message('Подключение отменено.');
    } catch (error) {
      if (!current(token)) return;
      throw error;
    } finally {
      changing = false;
      if (!disposed && token === generation) {
        cancel.disabled = false;
        if (sessionId === id) void poll();
      }
    }
  }
  void load().catch((error) => message(error.message || 'Не удалось загрузить состояние HH.'));
  return { dispose() { disposed = true; invalidate(); resumeManager.dispose(); panel.remove(); } };
}
