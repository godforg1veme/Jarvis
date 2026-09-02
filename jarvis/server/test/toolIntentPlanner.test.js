const assert = require('node:assert/strict');
const test = require('node:test');
const { createActionManifest } = require('../src/orchestrator/actionManifest');
const { ToolIntentPlanner, deterministicPlan, extractJson } = require('../src/orchestrator/toolIntentPlanner');

test('deterministic planner handles arbitrary folder names and natural drive letters without a model call', async () => {
  const planner = new ToolIntentPlanner({
    manifest: createActionManifest(),
    provider: { async answer() { throw new Error('model must not be called'); } },
  });
  const cases = [
    ['Найди и открой папку Obsidian на диске F', 'Obsidian', 'F:\\'],
    ['Открой каталог Проекты 2026 на диске Д', 'Проекты 2026', 'D:\\'],
    ['find and open folder Family Photos on disk C', 'Family Photos', 'C:\\'],
  ];
  for (const [text, query, location] of cases) {
    const result = await planner.plan({ text, history: [], devices: [], availableActions: ['file.search'], workflowState: {} });
    assert.deepEqual(result, { kind: 'tool_call', action: 'file.search', args: { query, location, targetType: 'directory' } });
  }
});

test('deterministic planner searches a named file before revealing it', () => {
  assert.deepEqual(deterministicPlan({
    text: 'Найди файл winmm.txt на диске Ф и покажи в проводнике',
    availableActions: ['file.search'],
  }), {
    kind: 'tool_call',
    action: 'file.search',
    args: { query: 'winmm.txt', location: 'F:\\', targetType: 'file' },
  });
});

test('deterministic planner opens an explicit Windows path instead of searching for the whole path', () => {
  const path = 'C:\\Users\\owner\\Desktop\\live-confirmation-open.bat';
  assert.deepEqual(deterministicPlan({
    text: `Открой файл ${path}`,
    availableActions: ['file.search', 'file.open'],
  }), {
    kind: 'tool_call',
    action: 'file.open',
    args: { path },
  });
});

test('planner accepts one strict JSON action and validates it against the manifest', async () => {
  const calls = [];
  const planner = new ToolIntentPlanner({
    manifest: createActionManifest(),
    provider: { async answer(input) { calls.push(input); return '{"kind":"tool_call","action":"file.search","args":{"query":"Tabletop Simulator","location":"F:\\\\","targetType":"directory"}}'; } },
  });
  const result = await planner.plan({ text: 'выполни действие', history: [], devices: [], availableActions: ['file.search'], workflowState: {} });
  assert.equal(result.action, 'file.search');
  assert.equal(calls[0].runtimeContext.toolsAvailable[0], 'file.search');
  assert.match(calls[0].messages[0].content, /Candidate IDs are single-use/);
  assert.match(calls[0].messages[0].content, /Do not open a drive root merely because it was supplied as a search location/);
});

test('planner corrects one invalid response and never permits an undeclared action', async () => {
  let call = 0;
  const planner = new ToolIntentPlanner({
    manifest: createActionManifest(),
    provider: { async answer() { call += 1; return call === 1 ? '{"kind":"tool_call","action":"shell.exec","args":{}}' : '{"kind":"answer","text":""}'; } },
  });
  const result = await planner.plan({ text: 'привет', history: [], devices: [], availableActions: ['file.search'], workflowState: {} });
  assert.deepEqual(result, { kind: 'answer', text: '' });
  assert.equal(call, 2);
});

test('planner JSON parser rejects explanatory text outside the object', () => {
  assert.deepEqual(extractJson('```json\n{"kind":"answer","text":""}\n```'), { kind: 'answer', text: '' });
  assert.throws(() => extractJson('Sure: {"kind":"answer","text":""}'));
});
