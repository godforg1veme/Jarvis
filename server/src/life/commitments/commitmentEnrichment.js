const { z } = require('zod');

const modelSuggestionSchema = z.object({
  isCommitment: z.boolean(),
  confidence: z.number().min(0).max(1).optional(),
}).strict();

async function applyCommitmentSuggestion(classify, input, deterministic) {
  if (typeof classify !== 'function') return deterministic;
  try {
    const suggestion = modelSuggestionSchema.parse(await classify({
      text: input.text.slice(0, 1000),
      deterministic: {
        action: deterministic.action, hasDate: Boolean(deterministic.dueAt),
        hasRecurrence: Boolean(deterministic.recurrence), confidence: deterministic.confidence,
      },
    }));
    if (!suggestion.isCommitment) return deterministic;
    return {
      ...deterministic,
      confidence: Math.min(Math.max(suggestion.confidence ?? deterministic.confidence, deterministic.confidence - 0.1), 0.95),
    };
  } catch (_) {
    return deterministic;
  }
}

module.exports = { applyCommitmentSuggestion, modelSuggestionSchema };
