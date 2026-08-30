const assert = require('assert');
const { buildMessages, parseMatchResponse, localFallback, matchCandidates, sanitizeProviderQuery } = require('../tools/aiAppMatcher');

const candidates = [
  {
    candidateId: 'candidate-1', displayName: 'Obsidian', localScore: 0.92,
    launch: { type: 'exe', target: 'D:\\Secret\\Obsidian.exe', args: [] },
    productName: 'Obsidian', description: 'Notes', publisher: 'Dynalist',
    signatureStatus: 'valid', generalizedLocation: 'other local drive', aliases: [],
  },
  {
    candidateId: 'candidate-2', displayName: 'Other', localScore: 0.61,
    launch: { type: 'exe', target: 'D:\\Secret\\Other.exe', args: [] },
    productName: '', description: '', publisher: '', signatureStatus: 'unknown', generalizedLocation: 'other local drive', aliases: [],
  },
];

const messages = buildMessages('обсидиан', candidates);
assert.strictEqual(messages[1].content.includes('D:\\Secret'), false);
assert.strictEqual(sanitizeProviderQuery('открой "C:\\Users\\maxob\\Secret App\\app.exe"', { usernames: ['maxob'] }).includes('maxob'), false);
assert.strictEqual(sanitizeProviderQuery('открой приложение maxob', { usernames: ['maxob'] }).includes('maxob'), false);
const parsed = parseMatchResponse(JSON.stringify({
  schemaVersion: 1, candidateId: 'candidate-1', confidence: 0.95,
  aliases: ['обсидиан'], reason: 'match',
}), candidates);
assert.strictEqual(parsed.candidateId, 'candidate-1');
assert.throws(() => parseMatchResponse(JSON.stringify({
  schemaVersion: 1, candidateId: 'candidate-1', confidence: 1,
  aliases: [], reason: '', path: 'D:\\evil.exe',
}), candidates), /forbidden field/);
assert.throws(() => parseMatchResponse(JSON.stringify({
  schemaVersion: 1, candidateId: 'candidate-x', confidence: 1, aliases: [], reason: '',
}), candidates), /unknown candidateId/);
assert.strictEqual(localFallback(candidates).mode, 'single');

(async () => {
  const ai = await matchCandidates('обсидиан', candidates, {
    apiKey: 'valid-key',
    settings: { appRecovery: {}, textModel: 'test' },
    chatJson: async () => JSON.stringify({
      schemaVersion: 1, candidateId: 'candidate-1', confidence: 0.96,
      aliases: ['обсидиан'], reason: 'match',
    }),
  });
  assert.strictEqual(ai.mode, 'single');
  assert.strictEqual(ai.aiUsed, true);

  const offline = await matchCandidates('обсидиан', candidates, { apiKey: '', settings: { appRecovery: {} } });
  assert.strictEqual(offline.mode, 'single');
  assert.strictEqual(offline.aiUsed, false);
  console.log('testAiAppMatcher: ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
