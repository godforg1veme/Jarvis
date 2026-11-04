// Self-contained: Playwright runs this function in the HH chat frame. Only a
// boolean leaves the frame; unrelated messages and profile resources stay there.
async function verifyChatData({ reference, input, data: supplied }) {
  const id = value => (typeof value === 'number' && Number.isSafeInteger(value) && value > 0)
    || (typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value));
  const equal = (a, b) => id(a) && id(b) && String(a) === String(b);
  const own = (map, key) => map && typeof map === 'object' && !Array.isArray(map)
    && Object.keys(map).length <= 1000 && Object.hasOwn(map, key) ? map[key] : null;
  const resourceKey = value => id(value) || (typeof value === 'string' && value.length > 0 && value.length <= 128);
  const single = (map, kind, expected) => Array.isArray(map?.[kind]) && map[kind].length === 1
    && resourceKey(map[kind][0]) && resourceKey(expected) && String(map[kind][0]) === String(expected);
  if (!reference || !input || !id(reference.chatId) || !id(reference.topicId)
    || !id(input.externalId) || typeof input.resumeId !== 'string'
    || typeof input.letter !== 'string' || !input.letter.trim() || input.letter.length > 10000) return false;
  try {
    let data = supplied;
    if (data === undefined) {
      if (location.origin !== 'https://chatik.hh.ru' || location.pathname !== `/chat/${reference.chatId}`) return false;
      const response = await fetch(`/chatik/api/chat_data?chatId=${reference.chatId}`, {
        method: 'GET', credentials: 'same-origin', redirect: 'error', signal: AbortSignal.timeout(15000),
      });
      if (!response.ok || !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') || '')
        || Number(response.headers.get('content-length') || 0) > 1048576 || !response.body) return false;
      const reader = response.body.getReader(), chunks = []; let size = 0;
      try {
        while (true) {
          const next = await reader.read(); if (next.done) break;
          size += next.value.byteLength;
          if (size > 1048576) { await reader.cancel(); return false; }
          chunks.push(next.value);
        }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    }
    const chat = data?.chat, resources = data?.resources;
    const topic = own(resources?.negotiation_topics, reference.topicId);
    if (!equal(chat?.id, reference.chatId) || !equal(topic?.topicId, reference.topicId)
      || !equal(topic?.vacancyId, input.externalId) || !id(topic?.resumeId)) return false;
    const resume = own(resources?.resumes, String(topic.resumeId));
    const vacancy = own(resources?.vacancies, input.externalId);
    if (!equal(resume?.id, topic.resumeId) || resume.hash !== input.resumeId
      || !equal(vacancy?.vacancyId, input.externalId)) return false;
    if (typeof chat.currentParticipantId !== 'string' || chat.currentParticipantId.length > 128) return false;
    const current = own(resources?.participants, chat.currentParticipantId);
    // `key` is a UI/resource key, not the participant identity. The map key and
    // currentParticipantId bind the author; HH's isCurrentUser binds ownership.
    if (current?.isCurrentUser !== true) return false;
    const bound = value => single(value, 'NEGOTIATION_TOPIC', reference.topicId)
      && single(value, 'VACANCY', input.externalId)
      && (single(value, 'RESUME', topic.resumeId) || single(value, 'RESUME', input.resumeId));
    if (!bound(chat.resources) || !Array.isArray(chat.resources.RESPONSE_LETTER)
      || chat.resources.RESPONSE_LETTER.length !== 1 || !resourceKey(chat.resources.RESPONSE_LETTER[0])) return false;
    const messages = chat.messages?.items;
    if (!Array.isArray(messages) || messages.length > 200) return false;
    const applications = messages.filter(message => equal(message?.chatId, reference.chatId)
      && message.participantId === chat.currentParticipantId && message.hidden !== true
      && bound(message.resources)
      && single(message.resources, 'RESPONSE_LETTER', chat.resources.RESPONSE_LETTER[0])
      && equal(message.workflowTransition?.topicId, reference.topicId));
    return applications.length === 1 && typeof applications[0].text === 'string'
      && applications[0].text.replace(/\r\n/g, '\n') === input.letter;
  } catch { return false; }
}

module.exports = { verifyChatData };
