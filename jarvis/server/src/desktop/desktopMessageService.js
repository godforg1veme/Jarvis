const MAX_TEXT_LENGTH = 10000;
const { attachmentReply, isDeviceAttachmentQuestion } = require('../devices/deviceReplies');

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
        role: 'user',
        content,
        contentType: kind === 'voice' ? 'voice_transcript' : 'text',
        externalMessageId: clientMessageId,
      });
      const memoryResult = this.memoryService
        ? await this.memoryService.handleUserText({ userId: device.user_id, text: content, sourceConversationId: conversation.id })
        : { handled: false };
      const history = await this.conversationRepository.recentMessages({
        userId: device.user_id,
        conversationId: conversation.id,
        limit: 30,
      });
      const memories = this.memoryService ? await this.memoryService.memoriesForPrompt({ userId: device.user_id }) : [];
      const devices = this.deviceService ? await this.deviceService.list({ userId: device.user_id }) : [];
      const deviceAnswer = isDeviceAttachmentQuestion(content) ? attachmentReply(devices) : null;
      const answer = memoryResult.answer || deviceAnswer || await this.assistant.answer({
        userId: device.user_id,
        conversationId: conversation.id,
        currentRequest: content,
        history,
        memories,
        devices,
        runtimeContext: {
          channel: 'desktop',
          toolsAvailable: [],
          verifiedToolResults: [],
        },
      });
      const safeAnswer = String(answer || '').trim().slice(0, MAX_TEXT_LENGTH);
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
