const api = window.jarvisVoiceLab;
const state = {
  settings: null,
  profiles: [],
  metrics: null,
  calibration: { active: false, step: 'idle' },
  preview: { active: false },
  advisor: null,
  test: null,
};
let dirty = false;

const quickFields = [
  { key: 'startRms', range: 'q-start-rms', number: 'q-start-rms-number', output: 'q-start-rms-value', unit: '' },
  { key: 'continueRms', range: 'q-continue-rms', number: 'q-continue-rms-number', output: 'q-continue-rms-value', unit: '' },
  { key: 'silenceMs', range: 'q-silence-ms', number: 'q-silence-ms-number', output: 'q-silence-ms-value', unit: ' мс' },
  { key: 'preRollMs', range: 'q-pre-roll-ms', number: 'q-pre-roll-ms-number', output: 'q-pre-roll-ms-value', unit: ' мс' },
  { key: 'minSpeechMs', range: 'q-min-speech-ms', number: 'q-min-speech-ms-number', output: 'q-min-speech-ms-value', unit: ' мс' },
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getPath(object, path) {
  return path.split('.').reduce((current, key) => current && current[key], object);
}

function setPath(object, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const parent = keys.reduce((current, key) => {
    if (!current[key] || typeof current[key] !== 'object') current[key] = {};
    return current[key];
  }, object);
  parent[last] = value;
}

function el(id) {
  return document.getElementById(id);
}

function showStatus(message, kind) {
  const status = el('lab-status');
  status.textContent = message || 'Готово';
  status.className = ('lab-status ' + (kind || '')).trim();
}

function showResult(result, successMessage) {
  if (!result) return;
  if (result.state) applyState(result.state);
  if (result.ok) showStatus(successMessage || 'Изменения применены.', 'success');
  else showStatus(result.message || result.error || 'Операция не выполнена.', 'error');
}

function draftFromDom() {
  const next = clone(state.settings);
  if (!next) return next;
  for (const field of quickFields) {
    setPath(next, 'fasterWhisper.' + field.key, Number(el(field.number).value));
  }
  next.capture.deviceId = el('capture-device-id').value.trim();
  next.capture.echoCancellation = el('capture-echo').checked;
  next.capture.noiseSuppression = el('capture-noise').checked;
  next.capture.autoGainControl = el('capture-agc').checked;
  next.fasterWhisper.model = el('fw-model').value.trim();
  next.fasterWhisper.device = el('fw-device').value;
  next.fasterWhisper.computeType = el('fw-compute').value.trim();
  next.fasterWhisper.language = el('fw-language').value.trim();
  next.fasterWhisper.performanceProfile = el('fw-performance').value;
  next.fasterWhisper.beamSize = Number(el('fw-beam').value);
  next.fasterWhisper.vadFilter = el('fw-vad').checked;
  next.fasterWhisper.initialPrompt = el('fw-prompt').value;
  next.fasterWhisper.hotwords = el('fw-hotwords').value;
  next.advisor.mode = el('advisor-mode').value;
  next.advisor.minSamples = Number(el('advisor-samples').value);
  next.advisor.cooldownMs = Number(el('advisor-cooldown').value) * 60000;
  next.advisor.allowAudio = el('advisor-audio').checked;
  return next;
}

function setQuickField(field, value) {
  const range = el(field.range);
  const number = el(field.number);
  const output = el(field.output);
  const normalized = Number(value);
  range.value = String(normalized);
  number.value = String(normalized);
  output.textContent = String(normalized) + field.unit;
}

function renderProfiles() {
  const select = el('profile-select');
  const selected = select.value;
  select.textContent = '';
  const emptyOption = document.createElement('option');
  emptyOption.value = '';
  emptyOption.textContent = 'Выбрать сохранённый профиль';
  select.appendChild(emptyOption);
  for (const profile of state.profiles || []) {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = profile.name;
    select.appendChild(option);
  }
  if ([...select.options].some((option) => option.value === selected)) select.value = selected;
}

function renderSettings() {
  if (!state.settings) return;
  const fw = state.settings.fasterWhisper;
  const capture = state.settings.capture;
  const advisor = state.settings.advisor;
  for (const field of quickFields) setQuickField(field, fw[field.key]);
  el('capture-device-id').value = capture.deviceId || '';
  el('capture-echo').checked = capture.echoCancellation !== false;
  el('capture-noise').checked = capture.noiseSuppression !== false;
  el('capture-agc').checked = capture.autoGainControl === true;
  el('fw-model').value = fw.model || '';
  el('fw-device').value = fw.device || 'cuda';
  el('fw-compute').value = fw.computeType || '';
  el('fw-language').value = fw.language || 'ru';
  el('fw-performance').value = fw.performanceProfile || 'quality';
  el('fw-beam').value = String(fw.beamSize || 5);
  el('fw-beam-value').textContent = String(fw.beamSize || 5);
  el('fw-vad').checked = fw.vadFilter !== false;
  el('fw-prompt').value = fw.initialPrompt || '';
  el('fw-hotwords').value = fw.hotwords || '';
  el('advisor-mode').value = advisor.mode || 'problems-only';
  el('advisor-samples').value = String(advisor.minSamples || 20);
  el('advisor-cooldown').value = String(Math.round((advisor.cooldownMs || 1800000) / 60000));
  el('advisor-audio').checked = advisor.allowAudio === true;
  renderProfiles();
}

function applyState(nextState) {
  if (!nextState) return;
  Object.assign(state, nextState);
  renderSettings();
  renderCalibration();
  renderAdvisor();
  updateMetrics(state.metrics);
  dirty = false;
}

function updateMetrics(metrics) {
  if (!metrics) return;
  state.metrics = metrics;
  const meter = metrics.current || {};
  const rms = Number(meter.rms || 0);
  const noise = Number(metrics.noiseFloor || meter.noiseFloor || 0);
  el('signal-level').style.width = String(Math.min(100, Math.round(rms * 1000))) + '%';
  el('noise-level').style.width = String(Math.min(100, Math.round(noise * 1600))) + '%';
  el('signal-rms').textContent = rms.toFixed(3);
  el('snr-value').textContent = Number(metrics.signalToNoiseDb || meter.signalToNoiseDb || 0).toFixed(1) + ' дБ';
  el('signal-state').textContent = meter.state === 'speech' ? 'Речь' : meter.state === 'noise' ? 'Шум' : 'Тишина';
  el('quality-state').textContent = metrics.quality === 'good' ? 'Хорошо' : metrics.quality === 'fair' ? 'Средне' : metrics.quality === 'poor' ? 'Слабо' : 'Нет данных';
  el('signal-state').className = meter.state === 'speech' ? 'good' : meter.state === 'noise' ? 'warn' : '';
  el('quality-state').className = metrics.quality === 'good' ? 'good' : metrics.quality === 'poor' ? 'bad' : 'warn';
}

function renderCalibration() {
  const calibration = state.calibration || {};
  const step = calibration.step || 'idle';
  document.querySelectorAll('#calibration-steps li').forEach((item) => {
    const itemStep = item.dataset.step;
    item.classList.toggle('active', itemStep === step);
    item.classList.toggle('done', (itemStep === 'quiet' && ['speech', 'complete'].includes(step))
      || (itemStep === 'speech' && step === 'complete'));
  });

  const badge = el('calibration-badge');
  const action = el('calibration-action');
  if (step === 'quiet') {
    badge.textContent = 'Слушаю фон';
    badge.className = 'status-chip warn';
    el('calibration-message').textContent = 'Помолчите 3–5 секунд, затем нажмите кнопку перехода к речи.';
    action.textContent = 'Фон измерен, перейти к речи';
  } else if (step === 'speech') {
    badge.textContent = 'Слушаю речь';
    badge.className = 'status-chip warn';
    el('calibration-message').textContent = 'Произнесите 3–5 обычных команд, затем завершите калибровку.';
    action.textContent = 'Завершить и применить кандидат';
  } else if (step === 'complete') {
    badge.textContent = 'Кандидат готов';
    badge.className = 'status-chip good';
    el('calibration-message').textContent = 'Новый профиль временно применён. Проверьте его кнопкой тестирования.';
    action.textContent = 'Начать новую калибровку';
  } else {
    badge.textContent = 'Готов';
    badge.className = 'status-chip';
    el('calibration-message').textContent = 'Нажмите «Автокалибровка», затем следуйте подсказкам.';
    action.textContent = 'Начать калибровку';
  }
}

function renderAdvisor() {
  const advisor = state.advisor || {};
  const configured = advisor.configured === true;
  el('gemini-state').textContent = configured
    ? advisor.mode === 'problems-only' ? 'Только при проблемах' : advisor.mode === 'manual' ? 'Только вручную' : 'Выключен'
    : 'Ключ не настроен';
  el('gemini-detail').textContent = configured
    ? (advisor.allowAudio ? 'Метрики + разрешённый глубокий анализ' : 'Аудио не отправляется')
    : 'Локальная калибровка доступна';
  const audio = state.recentAudio || {};
  el('audio-buffer-state').textContent = audio.available ? 'Буфер ' + audio.durationMs + ' мс' : 'Аудио не сохраняется';
  el('audio-buffer-state').className = ('status-chip ' + (audio.available ? 'warn' : '')).trim();
  if (advisor.lastResult && advisor.lastResult.explanation) {
    el('advisor-message').textContent = advisor.lastResult.explanation;
  }
}

async function refresh() {
  const result = await api.getState();
  if (!result || !result.ok) {
    showStatus((result && (result.error || result.message)) || 'Не удалось получить состояние Voice Lab.', 'error');
    return;
  }
  applyState(result.state);
  el('runtime-state').textContent = result.state && result.state.settings && result.state.settings.provider === 'faster-whisper' ? 'Faster Whisper' : 'Vosk';
  el('runtime-state').className = 'status-chip good';
}

async function applyPreview() {
  const next = draftFromDom();
  const result = await api.setPreview(next);
  showResult(result);
  if (result && result.ok) state.settings = next;
  return result;
}

async function handleCalibration() {
  const step = state.calibration && state.calibration.step || 'idle';
  let result;
  if (step === 'idle' || step === 'complete') result = await api.startCalibration();
  else if (step === 'quiet') result = await api.nextCalibration();
  else result = await api.finishCalibration();
  showResult(result, step === 'speech' ? 'Кандидат применён временно.' : 'Состояние калибровки обновлено.');
}

async function handleTest() {
  if (state.test && state.test.active) {
    showResult(await api.finishTest(), 'Тест завершён.');
    el('test-button').textContent = 'Тестировать текущий профиль';
    return;
  }
  showResult(await api.startTest(), 'Тест начат. Произнесите несколько команд и нажмите кнопку снова.');
  el('test-button').textContent = 'Завершить тест';
}

async function handleSave() {
  if (dirty) {
    const applied = await applyPreview();
    if (!applied || !applied.ok) return;
  }
  const name = el('profile-name').value.trim() || 'Мой микрофон';
  const result = await api.saveProfile({
    name,
    source: state.calibration && state.calibration.step === 'complete' ? 'local-calibration' : 'manual',
  });
  showResult(result, 'Профиль сохранён.');
  if (result && result.ok) el('profile-name').value = '';
}

function wireQuickField(field) {
  const range = el(field.range);
  const number = el(field.number);
  range.addEventListener('input', () => {
    setQuickField(field, range.value);
    dirty = true;
  });
  number.addEventListener('input', () => {
    setQuickField(field, number.value);
    dirty = true;
  });
}

document.querySelectorAll('input, select, textarea').forEach((input) => {
  input.addEventListener('change', () => { dirty = true; });
});
quickFields.forEach(wireQuickField);
el('fw-beam').addEventListener('input', () => {
  el('fw-beam-value').textContent = el('fw-beam').value;
  el('fw-performance').value = 'custom';
  dirty = true;
});
el('fw-vad').addEventListener('change', () => {
  el('fw-performance').value = 'custom';
  dirty = true;
});

el('apply-button').addEventListener('click', applyPreview);
el('calibrate-button').addEventListener('click', handleCalibration);
el('calibration-action').addEventListener('click', handleCalibration);
el('test-button').addEventListener('click', handleTest);
el('save-button').addEventListener('click', handleSave);
el('revert-button').addEventListener('click', async () => showResult(await api.revertPreview(), 'Изменения отменены.'));
el('gemini-metrics-button').addEventListener('click', async () => {
  const result = await api.requestGeminiAnalysis({ deep: false, includeAudio: false, force: true });
  showResult(result, 'Gemini предложил временный профиль.');
});
el('gemini-deep-button').addEventListener('click', async () => {
  if (dirty) {
    const applied = await applyPreview();
    if (!applied || !applied.ok) return;
  }
  const result = await api.requestGeminiAnalysis({ deep: true, includeAudio: true, force: true });
  showResult(result, 'Глубокий анализ завершён, профиль применён временно.');
});
el('close-button').addEventListener('click', () => api.close());
el('profile-select').addEventListener('change', async (event) => {
  const profile = state.profiles.find((item) => item.id === event.target.value);
  if (!profile) return;
  state.settings = clone(profile.settings);
  renderSettings();
  dirty = true;
  await applyPreview();
});

api.onEvent((event) => {
  if (!event) return;
  if (event.metrics) updateMetrics(event.metrics);
  if (event.state) applyState(event.state);
  if (event.result && event.result.message) el('advisor-message').textContent = event.result.message;
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') api.close();
});

refresh().catch((error) => showStatus(error.message || 'Voice Lab недоступен.', 'error'));
