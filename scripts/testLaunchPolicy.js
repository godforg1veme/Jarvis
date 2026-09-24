const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { POLICY, createFingerprint, evaluateLaunchPolicy } = require('../tools/launchPolicy');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-policy-'));
const exePath = path.join(root, 'demo.exe');
const psPath = path.join(root, 'demo.ps1');
const interpreter = path.join(root, 'powershell.exe');
fs.writeFileSync(exePath, 'exe');
fs.writeFileSync(psPath, 'Write-Output ok');
fs.writeFileSync(interpreter, 'interpreter');

const exe = { type: 'exe', target: exePath, args: [] };
assert.strictEqual(evaluateLaunchPolicy(exe, null).decision, POLICY.CONFIRM);
assert.strictEqual(evaluateLaunchPolicy(exe, { launch: exe }).decision, POLICY.ALLOW);

const script = { type: 'script', target: psPath, interpreter, args: [] };
const fingerprint = createFingerprint(script);
assert.strictEqual(evaluateLaunchPolicy(script, { launch: script, fingerprint }).decision, POLICY.ALLOW);
fs.writeFileSync(psPath, 'Write-Output changed');
assert.strictEqual(evaluateLaunchPolicy(script, { launch: script, fingerprint }).decision, POLICY.CONFIRM);
fs.unlinkSync(exePath);
assert.strictEqual(evaluateLaunchPolicy(exe, { launch: exe }).decision, POLICY.BLOCK);

fs.rmSync(root, { recursive: true, force: true });
console.log('testLaunchPolicy: ok');
