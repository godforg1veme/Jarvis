const fs = require('fs');
const path = require('path');

// Directories to search in (user profile + common locations)
const SEARCH_DIRS = [
  path.join(process.env.USERPROFILE || '', 'Desktop'),
  path.join(process.env.USERPROFILE || '', 'Documents'),
  path.join(process.env.USERPROFILE || '', 'Downloads'),
];

function searchDir(dir, query, maxResults, depth = 0) {
  if (depth > 6 || maxResults <= 0) return [];

  const results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (maxResults <= 0) break;

      // Skip hidden/system directories
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        const subResults = searchDir(path.join(dir, entry.name), query, maxResults, depth + 1);
        results.push(...subResults);
        maxResults -= subResults.length;
      } else if (entry.isFile()) {
        const matchName = entry.name.toLowerCase().includes(query.toLowerCase());
        if (matchName) {
          results.push({
            name: entry.name,
            path: path.join(dir, entry.name),
            size: 0,
          });
          try {
            results[results.length - 1].size = fs.statSync(path.join(dir, entry.name)).size;
          } catch {}
          maxResults--;
        }
      }
    }
  } catch (err) {
    // Permission denied etc.
  }
  return results;
}

function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i];
}

async function execute(args, confirmed) {
  const query = (args.query || '').trim();

  if (!query) {
    return {
      ok: false,
      type: 'find',
      title: 'Поиск файлов',
      content: 'Укажите запрос. Пример: /find *.log',
      error: 'query is required',
    };
  }

  // Build search query - support wildcard patterns
  let results = [];

  for (const dir of SEARCH_DIRS) {
    if (!fs.existsSync(dir)) continue;

    // If query has wildcard pattern like *.log
    if (query.includes('*') || query.includes('?')) {
      const regex = new RegExp('^' + query.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
      results = results.concat(searchDir(dir, regex.source, 30));
      // Re-filter since we searched by regex source as query
      results = results.filter(f => regex.test(f.name));
    } else {
      results = results.concat(searchDir(dir, query, 30));
    }

    if (results.length >= 30) {
      results = results.slice(0, 30);
      break;
    }
  }

  if (results.length === 0) {
    return {
      ok: true,
      type: 'find',
      title: `Поиск: ${query}`,
      content: 'Файлы не найдены в папках Desktop, Documents, Downloads.',
      data: { query, results: [] },
    };
  }

  const fileList = results.map((f, i) => `${i + 1}. 📄 ${f.name}\n   ${f.path} (${formatSize(f.size)})`).join('\n');

  return {
    ok: true,
    type: 'find',
    title: `Найдено файлов: ${results.length}`,
    content: fileList,
    data: { query, results },
  };
}

function getSchema() {
  return 'find: поиск файлов по имени. Args: { query: string }. Пример: /find *.log';
}

module.exports = { execute, getSchema };