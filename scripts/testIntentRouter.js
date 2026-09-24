const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  resolveCommandWithAi,
  parseJsonResponse,
  normalizeCommandResult,
  cacheIdentity,
} = require('../tools/aiIntentResolver');
const {
  routeIntent,
  mapAiResultToIntent,
  resolveKnownAppId,
} = require('../tools/intentRouter');

const fullCapabilities = [
  'launch_app', 'search_app', 'close_app', 'open_file', 'reveal_file',
  'find_file', 'translate_selected',
];

function testNormalization() {
  const expectUnknown = (value, options = {}) => {
    assert.strictEqual(normalizeCommandResult(value, {
      capabilities: fullCapabilities,
      ...options,
    }).route, 'unknown');
  };

  const app = normalizeCommandResult({
    schemaVersion: 2, route: 'direct', action: 'launch_app', appQuery: 'Visual Studio Code', confidence: 0.9,
  }, { capabilities: fullCapabilities });
  assert.strictEqual(app.route, 'direct');
  assert.strictEqual(app.action, 'launch_app');
  assert.strictEqual(app.appQuery, 'Visual Studio Code');

  const file = normalizeCommandResult({
    schemaVersion: 2, route: 'direct', action: 'find_file', query: 'report.pdf', location: 'documents', confidence: 0.88,
  }, { capabilities: fullCapabilities });
  assert.strictEqual(file.action, 'find_file');
  assert.strictEqual(file.location, 'documents');

  const agent = normalizeCommandResult({
    schemaVersion: 2, route: 'desktop_agent', confidence: 0.92, reason: 'multi-step',
  }, { capabilities: fullCapabilities, allowDesktopAgent: true });
  assert.strictEqual(agent.route, 'desktop_agent');

  const low = normalizeCommandResult({
    schemaVersion: 2, route: 'direct', action: 'launch_app', appQuery: 'Steam', confidence: 0.4,
  }, { capabilities: fullCapabilities });
  assert.strictEqual(low.route, 'unknown');

  const invalidLocation = normalizeCommandResult({
    schemaVersion: 2, route: 'direct', action: 'find_file', query: 'report.pdf', location: 'C:\\private', confidence: 0.9,
  }, { capabilities: fullCapabilities });
  assert.strictEqual(invalidLocation.route, 'unknown');

  const pathInjection = normalizeCommandResult({
    schemaVersion: 2, route: 'direct', action: 'launch_app', appQuery: 'Code', path: 'C:\\Code.exe', confidence: 0.9,
  }, { capabilities: fullCapabilities });
  assert.strictEqual(pathInjection.route, 'unknown');

  const capabilityBlocked = normalizeCommandResult({
    schemaVersion: 2, route: 'direct', action: 'find_file', query: 'report.pdf', location: 'documents', confidence: 0.9,
  }, { capabilities: ['launch_app'] });
  assert.strictEqual(capabilityBlocked.route, 'unknown');

  expectUnknown(null);
  expectUnknown([]);
  expectUnknown({ schemaVersion: 1, route: 'unknown', confidence: 0 });
  expectUnknown({ schemaVersion: 2, route: 'unsupported', confidence: 0.9 });
  expectUnknown({ schemaVersion: 2, route: 'direct', action: 'delete_everything', confidence: 0.9 });
  expectUnknown({ schemaVersion: 2, route: 'direct', action: 'launch_app', confidence: 0.9 });
  expectUnknown({ schemaVersion: 2, route: 'direct', action: 'launch_app', appQuery: 'Code', confidence: 2 });
  expectUnknown({ schemaVersion: 2, route: 'direct', action: 'launch_app', appQuery: 'Code', confidence: 'NaN' });
  expectUnknown({ schemaVersion: 2, route: 'direct', action: 'launch_app', appQuery: 'Code', ToolCall: {} });
  expectUnknown({ schemaVersion: 2, route: 'direct', action: 'launch_app', appQuery: ['Code'], confidence: 0.9 });
  expectUnknown({ schemaVersion: 2, route: 'direct', action: 'find_file', query: { name: 'report.pdf' }, location: 'documents', confidence: 0.9 });
  expectUnknown({ schemaVersion: 2, route: 'direct', action: 'find_file', query: 'report.pdf', location: ['documents'], confidence: 0.9 });
  expectUnknown({ schemaVersion: 2, route: 'unknown', confidence: 0.1, extra: 'not in schema' });
  expectUnknown({ schemaVersion: 2, route: 'desktop_agent', confidence: 0.9 }, { allowDesktopAgent: false });
}

