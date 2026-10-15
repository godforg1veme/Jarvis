const { nativeId } = require('./submissionProtocol');

function applicationReference(raw, { externalId, resumeId }) {
  if (!raw || !nativeId(externalId) || raw.selected?.hash !== resumeId || !nativeId(raw.selected?.id)
    || !Array.isArray(raw.usedIds) || raw.usedIds.length > 100 || !raw.usedIds.some((id) => nativeId(id) === nativeId(raw.selected.id))
    || !Array.isArray(raw.topics) || raw.topics.length > 100) return null;
  const topics = raw.topics.filter((topic) => nativeId(topic?.resumeId) === nativeId(raw.selected.id)
    && nativeId(topic?.vacancyId) === externalId && nativeId(topic?.id) && nativeId(topic?.chatId)
    && topic.hasResponseLetter === true && topic.letterResource === true);
  return topics.length === 1 ? { topicId: nativeId(topics[0].id), chatId: nativeId(topics[0].chatId) } : null;
}

async function readApplicationReference(page, input) {
  const current = new URL(page.url());
  if (current.origin !== 'https://hh.ru' || current.pathname !== `/vacancy/${input.externalId}`) return null;
  const raw = await page.evaluate(({ externalId, resumeId }) => {
    const node = document.getElementById('HH-Lux-InitialState');
    const text = node?.content?.textContent || node?.textContent || '';
    if (!text || text.length > 5000000) return null;
    let state; try { state = JSON.parse(text); } catch { return null; }
    const status = state?.applicantVacancyResponseStatuses?.[externalId];
    if (!status || !status.resumes || typeof status.resumes !== 'object' || Array.isArray(status.resumes)
      || Object.keys(status.resumes).length > 100 || !Array.isArray(status.usedResumeIds) || status.usedResumeIds.length > 100
      || !Array.isArray(status.negotiations?.topicList) || status.negotiations.topicList.length > 100) return null;
    const selected = Object.values(status.resumes).filter((resume) => resume?.hash === resumeId);
    if (selected.length !== 1) return null;
    return { selected: { id: selected[0].id, hash: selected[0].hash }, usedIds: status.usedResumeIds,
      topics: status.negotiations.topicList.map((topic) => ({ id: topic?.id, chatId: topic?.chatId, resumeId: topic?.resumeId,
        vacancyId: topic?.vacancyId, hasResponseLetter: topic?.hasResponseLetter,
        letterResource: Array.isArray(topic?.resources) && topic.resources.some((resource) => resource?.type === 'RESPONSE_LETTER') })) };
  }, { externalId: input.externalId, resumeId: input.resumeId });
  return applicationReference(raw, input);
}

async function verifyChatLetter(frame, { externalId, letter }) {
  if (typeof letter !== 'string' || !letter.trim() || letter.length > 10000) return false;
  return frame.evaluate(({ externalId, letter }) => {
    const headers = [...document.querySelectorAll('[data-qa="chatik-header-vacancy-link"][href], [data-qa="chatik-header-vacancy-link"] a[href]')];
    const matchingHeader = headers.some((node) => { try { const url = new URL(node.href);
      return url.origin === 'https://hh.ru' && !url.username && !url.password && url.pathname === `/vacancy/${externalId}`;
    } catch { return false; } });
    if (!matchingHeader || headers.length !== 1) return false;
    const own = [...document.querySelectorAll('[class*="message_my--"]')]
      .filter((node) => [...node.classList].some((name) => name.startsWith('message_my--')));
    if (own.length > 100) return false;
    const applications = own.filter((node) => [...node.querySelectorAll('[data-qa="chat-bubble-title"]')]
      .some((title) => /^Отклик на вакансию$/iu.test(title.innerText.replace(/\s+/gu, ' ').trim())));
    if (applications.length !== 1) return false;
    const texts = applications[0].querySelectorAll('[data-qa="chat-bubble-text"]');
    // Compare in the browser: unrelated private messages never leave the frame.
    return texts.length === 1 && texts[0].innerText.replace(/\r\n/g, '\n') === letter;
  }, { externalId, letter });
}

module.exports = { applicationReference, readApplicationReference, verifyChatLetter };
