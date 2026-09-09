const assert = require('node:assert/strict');
const test = require('node:test');
const { OpenRouterVisionProvider, SYSTEM_PROMPT } = require('../src/vision/openRouterVisionProvider');

const metadata = { frameId: 'frame-a', sourceId: 'camera-a', capturedAt: '2026-09-09T10:00:00.000Z', contentType: 'image/jpeg' };

test('OpenRouter vision sends untrusted image data and validates structured observations', async () => {
  let sent;
  const provider = new OpenRouterVisionProvider({ apiKey: 'secret', model: 'vision-model', fetchImpl: async (url, options) => {
    sent = { url, options };
    return { ok: true, async text() { return JSON.stringify({ choices: [{ message: { content: JSON.stringify({ observedAt: '2026-09-09T10:00:01.000Z', sceneSummary: 'Стол', sensitivity: 'none', confidence: 0.9, objects: [], texts: [], events: [] }) } }] }); } };
  } });
  const observation = await provider.observe({ image: Buffer.from([0xff, 0xd8, 0xff, 0xd9]), metadata, prompt: 'Что тут?' });
  assert.equal(observation.frameId, 'frame-a');
  assert.match(SYSTEM_PROMPT, /untrusted data/);
  assert.equal(sent.options.headers.Authorization, 'Bearer secret');
  assert.doesNotMatch(sent.options.body, /Bearer secret/);
  assert.match(JSON.parse(sent.options.body).messages[1].content[1].image_url.url, /^data:image\/jpeg;base64,/);
});

test('OpenRouter vision rejects malformed provider output', async () => {
  let calls = 0;
  const provider = new OpenRouterVisionProvider({ apiKey: 'secret', model: 'vision-model', fetchImpl: async () => { calls += 1; return { ok: true, async text() { return '{"choices":[{"message":{"content":"not json"}}]}'; } }; } });
  await assert.rejects(provider.observe({ image: Buffer.from('x'), metadata }), /VISION_RESPONSE_INVALID/);
  assert.equal(calls, 2, 'one corrective retry is allowed');
});
