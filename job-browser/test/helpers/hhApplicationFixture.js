// HH-shaped UI fixture; every request is fulfilled locally or aborted.
const { parseFields } = require('../../src/submissionProtocol');
async function installApplicationFixture(context, { resumeId, onPost, nativeTestId = null,
  nativeMultiple = false, inlineNative = false, nativeQuestionLabel = 'Выберите вариант' } = {}) {
  const state = { posts: 0, chatRequests: 0, loseAcknowledgement: false, changeCountryVisibility: false,
    wrongRecoveredLetter: true, applied: new Set(), letters: new Map(), lastFields: null };
  const html = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    await context.route('**/*', async (route) => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin === 'https://chatik.hh.ru' && req.method() === 'GET') {
        state.chatRequests++;
        if (url.pathname === '/chatik/api/chat_data') {
          const chatId = url.searchParams.get('chatId'), id = chatId === '555' ? '123' : '124';
          const topic = id === '123' ? 444 : 445;
          const resources = { NEGOTIATION_TOPIC: [String(topic)], VACANCY: [id], RESUME: ['222'], RESPONSE_LETTER: ['777'] };
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
            chat: { id: Number(chatId), currentParticipantId: 'applicant-1', resources,
              messages: { items: [{ chatId: Number(chatId), participantId: 'applicant-1', resources,
                workflowTransition: { topicId: topic },
                text: state.wrongRecoveredLetter ? 'Другой текст' : state.letters.get(id) || '' }] } },
            resources: { negotiation_topics: { [topic]: { topicId: topic, vacancyId: Number(id), resumeId: 222 } },
              resumes: { 222: { id: 222, hash: resumeId } }, vacancies: { [id]: { vacancyId: Number(id) } },
              participants: { 'applicant-1': { key: 'applicant-1', isCurrentUser: true } } },
          }) });
        }
        const id = url.pathname === '/chat/555' ? '123' : '124';
        const letter = state.wrongRecoveredLetter ? 'Другой текст' : state.letters.get(id) || '';
        return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body:
          `<a data-qa="chatik-header-vacancy-link" href="https://hh.ru/vacancy/${id}">Вакансия</a>
          <div class="message_my--fixture"><div data-qa="chat-bubble-title">Отклик на вакансию</div>
          <div data-qa="chat-bubble-text" style="white-space:pre-wrap">${html(letter)}</div></div>` });
      }
      if (url.origin !== 'https://hh.ru') return route.abort();
      if (req.method() === 'POST' && url.pathname === '/applicant/vacancy_response/popup') {
        await onPost?.();
        state.posts++;
        const fields = parseFields({ contentType: req.headers()['content-type'], body: req.postDataBuffer(),
          multipleNames: nativeMultiple ? new Set(['task_7']) : new Set() });
        state.lastFields = fields;
        state.letters.set(fields.get('vacancy_id'), fields.get('letter').replace(/\r\n/g, '\n'));
        if (state.loseAcknowledgement) { state.applied.add('124'); return route.abort(); }
        const vacancyId = fields.get('vacancy_id'), topicId = vacancyId === nativeTestId ? 446 : 444;
        const chatId = vacancyId === nativeTestId ? 557 : 555;
        state.applied.add(vacancyId);
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ topic_id: topicId, chat_id: chatId,
          responseStatus: { resumes: { 222: { id: 222, hash: resumeId } }, usedResumeIds: [222],
            negotiations: { topicList: [{ id: topicId, vacancyId: Number(vacancyId), resumeId: 222, chatId }] } } }) });
      }
      if (req.method() !== 'GET') return route.abort();
      let body = '';
      if (url.pathname === '/applicant/resumes') body = `<h1>Мои резюме</h1><div data-qa="resume"><a href="/resume/${resumeId}" data-qa="resume-title">Основное резюме</a></div>`;
      else if (url.pathname === `/resume/${resumeId}`) body = `<button data-qa="resume-visibility-card" onclick="document.querySelector('label').hidden=false">Видимость</button>
        <label hidden data-qa="resume-visibility-card-access-type-clients"><input type="radio" checked></label>`;
      else if (url.pathname.startsWith('/vacancy/')) {
        const id = url.pathname.split('/').pop();
        const topicId = id === '123' ? 444 : 445, chatId = id === '123' ? 555 : 556;
        const sourceState = { applicantVacancyResponseStatuses: { [id]: { resumes: { 222: { id: 222, hash: resumeId } }, usedResumeIds: [222],
          negotiations: { topicList: [{ id: topicId, chatId, resumeId: 222, vacancyId: Number(id), hasResponseLetter: true,
            resources: [{ type: 'RESPONSE_LETTER', id: 1 }] }] } } } };
        body = `<script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', title: 'Junior AI Engineer', datePosted: '2026-10-15T10:00:00+03:00' })}</script>
          <div data-qa="vacancy-description">Автоматизация AI</div><div data-qa="vacancy-company"><a href="/employer/900">Fixture</a></div>
          ${id === nativeTestId && !inlineNative ? '<a data-qa="vacancy-response-link-test" href="/applicant/vacancy_response/test?vacancyId='+id+'">Пройти тест</a>' : ''}
          ${state.applied.has(id) ? `<template id="HH-Lux-InitialState">${JSON.stringify(sourceState)}</template>
            <button data-qa="vacancy-response-link-view-topic" onclick="const frame=document.createElement('iframe');frame.src='https://chatik.hh.ru/chat/${chatId}';this.after(frame)">Смотреть отклик</button>` : ''}`;
      } else if (url.pathname === (inlineNative ? '/applicant/vacancy_response' : '/applicant/vacancy_response/test')
        && url.searchParams.get('vacancyId') === nativeTestId) {
        body = `<div data-qa="resume-title">Основное резюме</div>
          <form method="post" action="/applicant/vacancy_response${inlineNative ? '' : '/test'}?vacancyId=${nativeTestId}">
          <div data-qa="test-description">Ответьте на вопросы работодателя.</div>
          <h2 data-qa="employer-asking-for-test">Вопросы</h2>
          <input type="hidden" name="uidPk" value="42"><input type="hidden" name="guid" value="abc-123">
          <input type="hidden" name="startTime" value="2026-11-02T12:00:00Z"><input type="hidden" name="testRequired" value="true">
          <div data-qa="task-body"><div data-qa="task-question">${html(nativeQuestionLabel)}</div>
          <label><input type="${nativeMultiple ? 'checkbox' : 'radio'}" name="task_7" value="11" ${nativeMultiple ? '' : 'required'}>Первый</label>
          <label><input type="${nativeMultiple ? 'checkbox' : 'radio'}" name="task_7" value="12" ${nativeMultiple ? '' : 'required'}>Второй</label>
          ${nativeMultiple ? '<label><input type="checkbox" name="task_7" value="13">Третий</label>' : ''}</div>
          <div data-qa="task-body"><div data-qa="task-question">Опишите подход</div>
          <textarea name="task_8_text" maxlength="1000" required></textarea></div>
          <button type="button" data-qa="vacancy-response-letter-toggle">Добавить письмо</button>
          <button type="submit" data-qa="vacancy-response-submit-popup">Откликнуться</button></form>
          <script>document.querySelector('[data-qa="vacancy-response-letter-toggle"]').onclick=()=>{
            const field=document.createElement('textarea');field.dataset.qa='vacancy-response-popup-form-letter-input';document.querySelector('form').append(field);
          };
          document.querySelector('form').onsubmit=async(event)=>{event.preventDefault();const data=new FormData(event.target);
            const values={vacancy_id:'${nativeTestId}',resume_hash:'${resumeId}',letter:document.querySelector('[data-qa="vacancy-response-popup-form-letter-input"]').value,
              lux:true,ignore_postponed:true,withoutTest:'no',incomplete:false,mark_applicant_visible_in_vacancy_country:false,country_ids:'[]'};
            for(const [key,value] of Object.entries(values)) data.append(key,String(value));
            await fetch('/applicant/vacancy_response/popup',{method:'POST',body:data}).catch(()=>{});
          };</script>`;
      } else if (url.pathname === '/applicant/vacancy_response') {
        const id = url.searchParams.get('vacancyId');
        body = `<div data-qa="resume-title">Основное резюме</div>
          <form method="post" action="/applicant/vacancy_response?vacancyId=${id}"><input type="hidden" name="_xsrf" value="fixture">
          <button type="button" data-qa="vacancy-response-letter-toggle">Добавить письмо</button>
          <button type="submit" data-qa="vacancy-response-submit-popup">Откликнуться</button></form>
          <script>document.querySelector('[data-qa="vacancy-response-letter-toggle"]').onclick=()=>{
            const field=document.createElement('textarea');field.dataset.qa='vacancy-response-popup-form-letter-input';document.querySelector('form').prepend(field);
          };
          document.querySelector('form').onsubmit=async(event)=>{event.preventDefault();const data=new FormData();
            const values={vacancy_id:'${id}',resume_hash:'${resumeId}',letter:document.querySelector('textarea').value,lux:true,
              ignore_postponed:true,withoutTest:'no',incomplete:false,mark_applicant_visible_in_vacancy_country:${state.changeCountryVisibility},country_ids:'[]',hhtmFromLabel:'',hhtmSourceLabel:''};
            for(const [key,value] of Object.entries(values)) data.append(key,String(value));
            await fetch('/applicant/vacancy_response/popup',{method:'POST',body:data}).catch(()=>{});
          };</script>`;
      } else return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: `<!DOCTYPE html><html><body>${body}</body></html>` });
    });
  return state;
}
module.exports = { installApplicationFixture };
