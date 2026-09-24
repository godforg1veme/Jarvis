const { buildCanonicalPrompt } = require('../prompts/promptBuilder');
const { adaptPrompt } = require('../prompts/promptAdapter');
const { validateOutput } = require('./outputPolicyValidator');

class ModelPolicyViolationError extends Error {
  constructor(violations) {
    super('model response violated the Jarvis policy');
    this.name = 'ModelPolicyViolationError';
    this.code = 'MODEL_POLICY_VIOLATION';
    this.violations = [...violations];
  }
}

class AssistantService {
  constructor(options) {
    this.provider = options.provider;
    this.profile = options.profile;
    this.logger = options.logger || null;
    this.lifeContextComposer = options.lifeContextComposer || null;
  }

  setLifeContextComposer(composer) {
    this.lifeContextComposer = composer || null;
  }

  async answer(input) {
    let life = null;
    const usesComposer = Boolean(this.lifeContextComposer && input.userId);
    if (usesComposer) {
      try {
        life = await this.lifeContextComposer.compose({
          userId: input.userId,
          channel: input.runtimeContext?.channel || 'unknown',
          conversationId: input.conversationId || null,
          deviceId: input.deviceId || null,
          text: input.currentRequest,
          locale: input.locale || 'ru-RU',
        });
      } catch {
        if (this.logger) this.logger.warn({ errorCode: 'LIFE_CONTEXT_UNAVAILABLE' }, 'Life context composition failed');
      }
    }
    const effectiveInput = {
      ...input,
      communicationGuidance: usesComposer ? (life?.communicationGuidance || null) : input.communicationGuidance,
      lifeContext: usesComposer ? (life?.lifeContext || null) : input.lifeContext,
    };
    const canonical = buildCanonicalPrompt(effectiveInput);
    let correctionViolations = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const messages = adaptPrompt(canonical, this.profile, { correctionViolations });
      const answer = await this.provider.answer({ ...effectiveInput, messages });
      const validation = validateOutput(answer, canonical.runtime);
      if (validation.ok) return String(answer).trim();
      correctionViolations = validation.violations;
      if (this.logger) {
        this.logger.warn({
          policyId: canonical.policy.id,
          provider: this.profile.provider,
          model: this.profile.model,
          attempt: attempt + 1,
          violations: correctionViolations,
        }, 'model response policy violation');
      }
    }
    throw new ModelPolicyViolationError(correctionViolations);
  }
}

module.exports = {
  AssistantService,
  ModelPolicyViolationError,
};
