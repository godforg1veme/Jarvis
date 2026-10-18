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
    this.accessService = options.accessService || null;
  }

  setLifeContextComposer(composer) {
    this.lifeContextComposer = composer || null;
  }

  async answer(input) {
    const access = this.accessService && input.userId ? await this.accessService.getAccessForUser(input.userId) : null;
    const allowed = (permission) => !this.accessService || Boolean(access && !access.blocked && access.permissions.includes(permission));
    const required = new Set(['assistant']);
    const requireAccess = async () => {
      if (!this.accessService) return;
      const current = await this.accessService.getAccessForUser(input.userId);
      if (!current || current.blocked || [...required].some((permission) => !current.permissions.includes(permission))) {
        throw Object.assign(new Error('Access unavailable'), { statusCode: 403, publicCode: 'PERMISSION_DENIED' });
      }
    };
    await requireAccess();
    let life = null;
    const usesComposer = Boolean(this.lifeContextComposer && input.userId && allowed('life'));
    if (usesComposer || (input.lifeContext && allowed('life'))) required.add('life');
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
      memories: allowed('memory') ? input.memories : [],
      documents: allowed('documents') ? input.documents : [],
      devices: allowed('devices') ? input.devices : [],
      visualMemories: allowed('memory') && allowed('devices') ? input.visualMemories : [],
      communicationGuidance: usesComposer ? (life?.communicationGuidance || null) : input.communicationGuidance,
      lifeContext: usesComposer ? (life?.lifeContext || null) : allowed('life') ? input.lifeContext : null,
    };
    if (effectiveInput.memories?.length) required.add('memory');
    if (effectiveInput.documents?.length) required.add('documents');
    if (effectiveInput.devices?.length) required.add('devices');
    if (effectiveInput.visualMemories?.length) { required.add('memory'); required.add('devices'); }
    await requireAccess();
    const canonical = buildCanonicalPrompt(effectiveInput);
    let correctionViolations = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const messages = adaptPrompt(canonical, this.profile, { correctionViolations });
      const answer = await this.provider.answer({ ...effectiveInput, messages });
      await requireAccess();
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