async function testResolverBoundaries() {
  let transportCalls = 0;
  await assert.rejects(() => resolveCommandWithAi('неясная команда', {
    apiKey: '',
    cache: false,
    chatJson: async () => { transportCalls += 1; return '{}'; },
  }), /OPENROUTER_API_KEY/);
  assert.strictEqual(transportCalls, 0);

  await assert.rejects(() => resolveCommandWithAi('неясная команда', {
    apiKey: 'ключ-заглушка',
    cache: false,
    chatJson: async () => { transportCalls += 1; return '{}'; },
  }), /неверный формат/);
  assert.strictEqual(transportCalls, 0);

  const result = await resolveCommandWithAi('открой блокнотик', {
    apiKey: 'test-key',
    cache: false,
    settings: { provider: 'openrouter', textModel: 'test/model', enableAiIntent: true },
    capabilities: ['launch_app'],
    chatJson: async () => {
      transportCalls += 1;
      return JSON.stringify({ schemaVersion: 2, route: 'direct', action: 'launch_app', appQuery: 'notepad', confidence: 0.95 });
    },
  });
  assert.strictEqual(result.action, 'launch_app');
  assert.strictEqual(transportCalls, 1);

  await assert.rejects(() => resolveCommandWithAi('сломанный ответ', {
    apiKey: 'test-key', cache: false, settings: { provider: 'openrouter', enableAiIntent: true },
    chatJson: async () => 'not json',
  }), /невалидный JSON/);

  await assert.rejects(() => resolveCommandWithAi('ошибка провайдера', {
    apiKey: 'test-key', cache: false, settings: { provider: 'openrouter', enableAiIntent: true },
    chatJson: async () => { throw new Error('simulated provider failure'); },
  }), /simulated provider failure/);

  await assert.rejects(() => resolveCommandWithAi('таймаут провайдера', {
    apiKey: 'test-key', cache: false, settings: { provider: 'openrouter', enableAiIntent: true },
    chatJson: async () => { throw new Error('simulated provider timeout'); },
  }), /simulated provider timeout/);

  const attemptedModels = [];
  const fallbackResult = await resolveCommandWithAi('попробуй резервную модель', {
    apiKey: 'test-key',
    cache: false,
    settings: {
      provider: 'openrouter',
      textModel: 'test/primary',
      fallbackModels: ['test/fallback'],
      enableAiIntent: true,
    },
    capabilities: ['launch_app'],
    chatJson: async (_messages, transportOptions) => {
      attemptedModels.push(transportOptions.model);
      if (transportOptions.model === 'test/primary') throw new Error('primary unavailable');
      return JSON.stringify({
        schemaVersion: 2,
        route: 'direct',
        action: 'launch_app',
        appQuery: 'notepad',
        confidence: 0.95,
      });
    },
  });
  assert.strictEqual(fallbackResult.appQuery, 'notepad');
  assert.deepStrictEqual(attemptedModels, ['test/primary', 'test/fallback']);
}

