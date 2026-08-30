const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { LearnedAppStore } = require('../tools/learnedAppStore');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-learned-'));
const storePath = path.join(root, 'apps.learned.json');
const manualPath = path.join(root, 'apps.user.json');
fs.writeFileSync(manualPath, JSON.stringify({ apps: [{ name: 'Manual', aliases: ['ручной'], path: 'C:\\Manual.exe' }] }));

const store = new LearnedAppStore({ storePath, manualPath, now: () => new Date('2026-08-25T12:00:00Z') });
assert.deepStrictEqual(store.load(), { schemaVersion: 1, apps: [] });

const first = store.upsert({
  displayName: 'Obsidian',
  aliases: ['Обсидиан', 'ручной', 'obsidian portable'],
  launch: { type: 'exe', target: 'D:\\Apps\\Obsidian.exe', args: [] },
  provenance: { source: 'disk-scan' },
  trust: { confirmedAt: '2026-08-25T12:00:00.000Z' },
});
assert.deepStrictEqual(first.savedAliases, ['обсидиан', 'obsidian portable']);
assert.deepStrictEqual(first.skippedAliases, ['ручной']);
assert.strictEqual(store.load().apps[0].aliases.includes('обсидиан'), true);

store.upsert({
  displayName: 'Obsidian',
  aliases: ['заметки'],
  launch: { type: 'exe', target: 'D:\\Apps\\Obsidian.exe', args: [] },
});
assert.deepStrictEqual(store.load().apps[0].aliases, ['обсидиан', 'obsidian portable', 'заметки']);

fs.writeFileSync(storePath, '{broken', 'utf8');
assert.deepStrictEqual(store.load().apps, []);
assert.strictEqual(fs.readdirSync(root).some(name => name.includes('.corrupt-')), true);

fs.rmSync(root, { recursive: true, force: true });
console.log('testLearnedAppStore: ok');
