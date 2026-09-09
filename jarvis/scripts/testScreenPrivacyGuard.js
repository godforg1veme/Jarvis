const assert = require('node:assert');
const { ScreenPrivacyGuard, redactAccessibilityNodes } = require('../vision/screenPrivacyGuard');

const guard = new ScreenPrivacyGuard({
  protectedApps: ['Bitwarden'],
  protectedTitleFragments: ['Private banking'],
});

assert.deepStrictEqual(guard.evaluate({
  displayIds: ['1', '2'],
  windows: [{ processName: 'notepad.exe', title: 'Notes', displayId: '1', visible: true }],
}), { allowed: true, reason: '', protectedWindowCount: 0, protectedDisplayIds: [] });

const blocked = guard.evaluate({
  displayIds: ['1', '2'],
  windows: [
    { processName: 'Bitwarden.exe', title: 'Vault', displayId: '2', visible: true },
    { processName: 'browser.exe', title: 'Private banking account', displayId: '1', visible: true },
  ],
});
assert.strictEqual(blocked.allowed, false);
assert.strictEqual(blocked.protectedWindowCount, 2);
assert.deepStrictEqual(blocked.protectedDisplayIds.sort(), ['1', '2']);
assert.strictEqual(JSON.stringify(blocked).includes('Vault'), false);

const nodes = redactAccessibilityNodes([
  { candidateId: 'control-1', controlType: 'Edit', name: 'Username', value: 'max', enabled: true },
  { candidateId: 'control-2', controlType: 'Password', name: 'Password', value: 'secret', password: true },
]);
assert.strictEqual(nodes[0].value, 'max');
assert.strictEqual(nodes[1].value, '[REDACTED]');
assert.strictEqual(nodes[1].name, '[REDACTED]');
assert.strictEqual(JSON.stringify(nodes).includes('secret'), false);

console.log('[testScreenPrivacyGuard] screen privacy guard tests passed');

