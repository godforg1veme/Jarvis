const assert = require('assert');
const appResolver = require('../tools/appResolver');

const target = 'D:\\Portable\\Obsidian.exe';
const learnedApps = [{
  id: 'learned-obsidian',
  displayName: 'Obsidian Portable',
  aliases: ['обсидиан', 'obsidian portable'],
  launch: { schemaVersion: 1, type: 'exe', target, args: [] },
  trust: { confirmedAt: '2026-08-25T12:00:00.000Z' },
  fingerprint: null,
}];

const result = appResolver.resolve('открой обсидиан', {
  learnedApps,
  existsSync: value => value === target,
});
assert.strictEqual(result.ok, true);
assert.strictEqual(result.app.source, 'apps.learned');
assert.strictEqual(result.app.path, target);
assert.strictEqual(result.app.matchType, 'exactAlias');

const stale = appResolver.resolve('обсидиан', {
  learnedApps,
  existsSync: () => false,
});
assert.strictEqual(stale.notFound, true);

const score = appResolver.scoreApp({ name: 'Пример', aliases: ['ёлка'] }, 'елка', 'елка');
assert.strictEqual(score.matchType, 'exactAlias');

console.log('testAppResolverLearned: ok');
