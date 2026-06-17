let electronShell = null;
try {
  const electron = require('electron');
  electronShell = electron && typeof electron === 'object' ? electron.shell : null;
} catch {
  electronShell = null;
}

const { searchFiles } = require('./fileSearch');
const { isDangerousFile } = require('./fileSafety');

function formatSize(bytes) {
  if (!bytes) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

function mapAction(action) {
  if (action === 'reveal' || action === 'show') return 'reveal';
  if (action === 'find' || action === 'search') return 'find';
  return 'open';
}

function resultContent(file) {
  const date = file.modifiedAt ? new Date(file.modifiedAt).toLocaleString('ru-RU') : '';
  return `${file.path}${file.size ? ` (${formatSize(file.size)})` : ''}${date ? ` · ${date}` : ''}`;
}

function makeCandidate(file, action) {
  return {
    ...file,
    action,
    title: file.name,
    content: resultContent(file),
    warning: action === 'open' && file.dangerous,
  };
}

function notFoundResult(query, location) {
  return {
    ok: false,
    type: 'file',
    title: 'Файл не найден',
    content: `Не нашёл "${query}" в выбранном месте. Можно поискать в стандартных папках или на компьютере.`,
    message: `Файл ${query} не найден.`,
    notFound: true,
    data: { query, location, results: [] },
  };
}

function selectionResult(query, location, action, results) {
  return {
    ok: false,
    type: 'file',
    title: 'Выберите файл',
    content: `Нашёл несколько вариантов для "${query}".`,
    message: 'Нашёл несколько файлов. Выберите нужный в списке.',
    needsSelection: true,
    candidates: results.map((file) => makeCandidate(file, action)),
    data: { query, location, action, results },
  };
}

function confirmationResult(file, action) {
  return {
    ok: false,
    type: 'file',
    title: 'Нужно подтверждение',
    content: 'Это исполняемый файл/скрипт. Его открытие может запустить команды. Запустить?',
    message: 'Это исполняемый файл или скрипт. Его открытие может запустить команды. Запустить?',
    needsConfirmation: true,
    commandToConfirm: {
      tool: 'fileCommander',
      args: {
        action,
        query: file.name,
        location: 'direct',
        selectedFile: file,
      },
      description: file.path,
    },
  };
}

function shellUnavailableResult(action) {
  return {
    ok: false,
    type: 'file',
    title: action === 'reveal' ? 'Не удалось показать файл' : 'Не удалось открыть файл',
    content: 'Electron shell недоступен. Это действие работает только внутри Electron.',
    error: 'electron shell unavailable',
  };
}

async function openFile(shell, file) {
  if (!shell || typeof shell.openPath !== 'function') return shellUnavailableResult('open');

  const error = await shell.openPath(file.path);
  if (error) {
    return { ok: false, type: 'file', title: 'Не удалось открыть файл', content: error, error };
  }

  return { ok: true, type: 'file', title: `Открываю: ${file.name}`, content: file.path, message: `Открываю ${file.name}.`, data: file };
}

function revealFile(shell, file) {
  if (!shell || typeof shell.showItemInFolder !== 'function') return shellUnavailableResult('reveal');

  shell.showItemInFolder(file.path);
  return { ok: true, type: 'file', title: `Показываю: ${file.name}`, content: file.path, message: `Показываю ${file.name} в проводнике.`, data: file };
}

async function execute(args = {}, confirmed = false) {
  const action = mapAction(args.action);
  const query = String(args.query || '').trim();
  const options = args._testOptions || {};
  const shell = options.shell || electronShell;

  if (!query && !args.selectedFile) {
    return {
      ok: false,
      type: 'file',
      title: 'Не указан файл',
      content: 'Скажите или введите имя файла.',
      message: 'Скажите или введите имя файла.',
      error: 'query is required',
    };
  }

  let selectedFile = args.selectedFile || null;
  let searchResult = null;

  if (!selectedFile) {
    const searchOptions = { ...options };
    if ((args.location || 'computer') === 'computer' && options.enableDiskScan !== false) {
      searchOptions.enableDiskScan = true;
    }

    searchResult = searchFiles({ query, location: args.location || 'computer' }, searchOptions);
    if (!searchResult.ok) {
      return {
        ok: false,
        type: 'file',
        title: searchResult.reason === 'missing_location' ? 'Папка не найдена' : 'Не удалось найти файл',
        content: 'Проверьте название папки или попробуйте поиск на компьютере.',
        message: 'Не удалось найти файл. Проверьте название папки или попробуйте поиск на компьютере.',
        error: searchResult.reason,
      };
    }

    if (searchResult.results.length === 0) return notFoundResult(query, args.location || 'computer');
    if (action === 'find') {
      return {
        ok: true,
        type: 'file',
        title: `Найдено файлов: ${searchResult.results.length}`,
        content: searchResult.results.map((file, index) => `${index + 1}. ${file.name}\n   ${file.path}`).join('\n'),
        message: `Найдено файлов: ${searchResult.results.length}.`,
        data: { query, results: searchResult.results },
      };
    }
    if (searchResult.results.length > 1) {
      return selectionResult(query, args.location || 'computer', action, searchResult.results);
    }
    selectedFile = searchResult.results[0];
  }

  if (action === 'find') {
    const results = searchResult ? searchResult.results : [selectedFile];
    return {
      ok: true,
      type: 'file',
      title: `Найдено файлов: ${results.length}`,
      content: results.map((file, index) => `${index + 1}. ${file.name}\n   ${file.path}`).join('\n'),
      message: `Найдено файлов: ${results.length}.`,
      data: { query: query || selectedFile.name, results },
    };
  }

  if (action === 'reveal') return revealFile(shell, selectedFile);

  if (isDangerousFile(selectedFile.name) && !confirmed && !args.confirmed) {
    return confirmationResult(selectedFile, action);
  }

  return await openFile(shell, selectedFile);
}

function getSchema() {
  return 'fileCommander: открыть/показать/найти файл. Args: { action: "open"|"reveal"|"find", query: string, location?: string, selectedFile?: object }.';
}

module.exports = {
  execute,
  getSchema,
  formatSize,
  mapAction,
};
