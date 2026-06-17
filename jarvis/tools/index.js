const runProgram = require('./runProgram');
const powershell = require('./powershell');
const searchFiles = require('./searchFiles');
const sysinfo = require('./sysinfo');

const tools = {
  run: runProgram,
  powershell: powershell,
  find: searchFiles,
  sys: sysinfo,
};

// Parse user input and dispatch to the right tool
function parseAndDispatch(input) {
  const trimmed = input.trim();

  // Explicit /prefix commands
  if (trimmed.startsWith('/run ')) {
    const app = trimmed.slice(5).trim();
    return { tool: 'run', args: { app } };
  }

  if (trimmed.startsWith('/ps ')) {
    const command = trimmed.slice(4).trim();
    return { tool: 'powershell', args: { command } };
  }

  if (trimmed.startsWith('/find ')) {
    const query = trimmed.slice(6).trim();
    return { tool: 'find', args: { query } };
  }

  if (trimmed.startsWith('/sys') && (trimmed.length === 4 || trimmed[4] === ' ')) {
    return { tool: 'sys', args: {} };
  }

  if (trimmed.startsWith('/refresh-apps') || trimmed.startsWith('/reindex')) {
    return { tool: 'refresh', args: {} };
  }

  if (trimmed.startsWith('/scanroots')) {
    return { tool: 'scanroots', args: {} };
  }

  if (trimmed.startsWith('/addscanroot ')) {
    const newPath = trimmed.slice(13).trim();
    return { tool: 'addscanroot', args: { path: newPath } };
  }

  if (trimmed.startsWith('/addapp')) {
    const rest = trimmed.slice(8).trim();
    // Parse: /addapp <name> "<path>"
    const match = rest.match(/^(\S+)\s+"(.+)"$/);
    if (match) {
      return { tool: 'addapp', args: { alias: match[1], appPath: match[2] } };
    }
    return { tool: 'addapp', args: { alias: rest } };
  }

  // Add /debugresolve command
  if (trimmed.startsWith('/debugresolve ')) {
    const query = trimmed.slice(14).trim();
    return { tool: 'run', args: { app: query, _debugresolve: true } };
  }

  // Natural language matching using keywords
  const lower = trimmed.toLowerCase();

  // System info detection
  const sysKeywords = [
    'системная информация', 'система', 'инфо', 'sysinfo', 'system info',
    'хардware', 'железо', 'cpu', 'ram', 'память', 'диск',
    'операционка', 'ос', 'винд', 'windows'
  ];
  for (const kw of sysKeywords) {
    if (lower.includes(kw)) {
      return { tool: 'sys', args: {} };
    }
  }

  // File search detection
  const findKeywords = [
    'найди файл', 'найти файл', 'поиск файла', 'поиск файл',
    'find file', 'search file', 'найти', 'найди', 'search',
    'поиск', 'ищи'
  ];
  for (const kw of findKeywords) {
    if (lower.includes(kw)) {
      const query = trimmed.replace(new RegExp(kw, 'gi'), '').trim() || '*.*';
      return { tool: 'find', args: { query } };
    }
  }

  // PowerShell detection
  const psKeywords = [
    'powershell', 'павершелл', 'пс', 'выполни команду', 'выполнить', 'команду', 'execute',
  ];
  for (const kw of psKeywords) {
    if (lower.includes(kw)) {
      const command = trimmed.replace(new RegExp(kw, 'gi'), '').trim();
      return { tool: 'powershell', args: { command } };
    }
  }

  // App launch detection (default) — includes natural language like "открой chrome", "запусти vscode"
  return { tool: 'run', args: { app: trimmed } };
}

// Get tool schema descriptions
function getToolSchemas() {
  return tools.run.getSchema() + '\n' +
    tools.powershell.getSchema() + '\n' +
    tools.find.getSchema() + '\n' +
    tools.sys.getSchema();
}

module.exports = {
  tools,
  parseAndDispatch,
  getToolSchemas,
};