// Explicit opt-in, paid model evaluation. Profile and full letters stay in an ignored output file.
const fs = require('node:fs/promises');
const { performance } = require('node:perf_hooks');
const { buildJobPrompt, parseJobLetter, JOB_LETTER_RESPONSE_FORMAT } = require('../src/jobs/jobPrompt');
const { OpenAiCompatibleProvider } = require('../src/providers/openAiCompatibleProvider');
const { JOB_MODEL_EVALUATION_CASES } = require('./fixtures/jobModelEvaluationCases');

async function evaluateJobModels({ apiKey, profile, models, cases = JOB_MODEL_EVALUATION_CASES, onProgress = () => {} }) {
  if (!apiKey || !Array.isArray(models) || !models.length || models.length > 3) throw new Error('Explicit model configuration required');
  const rows = [];
  for (const candidate of cases) {
    for (const model of models) {
      const provider = new OpenAiCompatibleProvider({ name: 'job-model-evaluation', baseUrl: 'https://openrouter.ai/api/v1',
        apiKey, model, reasoning: { enabled: false, exclude: true }, timeoutMs: 120000,
        providerRouting: { require_parameters: true } });
      const started = performance.now();
      const row = { caseId: candidate.id, model, source: candidate.source || null, fixture: Boolean(candidate.fixture),
        occurredAt: new Date().toISOString(), schemaValid: false, costUsd: null };
      try {
        const result = await provider.answerWithUsage({ messages: buildJobPrompt({ vacancy: candidate, profile,
          language: candidate.language, instruction: candidate.instruction || '', previousText: candidate.previousText || '' }),
        maxTokens: 6000, includeUsage: true, responseFormat: JOB_LETTER_RESPONSE_FORMAT });
        row.providerRequestId = result.requestId; row.costUsd = result.usage.cost ?? null;
        const letter = parseJobLetter(result.text, profile, { finishReason: result.finishReason });
        row.schemaValid = true; row.letter = letter.text; row.factIds = letter.factIds;
        row.wordCount = letter.text.trim().split(/\s+/u).length;
        row.expectedLanguage = candidate.language;
        row.languageCheck = candidate.language === 'ru' ? /[а-яё]/iu.test(letter.text) : !/[а-яё]/iu.test(letter.text);
        row.forbiddenClaims = /73\s*%|foundation model|фундаментальн[а-яё ]+модел|published research papers|две научные публикации/iu.test(letter.text);
        row.shortEditCheck = candidate.id !== 'short-edit' || row.wordCount <= 120;
      } catch (error) {
        row.failureCode = ['JOB_MODEL_INVALID_OUTPUT', 'JOB_MODEL_INVALID_FACTS'].includes(error?.code)
          ? error.code : 'JOB_EVALUATION_FAILED';
      }
      row.durationMs = Math.round(performance.now() - started); rows.push(row);
      onProgress({ caseId: row.caseId, model: row.model, schemaValid: row.schemaValid, costUsd: row.costUsd });
    }
  }
  return { checkedAt: new Date().toISOString(), rows,
    summary: models.map((model) => { const r = rows.filter((x) => x.model === model); return { model, cases: r.length,
      schemaValid: r.filter((x) => x.schemaValid).length, languageValid: r.filter((x) => x.languageCheck).length,
      forbiddenClaims: r.filter((x) => x.forbiddenClaims).length, shortEditValid: r.filter((x) => x.shortEditCheck).length,
      knownCostUsd: r.reduce((sum, x) => sum + (x.costUsd || 0), 0), pendingCost: r.filter((x) => x.costUsd == null).length }; }) };
}

if (require.main === module) (async () => {
  if (process.env.JARVIS_JOB_MODEL_EVAL !== '1') throw new Error('Explicit evaluation opt-in required');
  const profilePath = process.env.JARVIS_JOB_EVAL_PROFILE;
  const outputPath = process.env.JARVIS_JOB_EVAL_OUTPUT;
  if (!profilePath || !outputPath || profilePath === outputPath) throw new Error('Private profile and output paths required');
  const profile = JSON.parse(await fs.readFile(profilePath, 'utf8'));
  const result = await evaluateJobModels({ apiKey: process.env.OPENROUTER_API_KEY, profile,
    models: String(process.env.JARVIS_JOB_EVAL_MODELS || '').split(',').filter(Boolean),
    onProgress: (row) => process.stderr.write(`${JSON.stringify(row)}\n`) });
  await fs.writeFile(outputPath, JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify(result.summary));
})().catch(() => { console.error('JOB_MODEL_EVALUATION_FAILED'); process.exitCode = 1; });

module.exports = { evaluateJobModels };
