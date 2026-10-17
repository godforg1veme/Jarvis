const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DesktopCloudClient } = require('../../cloud/desktopCloudClient');
const { CommandService } = require('../src/commands/commandService');
const { createRemoteMessage } = require('../src/devices/remoteProtocol');

test('a blocked corrupt Desktop journal preserves original-command uncertainty across the wire', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-journal-boundary-'));
  try {
    fs.writeFileSync(path.join(directory, 'cloud-command-journal.json'), '{broken');
    let executions = 0;
    let wire;
    const commandId = '11111111-1111-4111-8111-111111111111';
    const action = 'file.create_folder';
    const client = new DesktopCloudClient({ userDataPath: directory, safeStorage: null,
      capabilities: { localActions: [action] },
      executeRemoteCommand: async () => { executions += 1; return { ok: true }; } });
    client._sendSessionMessage = (type, payload) => { wire = createRemoteMessage(type, payload); };
    await client._handleRemoteCommand({ payload: { commandId, action, args: {}, confirmed: true } });
    assert.equal(executions, 0);
    let completion;
    const service = new CommandService({ repository: {
      async getForDevice() { return { id: commandId, action, status: 'running' }; },
      async complete(input) { completion = input; return { id: commandId, ...input }; },
      async audit() {},
    } });
    await service.handleResult({ device: { id: 'fixture-device', user_id: 'fixture-owner' },
      commandId, result: wire.payload.result });
    assert.equal(completion.errorCode, 'EXECUTION_UNKNOWN', 'missing journal cannot prove an old command was never executed');
    assert.equal(completion.result.executionUnknown, true);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
