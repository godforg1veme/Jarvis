const fs = require('fs');
const path = require('path');
const { normalizeLaunchDescriptor, canonicalizeLaunchDescriptor } = require('./launchDescriptor');
const { normalizeAlias, uniqueAliases, stableId } = require('./appIdentity');

const SCHEMA_VERSION = 1;
const DEFAULT_STORE_PATH = path.join(__dirname, '..', 'data', 'apps.learned.json');
const DEFAULT_MANUAL_PATH = path.join(__dirname, '..', 'data', 'apps.user.json');

function envelope(apps = []) {
  return { schemaVersion: SCHEMA_VERSION, apps };
}

function normalizeRecord(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('learned app record must be an object');
  const displayName = String(raw.displayName || raw.name || '').trim();
  if (!displayName || displayName.length > 256) throw new Error('learned app displayName is invalid');
  const launch = normalizeLaunchDescriptor(raw.launch);
  const aliases = uniqueAliases(raw.aliases || []);
  if (aliases.length === 0) throw new Error('learned app requires at least one alias');
  const id = String(raw.id || stableId('learned', canonicalizeLaunchDescriptor(launch))).trim();
  if (!/^learned-[a-zA-Z0-9_-]+$/.test(id)) throw new Error('learned app id is invalid');
  return {
    id,
    displayName,
    aliases,
    launch,
    provenance: raw.provenance && typeof raw.provenance === 'object' ? { ...raw.provenance } : {},
    trust: raw.trust && typeof raw.trust === 'object' ? { ...raw.trust } : {},
    fingerprint: raw.fingerprint && typeof raw.fingerprint === 'object' ? { ...raw.fingerprint } : null,
  };
}

function normalizeEnvelope(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('learned app store must be an object');
  if (Number(raw.schemaVersion) !== SCHEMA_VERSION) throw new Error('unsupported learned app store schema version');
  if (!Array.isArray(raw.apps)) throw new Error('learned app store apps must be an array');
  return envelope(raw.apps.map(normalizeRecord));
}

function timestampForFile(date) {
  return date.toISOString().replace(/[:.]/g, '-');
}

class LearnedAppStore {
  constructor(options = {}) {
    this.fs = options.fs || fs;
    this.storePath = options.storePath || DEFAULT_STORE_PATH;
    this.manualPath = options.manualPath || DEFAULT_MANUAL_PATH;
    this.now = options.now || (() => new Date());
  }

  load(options = {}) {
    if (!this.fs.existsSync(this.storePath)) return envelope();
    try {
      return normalizeEnvelope(JSON.parse(this.fs.readFileSync(this.storePath, 'utf8')));
    } catch (error) {
      if (options.quarantine !== false) this.quarantineCorruptFile();
      return envelope();
    }
  }

  loadManualApps() {
    try {
      const raw = JSON.parse(this.fs.readFileSync(this.manualPath, 'utf8'));
      return Array.isArray(raw) ? raw : (Array.isArray(raw.apps) ? raw.apps : []);
    } catch {
      return [];
    }
  }

  quarantineCorruptFile() {
    if (!this.fs.existsSync(this.storePath)) return '';
    const ext = path.extname(this.storePath) || '.json';
    const base = this.storePath.slice(0, -ext.length);
    const target = `${base}.corrupt-${timestampForFile(this.now())}${ext}`;
    try {
      this.fs.renameSync(this.storePath, target);
      return target;
    } catch {
      return '';
    }
  }

  write(data) {
    const normalized = normalizeEnvelope(data);
    const dir = path.dirname(this.storePath);
    this.fs.mkdirSync(dir, { recursive: true });
    const tempPath = `${this.storePath}.${process.pid}.${Date.now()}.tmp`;
    const backupPath = `${this.storePath}.backup`;
    const payload = `${JSON.stringify(normalized, null, 2)}\n`;
    let fd;
    try {
      fd = this.fs.openSync(tempPath, 'wx');
      this.fs.writeFileSync(fd, payload, 'utf8');
      if (typeof this.fs.fsyncSync === 'function') this.fs.fsyncSync(fd);
      this.fs.closeSync(fd);
      fd = undefined;
      if (this.fs.existsSync(this.storePath)) this.fs.copyFileSync(this.storePath, backupPath);
      this.fs.renameSync(tempPath, this.storePath);
    } catch (error) {
      if (fd !== undefined) {
        try { this.fs.closeSync(fd); } catch {}
      }
      try { if (this.fs.existsSync(tempPath)) this.fs.unlinkSync(tempPath); } catch {}
      throw error;
    }
    return normalized;
  }

  aliasMap(data = this.load({ quarantine: false })) {
    const map = new Map();
    for (const app of this.loadManualApps()) {
      const aliases = [app.name, app.displayName, ...(Array.isArray(app.aliases) ? app.aliases : [])];
      for (const value of aliases) {
        const alias = normalizeAlias(value);
        if (alias && !map.has(alias)) map.set(alias, { source: 'manual', app });
      }
    }
    for (const app of data.apps) {
      for (const value of [app.displayName, ...app.aliases]) {
        const alias = normalizeAlias(value);
        if (alias && !map.has(alias)) map.set(alias, { source: 'learned', app });
      }
    }
    return map;
  }

  upsert(input) {
    if (!input || typeof input !== 'object') throw new Error('learned app input is required');
    const launch = normalizeLaunchDescriptor(input.launch);
    const launchKey = canonicalizeLaunchDescriptor(launch);
    const data = this.load();
    const existingIndex = data.apps.findIndex(app => canonicalizeLaunchDescriptor(app.launch) === launchKey);
    const existing = existingIndex >= 0 ? data.apps[existingIndex] : null;
    const desired = uniqueAliases(input.aliases || []);
    const aliases = [];
    const skippedAliases = [];
    const mappings = this.aliasMap(data);

    for (const alias of desired) {
      const collision = mappings.get(alias);
      if (collision) {
        const collisionLaunch = collision.app && collision.app.launch;
        const sameLearnedTarget = collisionLaunch && canonicalizeLaunchDescriptor(collisionLaunch) === launchKey;
        if (!sameLearnedTarget) {
          skippedAliases.push(alias);
          continue;
        }
      }
      aliases.push(alias);
    }

    const mergedAliases = uniqueAliases([...(existing ? existing.aliases : []), ...aliases]);
    if (mergedAliases.length === 0) throw new Error('no non-conflicting aliases to learn');
    const displayName = String(input.displayName || existing?.displayName || '').trim();
    const record = normalizeRecord({
      id: existing?.id || stableId('learned', launchKey),
      displayName,
      aliases: mergedAliases,
      launch,
      provenance: { ...(existing?.provenance || {}), ...(input.provenance || {}) },
      trust: { ...(existing?.trust || {}), ...(input.trust || {}) },
      fingerprint: input.fingerprint === undefined ? existing?.fingerprint : input.fingerprint,
    });

    if (existingIndex >= 0) data.apps[existingIndex] = record;
    else data.apps.push(record);
    this.write(data);
    return { record, savedAliases: aliases, skippedAliases };
  }
}

const defaultStore = new LearnedAppStore();

module.exports = {
  SCHEMA_VERSION,
  DEFAULT_STORE_PATH,
  LearnedAppStore,
  normalizeRecord,
  normalizeEnvelope,
  load: (...args) => defaultStore.load(...args),
  upsert: (...args) => defaultStore.upsert(...args),
};
