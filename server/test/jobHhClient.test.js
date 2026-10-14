const test = require('node:test');
const assert = require('node:assert/strict');
const { HhClient, normalizeHhVacancy } = require('../src/jobs/hhClient');
const { readBoundedJson } = require('../src/jobs/boundedHttp');

test('HH client normalizes only public bounded fields and never follows supplied vacancy URLs', async () => {
  const requests = [];
  const client = new HhClient({ fetchImpl: async (url, options) => {
    requests.push({ url: String(url), options });
    return Response.json({ id: '123', name: 'AI Engineer', published_at: '2026-10-15T00:00:00Z',
      url: 'https://untrusted.example/steal', description: 'LLM integration',
      work_format: [{ id: 'REMOTE' }], employer: { name: 'Fixture Company' } });
  } });
  const vacancy = await client.getVacancy({ externalId: '123' });
  assert.equal(requests[0].url, 'https://api.hh.ru/vacancies/123');
  assert.equal(requests[0].options.redirect, 'manual');
  assert.equal(vacancy.url, 'https://hh.ru/vacancy/123');
  assert.equal(vacancy.workFormat, 'remote');
  await assert.rejects(client.getVacancy({ externalId: '../other' }));
  assert.throws(() => new HhClient({ baseUrl: 'http://example.org/' }));
  assert.throws(() => normalizeHhVacancy({ id: '123' }));
});

test('bounded reads abort dishonest streaming responses before buffering too much', async () => {
  let cancelled = false;
  const body = new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(1024)); }, cancel() { cancelled = true; } });
  await assert.rejects(readBoundedJson(new Response(body), 100), { code: 'JOB_RESPONSE_TOO_LARGE' });
  assert.equal(cancelled, true);
});

test('HH transport classifies rate limits and mutation uncertainty without raw bodies', async () => {
  const limited = new HhClient({ fetchImpl: async () => new Response('private upstream content', { status: 429, headers: { 'retry-after': '120' } }) });
  await assert.rejects(limited.search({ query: 'AI', publishedFrom: '2026-10-01', publishedTo: '2026-10-15' }),
    (e) => e.code === 'JOB_HH_RATE_LIMIT' && e.retryAfterMs === 120000 && !e.message.includes('private'));
  const disconnected = new HhClient({ fetchImpl: async () => { throw new Error('private network data'); } });
  await assert.rejects(disconnected.request('/negotiations', { method: 'POST', body: { vacancy_id: '123' } }),
    { code: 'JOB_HH_OUTCOME_UNKNOWN' });
});
