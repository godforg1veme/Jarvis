const MAX_TEXT_LENGTH = 10000;
const { attachmentReply, isDeviceAttachmentQuestion } = require('../devices/deviceReplies');
const { renderDocumentCitations } = require('../knowledge/knowledgeService');
const { remoteCommandReply } = require('../commands/commandText');
const { recordMessageEvent } = require('../life/lifeSourceEvents');

class DesktopRequestPendingError extends Error {
  constructor() {
    super('request is already being processed');
    this.name = 'DesktopRequestPendingError';
    this.statusCode = 409;
    this.publicCode = 'REQUEST_IN_PROGRESS';
  }
}

class DesktopRequestFailedError extends Error {
  constructor() {
    super('request previously failed');
    this.name = 'DesktopRequestFailedError';
    this.statusCode = 409;
    this.publicCode = 'REQUEST_RETRY_WITH_NEW_ID';
  }
}

function normalizeContent(value) {
  const content = String(value || '').trim();
  if (!content || content.length > MAX_TEXT_LENGTH) throw new Error('desktop message text is invalid');
  return content;
}

class DesktopMessageService {
  constructor(options) {
    this.requestRepository = options.requestRepository;
    this.conversationRepository = options.conversationRepository;
    this.assistant = options.assistant;
    this.memoryService = options.memoryService || null;
    this.deviceService = options.deviceService || null;
    this.knowledgeService = options.knowledgeService || null;
    this.commandService = options.commandService || null;
    this.orchestrator = options.orchestrator || null;
    this.visualMemoryService = options.visualMemoryService || null;
    this.vpnService = options.vpnService || null;
    this.lifeEventGateway = options.lifeEventGateway || null;
    this.accessService = options.accessService || null;
  }

  async getStatus({ device, clientMessageId }) {
    const requirePermission = async (permission) => {
      if (this.accessService && !await this.accessService.allows(device.user_id, permission)) {
        throw Object.assign(new Error('Access unavailable'), { statusCode: 403, publicCode: 'PERMISSION_DENIED' });
      }
    };
    await requirePermission('assistant');
    const request = await this.requestRepository.getForDevice({
      userId: device.user_id, deviceId: device.id, clientMessageId,
    });
    const result = { clientMessageId, status: 'not_found' };
    if (!request || request.user_id !== device.user_id || request.device_id !== device.id) return result;
    if (request.status !== 'completed') {
      result.status = request.status === 'processing' ? 'processing' : 'failed';
      return result;
    }
    const saved = request.response || {};
    // Old records have no provenance. Do not reveal their cached data after a grant revocation.
    await this._requireRecoveryPermissions(device, saved);
    const response = {};
    for (const key of ['status', 'conversationId', 'messageId', 'answerMessageId', 'answer', 'transcript']) {
      if (typeof saved[key] === 'string') response[key] = saved[key];
    }
    const commandId = saved.confirmation?.commandId;
    if (typeof commandId === 'string' && /^[a-f0-9-]{36}$/i.test(commandId)) {
      response.confirmation = { commandId };
    }
    if (Array.isArray(saved.buttons)) {
      response.buttons = saved.buttons.slice(0, 10).filter(Array.isArray).map((row) => row.slice(0, 10)
        .filter((button) => typeof button?.text === 'string' && /^cmd:(confirm|reject):[a-f0-9-]{36}$/i.test(button.data))
        .map((button) => ({ text: button.text.slice(0, 200), data: button.data })));
    }
    if (saved.artifactUnavailable === true) response.artifactUnavailable = true;
    return { clientMessageId, status: 'completed', response };
  }

  async _requireRecoveryPermissions(device, saved) {
    const permissions = saved._recoveryPermissions || ['assistant', 'memory', 'documents', 'devices', 'vpn', 'life'];
    for (const permission of new Set(['assistant', ...permissions])) {
      if (this.accessService && !await this.accessService.allows(device.user_id, permission)) {
        throw Object.assign(new Error('Access unavailable'), { statusCode: 403, publicCode: 'PERMISSION_DENIED' });
      }
    }
  }

  async _completeRequest(input, permissions) {
    return this.requestRepository.complete({
      ...input, response: { ...input.response, _recoveryPermissions: [...new Set(['assistant', ...permissions])] },
    });
  }

