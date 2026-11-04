const { createHash } = require('node:crypto');
const { parseJobLetter } = require('./jobPrompt');
const { jobError } = require('./jobSchemas');

const REASONS = new Set(['truncated', 'filtered', 'size', 'json', 'schema']);
function validationReason(error) {
  return error?.code === 'JOB_MODEL_INVALID_FACTS' ? 'facts'
    : error?.code === 'JOB_MODEL_INVALID_OUTPUT' && REASONS.has(error.validationReason) ? error.validationReason : null;
}
const repairRequestId = requestId => `letter-repair:${createHash('sha256').update(requestId).digest('hex')}`;

// beforeCall persists a checkpoint before each billable invocation. A transport
// exception is never retried: only a conclusively received, invalid reply is.
async function generateLetter({ messages, profile, requestId, allowRepair, beforeCall, invoke, record, onInvalid }) {
  for (let attempt = 0; attempt < (allowRepair ? 2 : 1); attempt++) {
    const usageId = attempt ? repairRequestId(requestId) : requestId;
    await beforeCall({ attempt, usageId });
    let result;
    try { result = await invoke({ messages: attempt ? [...messages, { role: 'user', content:
      'The previous response failed the letter contract. Return status, text and factIds only. '
      + 'Respect all length limits and supplied fact IDs. If personal information is missing, '
      + 'use needs_applicant_answer with empty text and factIds. Do not invent facts or intentions.' }] : messages }); }
    catch (error) { error.letterUsageId = usageId; throw error; }
    await record({ usageId, result });
    try { return parseJobLetter(result.text, profile, { finishReason: result.finishReason }); }
    catch (error) {
      const reason = validationReason(error);
      if (!allowRepair || !reason) throw error;
      await onInvalid?.({ attempt, reason,
        field: ['text','factIds','status','object'].includes(error.validationField) ? error.validationField : null });
      if (attempt === 1) throw Object.assign(jobError('JOB_LETTER_VALIDATION_FAILED'), {
        validationReason: reason, validationField: error.validationField || null,
      });
    }
  }
}

module.exports = { generateLetter, validationReason, repairRequestId };
