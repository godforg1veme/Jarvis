const assert = require('assert');
const { normalizeAlias, compactAlias, stripLaunchTrigger, uniqueAliases } = require('../tools/appIdentity');

assert.strictEqual(normalizeAlias('  ОБСИДИАН!  '), 'обсидиан');
assert.strictEqual(normalizeAlias('Ёлка—App'), 'елка app');
assert.strictEqual(compactAlias('VS Code'), 'vscode');
assert.strictEqual(stripLaunchTrigger('Джарвис, открой Obsidian Portable'), 'obsidian portable');
assert.strictEqual(stripLaunchTrigger('Open Open Hardware Monitor'), 'open hardware monitor');
assert.deepStrictEqual(uniqueAliases(['Обсидиан', 'обсидиан!', '', 'x', 'notes']), ['обсидиан', 'notes']);

console.log('testAppIdentity: ok');
