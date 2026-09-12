const fs = require('fs');
const path = require('path');
const { getWritableDataPath } = require('../runtimeDataPath');

const HISTORY_PATH = path.join(__dirname, '..', 'data', 'agent-history.json');
const MAX_TASKS = 100;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    const target = getWritableDataPath(filePath);
    if (fs.existsSync(target)) return JSON.parse(fs.readFileSync(target, 'utf8'));
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return fallback;
  } catch {
    return fallback;
  }
}

function normalizeHistory(raw) {
  if (!raw || typeof raw !== 'object') return { tasks: [] };
  if (!Array.isArray(raw.tasks)) return { tasks: [] };
  return { tasks: raw.tasks };
}

function pruneTasks(tasks, nowMs = Date.now()) {
  return tasks
    .filter((task) => {
      const createdAt = Date.parse(task.createdAt || task.updatedAt || '');
      if (!Number.isFinite(createdAt)) return true;
      return nowMs - createdAt <= MAX_AGE_MS;
    })
    .slice(0, MAX_TASKS);
}

function readHistory(filePath = HISTORY_PATH) {
  return normalizeHistory(readJson(filePath, { tasks: [] }));
}

function writeHistory(history, filePath = HISTORY_PATH) {
  try {
    const target = getWritableDataPath(filePath);
    ensureDir(path.dirname(target));
    fs.writeFileSync(target, JSON.stringify(normalizeHistory(history), null, 2), 'utf8');
  } catch (err) {
    console.error(`[agentHistory] Failed to write ${filePath}:`, err);
  }
}

function appendTask(task, options = {}) {
  const filePath = options.filePath || HISTORY_PATH;
  const now = options.now || new Date().toISOString();
  const history = readHistory(filePath);
  const entry = {
    ...task,
    createdAt: task.createdAt || now,
    updatedAt: now,
  };

  history.tasks = pruneTasks([entry, ...history.tasks], Date.parse(now));
  writeHistory(history, filePath);
  return entry;
}

function updateTask(taskId, patch, options = {}) {
  const filePath = options.filePath || HISTORY_PATH;
  const now = options.now || new Date().toISOString();
  const history = readHistory(filePath);
  const index = history.tasks.findIndex((task) => task.taskId === taskId);

  if (index === -1) {
    return appendTask({ taskId, ...patch }, { filePath, now });
  }

  const updated = {
    ...history.tasks[index],
    ...patch,
    updatedAt: now,
  };
  history.tasks.splice(index, 1);
  history.tasks = pruneTasks([updated, ...history.tasks], Date.parse(now));
  writeHistory(history, filePath);
  return updated;
}

module.exports = {
  HISTORY_PATH,
  MAX_TASKS,
  MAX_AGE_MS,
  readHistory,
  writeHistory,
  appendTask,
  updateTask,
  pruneTasks,
};
