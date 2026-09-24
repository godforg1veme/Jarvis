const fs = require('fs');
const path = require('path');

function unquoteValue(value) {
  if (value.length < 2) return value;
  const quote = value[0];
  if ((quote !== '"' && quote !== "'") || value[value.length - 1] !== quote) return value;
  const content = value.slice(1, -1);
  if (quote === "'") return content;
  return content.replace(/\\(n|r|t|"|\\)/g, (_, escaped) => ({
    n: '\n',
    r: '\r',
    t: '\t',
    '"': '"',
    '\\': '\\',
  })[escaped]);
}

function parseEnv(text) {
  const values = {};
  for (const rawLine of String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.replace(/^export\s+/, '').match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const rawValue = match[2].trim();
    const value = rawValue.startsWith('"') || rawValue.startsWith("'")
      ? unquoteValue(rawValue)
      : rawValue.replace(/\s+#.*$/, '').trim();
    values[match[1]] = value;
  }
  return values;
}

function loadEnvFile(filePath = path.join(__dirname, '..', '.env'), targetEnv = process.env) {
  try {
    const values = parseEnv(fs.readFileSync(filePath, 'utf8'));
    let loaded = 0;
    for (const [key, value] of Object.entries(values)) {
      if (targetEnv[key] !== undefined) continue;
      targetEnv[key] = value;
      loaded += 1;
    }
    return { ok: true, loaded };
  } catch (error) {
    if (error && error.code === 'ENOENT') return { ok: true, loaded: 0 };
    return { ok: false, loaded: 0, error: error.message || String(error) };
  }
}

module.exports = { parseEnv, loadEnvFile };
