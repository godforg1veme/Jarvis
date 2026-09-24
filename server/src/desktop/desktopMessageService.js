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
  }

  async handle({ device, clientMessageId, kind = 'text', resolveContent }) {
    const claim = await this.requestRepository.claim({
      userId: device.user_id,
      deviceId: device.id,
      clientMessageId,
      kind,
    });
    if (!claim.created) {
      if (claim.request?.status === 'completed') return { ...claim.request.response, duplicate: true };
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
      await recordMessageEvent(this.lifeEventGateway, {
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
      const vpnResult = this.vpnService ? await this.vpnService.handle({
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
        await this.requestRepository.complete({
          userId: device.user_id, deviceId: device.id, clientMessageId,
          conversationId: conversation.id, response: persistedResponse,
        });
        return publicResponse;
      }

      const remoteAnswer = await remoteCommandReply({
        text: content,
        userId: device.user_id,
        conversationId: conversation.id,
        originChannel: 'desktop',
        originDeviceId: device.id,
        defaultDeviceId: device.id,
        commandService: this.commandService,
        orchestrator: this.orchestrator,
      });
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
        await this.requestRepository.complete({
          userId: device.user_id,
          deviceId: device.id,
          clientMessageId,
          conversationId: conversation.id,
          response,
        });
        return response;
      }
      const history = await this.conversationRepository.recentMessages({
        userId: device.user_id,
        conversationId: conversation.id,
        limit: 30,
      });
      const orchestration = this.orchestrator ? await this.orchestrator.handle({
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
        await this.requestRepository.complete({
          userId: device.user_id,
          deviceId: device.id,
          clientMessageId,
          conversationId: conversation.id,
          response,
        });
        return response;
      }
      const memoryResult = this.memoryService
        ? await this.memoryService.handleUserText({ userId: device.user_id, text: content, sourceConversationId: conversation.id })
        : { handled: false };
      const memories = this.memoryService ? await this.memoryService.memoriesForPrompt({ userId: device.user_id }) : [];
      const devices = this.deviceService ? await this.deviceService.list({ userId: device.user_id }) : [];
      const documentSources = this.knowledgeService
        ? await this.knowledgeService.searchForPrompt({ userId: device.user_id, query: content })
        : [];
      const visualMemories = this.visualMemoryService
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
      await this.requestRepository.complete({
        userId: device.user_id,
        deviceId: device.id,
        clientMessageId,
        conversationId: conversation.id,
        response,
      });
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
