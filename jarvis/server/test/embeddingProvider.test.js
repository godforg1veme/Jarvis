const assert = require('node:assert/strict');
const test = require('node:test');
const {
  OpenAiCompatibleEmbeddingProvider,
  embeddingsUrl,
  normalizeVector,
  vectorLiteral,
} = require('../src/knowledge/embeddingProvider');
const { reciprocalRankFusion } = require('../src/knowledge/hybridSearch');

test('embedding provider uses the configured endpoint and keeps response order', async () => {
  const calls = [];
  const provider = new OpenAiCompatibleEmbeddingProvider({
    baseUrl: 'https://embeddings.example.test/v1',
    apiKey: 'test-key',
    model: 'test-embedding',
    dimensions: 3,
    batchSize: 1,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        async text() {
          const body = JSON.parse(options.body);
          return JSON.stringify({ data: body.input.map((_, index) => ({ index: 0, embedding: [index + 1, 2, 3] })) });
        },
      };
    },
  });

  const result = await provider.embedDocuments(['first', 'second']);
  assert.equal(embeddingsUrl(provider.baseUrl), 'https://embeddings.example.test/v1/embeddings');
  assert.deepEqual(result, [[1, 2, 3], [1, 2, 3]]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-key');
  assert.equal(JSON.parse(calls[0].options.body).model, 'test-embedding');
});

test('embedding vectors are bounded and safely converted to pgvector literals', () => {
  assert.deepEqual(normalizeVector([0.25, -1, 2]), [0.25, -1, 2]);
  assert.equal(vectorLiteral([0.25, -1, 2]), '[0.25,-1,2]');
  assert.throws(() => normalizeVector([Number.NaN]), /non-finite/);
});

test('hybrid search combines lexical and semantic ranks with stable RRF ordering', () => {
  const result = reciprocalRankFusion([
    [{ id: 1, document_id: 'a', position: 0 }, { id: 2, document_id: 'a', position: 1 }],
    [{ id: 2, document_id: 'a', position: 1 }, { id: 3, document_id: 'b', position: 0 }],
  ], { limit: 3 });
  assert.deepEqual(result.map((item) => item.id), [2, 1, 3]);
  assert.ok(result[0].hybrid_score > result[1].hybrid_score);
});