async function testLegacyCacheIsIgnored() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-intent-cache-'));
  const cachePath = path.join(tempDir, 'ai-cache.json');
  let transportCalls = 0;

  try {
    fs.writeFileSync(cachePath, JSON.stringify({
      entries: [{
        key: 'легаси-ключ',
        input: 'открой блокнот',
        result: { route: 'direct', action: 'launch_app', appQuery: 'unsafe legacy', confidence: 1 },
      }],
    }), 'utf-8');

    const result = await resolveCommandWithAi('открой блокнот', {
      apiKey: 'test-key',
      cachePath,
      mode: 'voice',
      capabilities: ['launch_app'],
      settings: { provider: 'openrouter', textModel: 'test/model', enableAiIntent: true },
      chatJson: async () => {
        transportCalls += 1;
        return JSON.stringify({
          schemaVersion: 2,
          route: 'direct',
          action: 'launch_app',
          appQuery: 'notepad',
          confidence: 0.95,
        });
      },
    });

    assert.strictEqual(result.appQuery, 'notepad');
    assert.strictEqual(transportCalls, 1);
    const saved = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    assert.strictEqual(saved.entries[0].schemaVersion, 2);
    assert(saved.entries[0].key.startsWith('v2:voice:test/model:'));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testRouting() {
  let aiCalls = 0;
  const local = await routeIntent('локальная команда', {
    parseIntent: () => ({ ok: true, action: 'translate_selected', source: 'regex' }),
    resolveCommandWithAi: async () => { aiCalls += 1; return null; },
  });
  assert.strictEqual(local.action, 'translate_selected');
  assert.strictEqual(aiCalls, 0);

  const original = 'найди все png и перемести их в Images';
  const agent = await routeIntent(original, {
    parseIntent: () => ({ ok: false, reason: 'unknown' }),
    resolveCommandWithAi: async () => ({ route: 'desktop_agent', confidence: 0.93, reason: 'multi-step' }),
  });
  assert.strictEqual(agent.action, 'desktop_agent');
  assert.strictEqual(agent.command, original);

  const file = await routeIntent('покажи конфиг среди документов', {
    parseIntent: () => ({ ok: false }),
    resolveCommandWithAi: async () => ({
      route: 'direct', action: 'reveal_file', query: 'config', location: 'documents', confidence: 0.9,
    }),
  });
  assert.strictEqual(file.action, 'reveal_file');
  assert.strictEqual(file.location, 'documents');

  const app = mapAiResultToIntent({
    route: 'direct', action: 'launch_app', appQuery: 'Блокнот', confidence: 0.9,
  }, 'открой блокнот');
  assert.strictEqual(app.appId, 'notepad');
  assert.strictEqual(resolveKnownAppId('fire fox'), 'firefox');

  const unknownApp = mapAiResultToIntent({
    route: 'direct', action: 'launch_app', appQuery: 'imaginary app', confidence: 0.9,
  }, 'открой что-то');
  assert.strictEqual(unknownApp.ok, true);
  assert.strictEqual(unknownApp.action, 'recover_app');
  assert.strictEqual(unknownApp.appQuery, 'imaginary app');
}

function testCacheIdentity() {
  const base = cacheIdentity('Открой блокнот', {
    mode: 'voice', model: 'openrouter/free', capabilities: ['launch_app'],
  });
  assert(base.startsWith('v2:voice:openrouter/free:'));
  assert.notStrictEqual(base, cacheIdentity('Открой блокнот', {
    mode: 'launcher', model: 'openrouter/free', capabilities: ['launch_app'],
  }));
  assert.notStrictEqual(base, cacheIdentity('Открой блокнот', {
    mode: 'voice', model: 'openrouter/free', capabilities: ['find_file'],
  }));
  assert.deepStrictEqual(parseJsonResponse('```json\n{"route":"unknown","confidence":0}\n```'), {
    route: 'unknown', confidence: 0,
  });
}

async function testLauncherAgentEscalation() {
  const resolverModule = require('../tools/aiIntentResolver');
  const appResolverModule = require('../tools/appResolver');
  const originalResolver = resolverModule.resolveCommandWithAi;
  const originalAppResolve = appResolverModule.resolve;
  resolverModule.resolveCommandWithAi = async () => ({
    schemaVersion: 2,
    route: 'desktop_agent',
    action: null,
    confidence: 0.94,
    reason: 'multi-step',
  });
  appResolverModule.resolve = () => ({ ok: false, notFound: true, message: 'Не найдено' });

  try {
    delete require.cache[require.resolve('../tools/runProgram')];
    const runProgram = require('../tools/runProgram');
    const command = 'собери все png и разложи их по папкам';
    const result = await runProgram.execute({ app: command, _noLaunch: true });
    assert.strictEqual(result.needsAgent, true);
    assert.strictEqual(result.command, command);
    assert.strictEqual(result.type, 'agent');
  } finally {
    resolverModule.resolveCommandWithAi = originalResolver;
    appResolverModule.resolve = originalAppResolve;
    delete require.cache[require.resolve('../tools/runProgram')];
  }
}

async function testLauncherUsesLocalResolverForAiAppQuery() {
  const resolverModule = require('../tools/aiIntentResolver');
  const appResolverModule = require('../tools/appResolver');
  const originalResolver = resolverModule.resolveCommandWithAi;
  const originalAppResolve = appResolverModule.resolve;
  const seenQueries = [];

  resolverModule.resolveCommandWithAi = async () => ({
    schemaVersion: 2,
    route: 'direct',
    action: 'launch_app',
    appQuery: 'notepad',
    confidence: 0.96,
  });
  appResolverModule.resolve = (query) => {
    seenQueries.push(query);
    if (query === 'notepad') {
      return { ok: true, app: { name: 'Notepad', type: 'path', path: 'test-only', score: 0.99 } };
    }
    return { ok: false, notFound: true, message: 'Не найдено' };
  };

  try {
    delete require.cache[require.resolve('../tools/runProgram')];
    const runProgram = require('../tools/runProgram');
    const result = await runProgram.execute({ app: 'старый текстовый редактор', _noLaunch: true });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.data.name, 'Notepad');
    assert(seenQueries.includes('notepad'));
  } finally {
    resolverModule.resolveCommandWithAi = originalResolver;
    appResolverModule.resolve = originalAppResolve;
    delete require.cache[require.resolve('../tools/runProgram')];
  }
}

