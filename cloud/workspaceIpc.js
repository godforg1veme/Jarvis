const { requestInput, uploadInput, externalUrl } = require('./workspaceProtocol');

function safeFailure(error, mutation = false) {
  const status = Number(error?.statusCode) || 0;
  const declared = typeof error?.code === 'string' ? error.code : '';
  const code = status === 401 ? 'unauthorized' : status === 403 ? 'forbidden'
    : error?.outcome === 'unknown' ? 'unknown'
    : status === 404 ? 'unavailable' : status === 409 ? 'conflict' : status === 429 ? 'rate_limited'
    : declared === 'invalid_request' ? declared
      : declared === 'PENDING_OPERATION_EXISTS' ? 'unknown'
        : /^JOB_[A-Z_]{1,70}$/.test(declared) ? declared
          : error?.outcome === 'unknown' || (mutation && (!status || status >= 500)) ? 'unknown' : 'unavailable';
  return { ok: false, code, uncertain: code === 'unknown' || error?.outcome === 'unknown',
    ...(declared === 'PENDING_OPERATION_EXISTS' && /^[a-f0-9-]{36}$/i.test(error.pendingId || '')
      ? { pendingId: error.pendingId } : {}) };
}

function registerWorkspaceIpc({ ipcMain, isTrustedRenderer, getClient, openExternal, openVoiceSettings, saveVoiceSettings }) {
  const handle = (name, fn) => ipcMain.handle(name, async (event, input) => {
    const client = getClient();
    if (!isTrustedRenderer(event) || !client) return { ok: false, code: 'forbidden' };
    try { return await fn(client, input); } catch (error) { return safeFailure(error); }
  });
  handle('workspace:request', async (client, input) => {
    const request = requestInput(input);
    try { return await client.workspaceRequest(request); }
    catch (error) { return safeFailure(error, request.method !== 'GET'); }
  });
  handle('workspace:pending', (client) => ({ ok: true, pending: client.listWorkspacePending() }));
  handle('workspace:upload', async (client, input) => {
    const file = uploadInput(input);
    try { return await client.workspaceUpload(file); }
    catch (error) { return safeFailure(error, true); }
  });
  handle('workspace:open-link', async (client, input) => {
    const href = externalUrl(input?.href, client.getState().serverUrl, client.workspaceTelegramLinks?.() || []);
    await openExternal(href);
    return { ok: true };
  });
  handle('workspace:voice-settings', async () => {
    return { ok: true, ...await openVoiceSettings() };
  });
  handle('workspace:voice-settings-save', async (_client, input) => saveVoiceSettings(input));
}
module.exports = { registerWorkspaceIpc, safeFailure };
