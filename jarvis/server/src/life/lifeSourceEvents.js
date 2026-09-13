const SECRET_PATTERNS = [
  /\b(?:bearer|authorization|api[_ -]?key|password|пароль|token|токен)\s*[:=]?\s*\S+/giu,
  /\b(?:sk|pk|ghp|github_pat|xox[baprs])-[_a-z0-9-]{12,}\b/giu,
  /\b[A-Za-z0-9_-]{32,}\b/g,
];

function safeSummary(value, fallback = 'Событие без текстового описания') {
  let summary = String(value || '').replace(/\s+/g, ' ').trim();
  for (const pattern of SECRET_PATTERNS) summary = summary.replace(pattern, '[скрыто]');
  summary = summary.slice(0, 500).trim();
  return summary || fallback;
}

async function recordMessageEvent(gateway, input) {
  if (!gateway) return null;
  const voice = input.kind === 'voice';
  return gateway.record({
    userId: input.userId,
    eventType: voice ? 'voice.transcribed' : 'message.received',
    occurredAt: input.occurredAt || new Date(),
    sourceChannel: input.sourceChannel,
    sourceRef: String(input.sourceRef).slice(0, 256),
    sourceDeviceId: input.sourceDeviceId || null,
    deduplicationKey: String(input.deduplicationKey).slice(0, 512),
    summary: safeSummary(input.text, voice ? 'Получено голосовое сообщение' : 'Получено сообщение'),
    structuredData: {
      conversationId: input.conversationId,
      messageKind: voice ? 'voice' : 'text',
      ...(input.externalMessageId ? { externalMessageId: String(input.externalMessageId).slice(0, 200) } : {}),
    },
    privacyClass: 'personal',
    trustLevel: 'user',
  });
}

async function recordDocumentEvent(gateway, input) {
  if (!gateway) return null;
  return gateway.record({
    userId: input.userId,
    eventType: input.failed ? 'document.ingest_failed' : 'document.ingested',
    occurredAt: new Date(),
    sourceChannel: 'knowledge',
    sourceRef: `document:${input.documentId}`,
    deduplicationKey: `document:${input.documentId}:${input.failed ? 'failed' : 'ready'}`,
    summary: input.failed
      ? `Не удалось проиндексировать документ «${safeSummary(input.name, 'Без названия')}»`
      : `Проиндексирован документ «${safeSummary(input.name, 'Без названия')}»`,
    structuredData: {
      documentId: input.documentId,
      category: String(input.category || 'other').slice(0, 80),
      state: input.failed ? 'failed' : 'ready',
    },
    privacyClass: 'personal',
    trustLevel: 'trusted',
  });
}

async function recordSimpleEvent(gateway, input) {
  if (!gateway) return null;
  return gateway.record({
    userId: input.userId,
    eventType: input.eventType,
    occurredAt: input.occurredAt || new Date(),
    sourceChannel: input.sourceChannel,
    sourceRef: String(input.sourceRef).slice(0, 256),
    sourceDeviceId: input.sourceDeviceId || null,
    deduplicationKey: String(input.deduplicationKey).slice(0, 512),
    summary: safeSummary(input.summary),
    structuredData: input.structuredData || {},
    confidence: input.confidence === undefined ? 1 : input.confidence,
    privacyClass: input.privacyClass || 'personal',
    trustLevel: input.trustLevel || 'trusted',
    correlationId: input.correlationId || null,
  });
}

module.exports = { recordDocumentEvent, recordMessageEvent, recordSimpleEvent, safeSummary };
