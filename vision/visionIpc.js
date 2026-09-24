const { classifyVisualIntent } = require('./visualIntent');

function registerVisionIpc({ ipcMain, isTrustedRenderer, getRuntime }) {
  const runtimeFor = (event) => (isTrustedRenderer(event) ? getRuntime() : null);

  ipcMain.handle('vision:get-state', (event) => {
    const runtime = runtimeFor(event);
    return runtime ? { ok: true, state: runtime.publicState() } : { ok: false, error: 'Access denied.' };
  });
  ipcMain.handle('vision:list-sources', async (event) => {
    const runtime = runtimeFor(event);
    if (!runtime) return { ok: false, error: 'Access denied.' };
    try { return await runtime.discover(); } catch { return { ok: false, error: 'Не удалось получить список камер и экранов.' }; }
  });
  ipcMain.handle('vision:start', (event, input = {}) => {
    const runtime = runtimeFor(event);
    if (!runtime) return { ok: false, error: 'Access denied.' };
    return runtime.start({
      cameraSourceId: String(input.cameraSourceId || ''),
      includeCamera: input.includeCamera === true,
      includeScreens: input.includeScreens !== false,
      kind: input.kind === 'short' ? 'short' : 'active',
    });
  });
  ipcMain.handle('vision:analyze', (event, input = {}) => {
    const runtime = runtimeFor(event);
    if (!runtime) return { ok: false, error: 'Access denied.' };
    return runtime.analyze({
      prompt: String(input.prompt || '').slice(0, 4000),
      sourceId: String(input.sourceId || ''),
      target: ['camera', 'screen', 'all'].includes(input.target) ? input.target : 'all',
    });
  });
  ipcMain.handle('vision:classify-intent', (event, input = {}) => (
    isTrustedRenderer(event) ? classifyVisualIntent(String(input.text || '')) : { visual: false }
  ));
  ipcMain.handle('vision:stop', (event) => {
    const runtime = runtimeFor(event);
    return runtime ? runtime.stop('user_stop') : { ok: false, error: 'Access denied.' };
  });
  ipcMain.handle('vision:sensitive-consent', async (event, input = {}) => {
    const runtime = runtimeFor(event);
    if (!runtime) return { ok: false, error: 'Access denied.' };
    try { await runtime.setSensitiveConsent(String(input.sourceId || ''), input.allow === true); return { ok: true }; }
    catch { return { ok: false, error: 'Не удалось сохранить выбор приватности.' }; }
  });
  ipcMain.handle('vision:memory-list', async (event) => {
    const runtime = runtimeFor(event);
    if (!runtime) return { ok: false, error: 'Access denied.' };
    try { return await runtime.transport.listMemories(50); } catch { return { ok: false, error: 'Визуальная память недоступна.' }; }
  });
  ipcMain.handle('vision:memory-get', async (event, input = {}) => {
    const runtime = runtimeFor(event);
    if (!runtime) return { ok: false, error: 'Access denied.' };
    try { return await runtime.transport.getMemory(String(input.memoryId || '')); } catch { return { ok: false, error: 'Снимок не найден.' }; }
  });
  ipcMain.handle('vision:memory-update', async (event, input = {}) => {
    const runtime = runtimeFor(event);
    if (!runtime) return { ok: false, error: 'Access denied.' };
    try { return await runtime.transport.updateMemory(String(input.memoryId || ''), input.patch || {}); }
    catch { return { ok: false, error: 'Не удалось обновить снимок.' }; }
  });
  ipcMain.handle('vision:memory-delete', async (event, input = {}) => {
    const runtime = runtimeFor(event);
    if (!runtime) return { ok: false, error: 'Access denied.' };
    try { return await runtime.transport.deleteMemory(String(input.memoryId || '')); }
    catch { return { ok: false, error: 'Не удалось удалить снимок.' }; }
  });
}

module.exports = { registerVisionIpc };
