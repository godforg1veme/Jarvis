// Browser-only closed bridge fixture. It never contacts Jarvis or invokes native devices.
function desktopWorkspaceFixture(options = {}) {
  const calls = [];
  const listeners = {};
  const paired = options.paired !== false;
  const state = { ok: true, paired, connection: paired ? 'online' : 'unpaired', serverUrl: 'https://jarvis.fixture.invalid',
    defaultServerUrl: 'https://jarvis.fixture.invalid', deviceId: paired ? 'fixture-device' : '', deviceName: 'Fixture Desktop', voiceEnabled: false };
  const id = '11111111-1111-4111-8111-111111111111';
  const rows = {
    memory: [{ id, title: 'Предпочитает короткие ответы', summary: 'Отвечать кратко', revision: 1, type: 'preference', expectedDigest: 'a'.repeat(64) }],
    documents: [{ id, title: 'План проекта.pdf', summary: 'Документ fixture', revision: 1, mimeType: 'application/pdf', size: 1024 }],
    devices: [{ id, title: 'Jarvis Desktop', summary: 'Это устройство', revision: 1, status: 'active' }],
    jobs: [], operations: [{ id, title: 'Состояние системы', summary: 'Все службы доступны', revision: 1, status: 'healthy' }],
  };
  const permissions = options.permissions || ['assistant', 'life', 'memory', 'documents', 'jobs', 'devices', 'operations', 'vpn'];
  const resultFor = (path, method, body) => {
    calls.push({ path, method, body });
    if (options.forbidden && path.startsWith('/sections/')) return { ok: false, code: 'forbidden' };
    if (path === '/me') return { ok: true, actor: { userId: 'fixture-user', permissions } };
    const match = /^\/sections\/([^/]+)$/.exec(path);
    if (match) return { ok: true, items: rows[match[1]] || [], actions: match[1] === 'operations'
      ? [{ kind: 'operations', href: 'https://jarvis.fixture.invalid/ops/' }]
      : match[1] === 'vpn' ? [{ kind: 'telegram', href: 'https://t.me/jarvis_fixture_bot?start=mini_vpn' }] : [],
      memoryActionsAvailable: match[1] === 'memory', personalActionsAvailable: ['documents', 'devices'].includes(match[1]) };
    if (path.endsWith('/actions')) return { ok: true, actions: [{ type: 'create', title: 'Добавить' }], kinds: path.includes('devices') ? ['pair', 'revoke'] : ['upload', 'delete'], maxUploadBytes: 20 * 1024 * 1024 };
    if (path.includes('/actions/')) return { ok: true, actions: [{ type: 'delete', title: 'Удалить' }, { type: 'correct', title: 'Исправить' }], target: { id, type: path.includes('devices') ? 'device' : 'document', title: 'Fixture item', revision: 1 } };
    if (path.includes('/operations/') && method === 'GET') return { ok: true, status: 'completed', result: {} };
    if (path === '/memory/operations' && method === 'POST') return { ok: true, status: 'completed', memoryId: id };
    if (path.startsWith('/sections/') && path.endsWith('/operations')) return { ok: true, operationId: id, status: 'completed', result: {} };
    if (path.startsWith('/jobs/')) {
      if (path === '/jobs/connection') return { ok: true, available: true, connected: true, status: 'connected' };
      if (path === '/jobs/resumes') return { ok: true, connected: true, primaryResumeId: id, connectionRevision: 1,
        revision: 1, updatedAt: '2026-11-12T00:00:00Z', raiseAvailable: true,
        autoRaise: { enabled: false, resumeId: id, lastOutcome: null }, resumes: [{ id, title: 'Резюме fixture' }] };
      if (path === '/jobs/resumes/refresh' || path === '/jobs/resumes/settings') return { ok: true, requestId: body.requestId, status: 'complete' };
      if (path === '/jobs/automation') return { ok: true, available: true, enabled: method === 'POST' ? body.enabled : false, revision: 1 };
      return { ok: true, operationId: id, status: 'preview', resumes: [{ id, title: 'Резюме fixture', revision: 1 }] };
    }
    if (path === '/desktop/messages' || path.startsWith('/desktop/messages/page/')) return { ok: true, messages: [{ id: 'hist-1', role: 'user', content: 'Старое сообщение' }, { id: 'hist-1', role: 'user', content: 'Дубликат' }, { id: 'hist-2', role: 'assistant', content: 'Ответ из истории' }], paging: { nextCursor: null } };
    if (path === '/assistant/messages' || path.startsWith('/assistant/messages/page/')) return { ok: true, messages: [{ id: 'mini-hist-1', role: 'user', content: 'Старое сообщение' }, { id: 'mini-hist-1', role: 'user', content: 'Дубликат' }, { id: 'mini-hist-2', role: 'assistant', content: 'Ответ из истории' }], paging: { nextCursor: null } };
    return { ok: true, operationId: id, status: 'preview', preview: { title: 'Предпросмотр', summary: 'Fixture only' } };
  };
  const life = {
    getMissionControl: async () => ({ ok: true, missionControl: { currentMission: { id, name: 'Fixture project', summary: 'Проверка', status: 'active' }, projects: [{ id, name: 'Fixture project', summary: 'Проверка', status: 'active' }], rankedProjects: [], areas: [], commitments: [], proposals: [], reminders: [], recentEvents: [], devices: [], sources: [] } }),
    getLifeBootstrap: async () => ({ ok: true, projects: [], areas: [] }), getLifeTimeline: async () => ({ ok: true, items: [], nextCursor: null }),
    getLifeProjectContext: async () => ({ ok: true, context: { project: { id, name: 'Fixture project' }, verifiedFacts: [], commitments: [], proposals: [] } }),
    getLifePeople: async () => ({ ok: true, people: [] }), getLifeRelationships: async () => ({ ok: true, relationships: [] }), getLifePersonProjectLinks: async () => ({ ok: true, links: [] }),
    getLifeFamilyGrants: async () => ({ ok: true, grants: [] }), getLifeFamilyShared: async () => ({ ok: true, shared: [] }), getLifePreferences: async () => ({ ok: true, preferences: [] }),
    getLifeSources: async () => ({ ok: true, sources: [] }), setLifeMode: async () => ({ ok: true }), getMissionControl: async () => ({ ok: true, missionControl: { currentMission: null, projects: [], rankedProjects: [], areas: [], commitments: [], proposals: [], reminders: [], recentEvents: [], devices: [], sources: [] } }),
  };
  const api = {
    getState: async () => state, onState(fn) { (listeners.states ||= []).push(fn); }, onVoiceStatus(fn) { listeners.voice = fn; }, onMessage(fn) { listeners.message = fn; },
    getWorkspacePending: async () => ({ ok: true, pending: [] }),
    onCoreMode() {}, onVisionState() {}, onVisionSensitiveConsentRequired() {}, onOpenLifeOs(fn) { listeners.life = fn; }, onLifeProposal() {},
    getVoiceState: async () => ({ ok: true, enabled: false }), getVisionState: async () => ({ ok: true, state: { state: 'off' } }),
    listPendingRequests: async () => ({ ok: true, requests: [] }), listVisionSources: async () => ({ ok: true, cameras: [] }), listVisionMemories: async () => ({ ok: true, memories: [] }),
    sendMessage: async (text) => { calls.push({ path: '/sendMessage', method: 'IPC', body: text }); return options.sendError ? { ok: false, error: 'fixture failure' } : { ok: true, answer: `Ответ: ${text}`, clientMessageId: 'message-fixture' }; },
    classifyVisualIntent: async () => ({ visual: false }), acknowledgeRequest: async () => ({ ok: true }), getRequestStatus: async () => ({ ok: true, status: 'not_found' }),
    pair: async () => ({ ok: false, error: 'Fixture pairing disabled' }), startVoice: async () => ({ ok: false }), stopVoice: async () => ({ ok: true }),
    openVoiceSettings: async () => { calls.push({ path: 'openVoiceSettings', method: 'IPC' }); return { ok: true, settings: { echoCancellation: true, noiseSuppression: true, autoGainControl: false } }; },
    saveVoiceSettings: async (body) => { calls.push({ path: 'saveVoiceSettings', method: 'IPC', body }); return { ok: true, settings: body }; },
    workspaceRequest: async (path, method = 'GET', body) => {
      const override = window.__workspaceOverrides?.[`${method} ${path}`];
      if (override !== undefined) { calls.push({ path, method, body }); return typeof override === 'function' ? override(body) : override; }
      return resultFor(path, method, body);
    }, workspaceUpload: async (payload) => { calls.push({ path: 'upload', method: 'IPC', body: { ...payload, data: undefined } }); return { ok: true, status: 'completed', result: {} }; },
    openWorkspaceLink: async (href) => { window.__openedLinks.push(href); return { ok: true }; },
    ...life,
  };
  window.__workspaceCalls = calls; window.__openedLinks = []; window.__fixtureState = state; window.jarvisCloud = api;
  window.__workspaceOverrides = {};
  window.__emitState = (patch) => { Object.assign(state, patch); for (const listener of listeners.states || []) listener({ ...state }); };
}
module.exports = { desktopWorkspaceFixture };