  async handle({ device, clientMessageId, kind = 'text', resolveContent }) {
    const can = async (permission) => !this.accessService || await this.accessService.allows(device.user_id, permission);
    const requireAssistant = async () => {
      if (!await can('assistant')) throw Object.assign(new Error('Access unavailable'), { statusCode: 403, publicCode: 'PERMISSION_DENIED' });
    };
    await requireAssistant();
    // History may contain earlier source-derived answers even when this turn's search is empty.
    // Cache recovery therefore retains all source grants available when this turn began.
    const recoveryContextPermissions = [];
    if (this.accessService) {
      for (const permission of ['memory', 'documents', 'devices', 'vpn', 'life']) {
        if (await can(permission)) recoveryContextPermissions.push(permission);
      }
    }
    const claim = await this.requestRepository.claim({
      userId: device.user_id,
      deviceId: device.id,
      clientMessageId,
      kind,
    });
    if (!claim.created) {
      if (claim.request?.status === 'completed') {
        await this._requireRecoveryPermissions(device, claim.request.response || {});
        const { _recoveryPermissions, ...response } = claim.request.response || {};
        return { ...response, duplicate: true };
      }
      if (claim.request?.status === 'processing') throw new DesktopRequestPendingError();
      throw new DesktopRequestFailedError();
    }

    try {
      const resolved = await resolveContent();
      const content = normalizeContent(resolved && resolved.content);
      const conversation = await this.conversationRepository.getOrCreate({
        userId: device.user_id,
        channel: 'desktop',
        externalChatId: device.id,
      });
      const userMessage = await this.conversationRepository.appendMessage({
        userId: device.user_id,
        conversationId: conversation.id,
        deviceId: device.id,
        role: 'user',
        content,
        contentType: kind === 'voice' ? 'voice_transcript' : 'text',
        externalMessageId: clientMessageId,
      });
      await recordMessageEvent(await can('life') ? this.lifeEventGateway : null, {
        userId: device.user_id,
        conversationId: conversation.id,
        sourceChannel: 'desktop',
        sourceDeviceId: device.id,
        sourceRef: `desktop:${device.id}:${clientMessageId}`,
        deduplicationKey: `desktop-message:${device.user_id}:${device.id}:${clientMessageId}`,
        externalMessageId: clientMessageId,
        kind,
        text: content,
      });
      const vpnResult = this.vpnService && await can('vpn') ? await this.vpnService.handle({
        text: content, userId: device.user_id, conversationId: conversation.id,
        originChannel: 'desktop', originDeviceId: device.id,
      }) : null;
      if (vpnResult) {
        const assistantMessage = await this.conversationRepository.appendMessage({
          userId: device.user_id,
          conversationId: conversation.id,
          role: 'assistant',
          content: vpnResult.answer,
          externalMessageId: `${clientMessageId}:assistant`,
        });
        const publicResponse = {
          status: 'answered', conversationId: conversation.id, messageId: userMessage.id,
          answerMessageId: assistantMessage.id, answer: vpnResult.answer,
          ...(vpnResult.artifact ? { vpnArtifact: vpnResult.artifact } : {}),
        };
        const persistedResponse = { ...publicResponse };
        delete persistedResponse.vpnArtifact;
        if (publicResponse.vpnArtifact) persistedResponse.artifactUnavailable = true;
        await this._completeRequest({
          userId: device.user_id, deviceId: device.id, clientMessageId,
          conversationId: conversation.id, response: persistedResponse,
        }, [...recoveryContextPermissions, 'vpn']);
        return publicResponse;
      }

      const remoteAnswer = await can('devices') ? await remoteCommandReply({
        text: content,
        userId: device.user_id,
        conversationId: conversation.id,
        originChannel: 'desktop',
        originDeviceId: device.id,
        defaultDeviceId: device.id,
        commandService: this.commandService,
        orchestrator: this.orchestrator,
      }) : null;
      if (remoteAnswer) {
        const answerText = typeof remoteAnswer === 'string' ? remoteAnswer : remoteAnswer.answer;
        const assistantMessage = await this.conversationRepository.appendMessage({
          userId: device.user_id,
          conversationId: conversation.id,
          role: 'assistant',
          content: answerText,
          externalMessageId: `${clientMessageId}:assistant`,
        });
        const response = {
          status: 'answered',
          conversationId: conversation.id,
          messageId: userMessage.id,
          answerMessageId: assistantMessage.id,
          answer: answerText,
          ...(remoteAnswer.buttons ? { buttons: remoteAnswer.buttons } : {}),
          ...(kind === 'voice' ? { transcript: content, transcription: resolved.transcription || {} } : {}),
        };
        await this._completeRequest({
          userId: device.user_id,
          deviceId: device.id,
          clientMessageId,
          conversationId: conversation.id,
          response,
        }, [...recoveryContextPermissions, 'devices']);
        return response;
      }
      const history = await this.conversationRepository.recentMessages({
        userId: device.user_id,
        conversationId: conversation.id,
        limit: 30,
      });
      const orchestration = this.orchestrator && await can('devices') ? await this.orchestrator.handle({
        userId: device.user_id,
        conversationId: conversation.id,
        originChannel: 'desktop',
        originDeviceId: device.id,
        text: content,
        history,
      }) : { handled: false };
      if (orchestration.handled) {
        const safeOrchestratedAnswer = String(orchestration.answer || '').trim().slice(0, MAX_TEXT_LENGTH);
        if (!safeOrchestratedAnswer) throw new Error('orchestrator returned an empty answer');
        const assistantMessage = await this.conversationRepository.appendMessage({
          userId: device.user_id,
          conversationId: conversation.id,
          role: 'assistant',
          content: safeOrchestratedAnswer,
          externalMessageId: `${clientMessageId}:assistant`,
        });
        const response = {
          status: 'answered',
          conversationId: conversation.id,
          messageId: userMessage.id,
          answerMessageId: assistantMessage.id,
          answer: safeOrchestratedAnswer,
          ...(orchestration.buttons ? { buttons: orchestration.buttons } : {}),
          ...(orchestration.confirmation ? { confirmation: orchestration.confirmation } : {}),
          ...(kind === 'voice' ? { transcript: content, transcription: resolved.transcription || {} } : {}),
        };
        await this._completeRequest({
          userId: device.user_id,
          deviceId: device.id,
          clientMessageId,
          conversationId: conversation.id,
          response,
        }, [...recoveryContextPermissions, 'devices']);
        return response;
      }
      const memoryResult = this.memoryService && await can('memory')
        ? await this.memoryService.handleUserText({ userId: device.user_id, text: content, sourceConversationId: conversation.id })
        : { handled: false };
      const memories = this.memoryService && await can('memory') ? await this.memoryService.memoriesForPrompt({ userId: device.user_id }) : [];
      const devices = this.deviceService && await can('devices') ? await this.deviceService.list({ userId: device.user_id }) : [];
      const documentSources = this.knowledgeService && await can('documents')
        ? await this.knowledgeService.searchForPrompt({ userId: device.user_id, query: content })
        : [];
      const visualMemories = this.visualMemoryService && await can('memory') && await can('devices')
        ? await this.visualMemoryService.searchForPrompt({ userId: device.user_id, query: content }) : [];
      const deviceAnswer = isDeviceAttachmentQuestion(content) ? attachmentReply(devices) : null;
      const answer = memoryResult.answer || deviceAnswer || await this.assistant.answer({
        userId: device.user_id,
        conversationId: conversation.id,
        deviceId: device.id,
        currentRequest: content,
        history,
        memories,
        documents: documentSources,
        visualMemories,
        devices,
        runtimeContext: {
          channel: 'desktop',
          toolsAvailable: [],
          verifiedToolResults: [],
        },
      });
      const safeAnswer = renderDocumentCitations(String(answer || '').trim(), documentSources).slice(0, MAX_TEXT_LENGTH);
      if (!safeAnswer) throw new Error('provider returned an empty answer');
      await requireAssistant();
      const sourcePermissions = [ ...(memories.length ? ['memory'] : []), ...(devices.length ? ['devices'] : []),
        ...(documentSources.length ? ['documents'] : []), ...(visualMemories.length ? ['memory', 'devices'] : []) ];
      for (const permission of sourcePermissions) if (!await can(permission)) {
        throw Object.assign(new Error('Access unavailable'), { statusCode: 403, publicCode: 'PERMISSION_DENIED' });
      }
      const assistantMessage = await this.conversationRepository.appendMessage({
        userId: device.user_id,
        conversationId: conversation.id,
        role: 'assistant',
        content: safeAnswer,
        externalMessageId: `${clientMessageId}:assistant`,
      });
      const response = {
        status: 'answered',
        conversationId: conversation.id,
        messageId: userMessage.id,
        answerMessageId: assistantMessage.id,
        answer: safeAnswer,
        ...(kind === 'voice' ? { transcript: content, transcription: resolved.transcription || {} } : {}),
      };
      await this._completeRequest({
        userId: device.user_id,
        deviceId: device.id,
        clientMessageId,
        conversationId: conversation.id,
        response,
      }, [...recoveryContextPermissions, ...sourcePermissions, ...(memoryResult.handled ? ['memory'] : [])]);
      return response;
    } catch (error) {
      await this.requestRepository.fail({
        userId: device.user_id,
        deviceId: device.id,
        clientMessageId,
        errorCode: error.publicCode || 'DESKTOP_REQUEST_FAILED',
      });
      throw error;
    }
  }
}

module.exports = {
  DesktopMessageService,
  DesktopRequestFailedError,
  DesktopRequestPendingError,
  MAX_TEXT_LENGTH,
  normalizeContent,
};