async function testLauncherKeepsAmbiguousAiCandidates() {
  const resolverModule = require('../tools/aiIntentResolver');
  const appResolverModule = require('../tools/appResolver');
  const originalResolver = resolverModule.resolveCommandWithAi;
  const originalAppResolve = appResolverModule.resolve;

  resolverModule.resolveCommandWithAi = async () => ({
    schemaVersion: 2,
    route: 'direct',
    action: 'search_app',
    appQuery: 'code',
    confidence: 0.91,
  });
  appResolverModule.resolve = (query) => {
    if (query !== 'code') return { ok: false, notFound: true, message: 'Не найдено' };
    return {
      ok: false,
      needsSelection: true,
      candidates: [
        { name: 'Code A', type: 'path', path: 'test-a', score: 0.91 },
        { name: 'Code B', type: 'path', path: 'test-b', score: 0.89 },
      ],
    };
  };

  try {
    delete require.cache[require.resolve('../tools/runProgram')];
    const runProgram = require('../tools/runProgram');
    const result = await runProgram.execute({ app: 'редактор кода', _noLaunch: true });
    assert.strictEqual(result.needsSelection, true);
    assert.strictEqual(result.candidates.length, 2);
  } finally {
    resolverModule.resolveCommandWithAi = originalResolver;
    appResolverModule.resolve = originalAppResolve;
    delete require.cache[require.resolve('../tools/runProgram')];
  }
}

async function testLauncherRejectsUnsupportedAiAction() {
  const resolverModule = require('../tools/aiIntentResolver');
  const appResolverModule = require('../tools/appResolver');
  const originalResolver = resolverModule.resolveCommandWithAi;
  const originalAppResolve = appResolverModule.resolve;

  resolverModule.resolveCommandWithAi = async () => ({
    schemaVersion: 2,
    route: 'direct',
    action: 'find_file',
    query: 'secret.txt',
    location: 'computer',
    confidence: 0.99,
  });
  appResolverModule.resolve = () => ({ ok: false, notFound: true, message: 'Не найдено' });

  try {
    delete require.cache[require.resolve('../tools/runProgram')];
    const runProgram = require('../tools/runProgram');
    const result = await runProgram.execute({ app: 'неподдерживаемое действие', _noLaunch: true });
    assert.strictEqual(result.notFound, true);
    assert.strictEqual(result.needsAgent, undefined);
  } finally {
    resolverModule.resolveCommandWithAi = originalResolver;
    appResolverModule.resolve = originalAppResolve;
    delete require.cache[require.resolve('../tools/runProgram')];
  }
}

function testRendererAgentHandoffWiring() {
  const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'renderer.js'), 'utf-8');
  assert(rendererSource.includes('result.needsAgent && result.command'));
  assert(rendererSource.includes('window.jarvis.startAgentTask(result.command, {'));
  assert(rendererSource.includes('function agentEscalationContext(result, toolName)'));
  assert(rendererSource.includes('initialContext: escalationContext'));
  assert(rendererSource.includes('escalationKind: escalationContext.kind'));
}

async function run() {
  testNormalization();
  testCacheIdentity();
  testRendererAgentHandoffWiring();
  await testResolverBoundaries();
  await testLegacyCacheIsIgnored();
  await testRouting();
  await testLauncherAgentEscalation();
  await testLauncherUsesLocalResolverForAiAppQuery();
  await testLauncherKeepsAmbiguousAiCandidates();
  await testLauncherRejectsUnsupportedAiAction();
  console.log('[testIntentRouter] unified intent routing tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
