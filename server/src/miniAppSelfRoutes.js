const { formatMoscowDateTime } = require('../../shared/time');
const { z } = require('zod');
const { createHash } = require('node:crypto');
const { PERMISSIONS } = require('./access/permissionCatalog');
const { renderDocumentCitations, publicDocumentStatus } = require('./knowledge/knowledgeService');
const { FixedWindowRateLimiter } = require('./http/rateLimiter');
const { responseForReceipt, readReceipt, failReceipt, completeReceipt } = require('./miniApp/assistantReceipts');
const { sectionNavigation } = require('./miniApp/sectionNavigation');

const JOB_LOGIN_COOKIE = '__Secure-jarvis-job-login';
const JOB_LOGIN_COOKIE_PATH = '/mini/api/jobs/login';
const JOB_LOGIN_TTL_SECONDS = 600;
const jobLoginCookie = (token) => `${JOB_LOGIN_COOKIE}=${token}; Path=${JOB_LOGIN_COOKIE_PATH}; HttpOnly; Secure; SameSite=Strict; Max-Age=${token ? JOB_LOGIN_TTL_SECONDS : 0}`;
function readJobLoginCookie(request) {
  const matches = String(request.headers.cookie || '').split(';').map((item) => item.trim())
    .filter((item) => item.startsWith(`${JOB_LOGIN_COOKIE}=`));
  if (matches.length !== 1) return null;
  const token = matches[0].slice(JOB_LOGIN_COOKIE.length + 1);
  return /^[a-f\d]{64}$/i.test(token) ? token : null;
}

const messageSchema = z.object({ requestId: z.uuid(), text: z.string().trim().min(1).max(10000) }).strict();
const fail = (code) => { throw Object.assign(new Error(code), { code }); };

function registerMiniAppSelfRoutes({ route, authorize, requireOrigin }, services) {
  const { accessService, memoryService, knowledgeService, deviceService, missionControlService,
    assistant, conversationRepository, pool, getJobConnectionSessionService, getJobLoginLinkDelivery, getJobResumeService } = services;
  const chatLimiter = new FixedWindowRateLimiter();
  const requirePermission = async (request, permission, mutation = false) => {
    const session = await authorize(request, { mutation });
    if (!session.actor.permissions.includes(permission)) fail('forbidden');
    return session.actor;
  };

  const jobSessions = () => {
    const service = getJobConnectionSessionService?.();
    if (!service) fail('JOB_LOGIN_UNAVAILABLE');
    return service;
  };
  const jobResumes = () => { const service=getJobResumeService?.(); if(!service)fail('JOB_RESUME_UNAVAILABLE');return service; };
  route('GET','/jobs/resumes',async request=>{
    const actor=await requirePermission(request,'jobs');const result=await jobResumes().get(actor.userId);
    await requirePermission(request,'jobs');return {ok:true,...result};
  });
  route('POST','/jobs/resumes/refresh',async request=>{
    const actor=await requirePermission(request,'jobs',true);
    const parsed=z.strictObject({requestId:z.uuid()}).safeParse(request.body);if(!parsed.success)fail('invalid_request');
    const result=await jobResumes().refresh(actor.userId,parsed.data.requestId);
    await requirePermission(request,'jobs');return {ok:true,...result};
  });
  route('POST','/jobs/resumes/settings',async request=>{
    const actor=await requirePermission(request,'jobs',true);
    const {settingsInput}=require('./jobs/jobResumeRepository');const parsed=settingsInput.safeParse(request.body);if(!parsed.success)fail('invalid_request');
    const result=await jobResumes().settings(actor.userId,parsed.data);
    await requirePermission(request,'jobs');return {ok:true,...result};
  });
  route('GET','/jobs/resumes/operations/:requestId',async request=>{
    const actor=await requirePermission(request,'jobs');if(!z.uuid().safeParse(request.params.requestId).success)fail('invalid_request');
    const result=await jobResumes().operation(actor.userId,request.params.requestId);
    await requirePermission(request,'jobs');return {ok:true,...result};
  });
  const sessionIdFrom = (request) => {
    const parsed = z.uuid().safeParse(request.params.sessionId);
    if (!parsed.success) fail('invalid_request');
    return parsed.data;
  };
  const guestActor = async (request, reply) => {
    const guestToken = readJobLoginCookie(request);
    if (!guestToken) fail('JOB_LOGIN_SESSION_INVALID');
    try { return await jobSessions().authorizeGuest({ guestToken }); }
    catch (error) { reply?.header('Set-Cookie', jobLoginCookie('')); throw error; }
  };
  const withGuestSession = async (reply, run) => {
    try { return await run(); }
    catch (error) {
      if (['JOB_ACCESS_REVOKED','JOB_LOGIN_SESSION_INVALID','JOB_LOGIN_SESSION_EXPIRED'].includes(error?.code))
        reply.header('Set-Cookie', jobLoginCookie(''));
      throw error;
    }
  };
  const loginEvent = z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('pointer'), action: z.enum(['move','down','up','click']), button: z.enum(['left','middle','right']), x: z.number().finite().min(0).max(1024), y: z.number().finite().min(0).max(768) }),
    z.strictObject({ type: z.literal('wheel'), x: z.number().finite().min(0).max(1024), y: z.number().finite().min(0).max(768), deltaX: z.number().finite().min(-1000).max(1000), deltaY: z.number().finite().min(-1000).max(1000) }),
    z.strictObject({ type: z.literal('key'), action: z.enum(['press','down','up']), key: z.enum(['Enter','Tab','Escape','Backspace','Delete','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','Shift','Control','Alt','Meta','0','1','2','3','4','5','6','7','8','9']) }),
    z.strictObject({ type: z.literal('text'), value: z.string().min(1).max(64).refine((value) => !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(value)) }),
  ]);

  route('GET', '/jobs/connection', async (request) => {
    const actor = await requirePermission(request, 'jobs');
    const available = Boolean(getJobConnectionSessionService?.());
    const connection = (await pool.query('SELECT status,resume_id,revision FROM job_connections WHERE user_id=$1', [actor.userId])).rows[0] || null;
    await requirePermission(request, 'jobs');
    return { ok: true, connected: connection?.status === 'connected', resumeId: connection?.status === 'connected' ? connection.resume_id : null,
      revision: connection?.revision || 0, available };
  });

  route('POST', '/jobs/login', async (request) => {
    const actor = await requirePermission(request, 'jobs', true);
    const parsed = z.strictObject({ requestId: z.uuid() }).safeParse(request.body);
    if (!parsed.success) fail('invalid_request');
    const delivery = getJobLoginLinkDelivery?.();
    if (!delivery) fail('JOB_LOGIN_UNAVAILABLE');
    const result = await delivery.create({ userId: actor.userId, requestId: parsed.data.requestId });
    await requirePermission(request, 'jobs');
    return { ok: true, ...result };
  });

  route('GET', '/jobs/login/owned/status/:sessionId', async (request) => {
    const actor = await requirePermission(request, 'jobs');
    const sessionId = sessionIdFrom(request);
    const result = await jobSessions().status({ sessionId, userId: actor.userId });
    await requirePermission(request, 'jobs');
    return { ok: true, ...result };
  });

  route('POST', '/jobs/login/claim', async (request, reply) => {
    requireOrigin(request);
    const parsed = z.strictObject({ ticket: z.string().regex(/^[a-f\d]{64}$/i) }).safeParse(request.body);
    if (!parsed.success) fail('invalid_request');
    const claimed = await jobSessions().claim({ ticket: parsed.data.ticket, existingGuestToken: readJobLoginCookie(request) });
    reply.header('Set-Cookie', jobLoginCookie(claimed.guestToken));
    return { ok: true, sessionId: claimed.sessionId, expiresAt: claimed.expiresAt };
  });

  route('GET', '/jobs/login/status/:sessionId', async (request, reply) => {
    const guest = await guestActor(request, reply), sessionId = sessionIdFrom(request);
    if (guest.sessionId !== sessionId) fail('JOB_LOGIN_SESSION_INVALID');
    return withGuestSession(reply, async () => ({ ok: true, ...(await jobSessions().status({ sessionId, userId: guest.userId })) }));
  });
  route('GET', '/jobs/login/frame/:sessionId', async (request, reply) => {
    const guest = await guestActor(request, reply), sessionId = sessionIdFrom(request);
    if (guest.sessionId !== sessionId) fail('JOB_LOGIN_SESSION_INVALID');
    return withGuestSession(reply, async () => ({ ok: true, ...(await jobSessions().frame({ sessionId, userId: guest.userId })) }));
  });
  route('POST', '/jobs/login/input/:sessionId', async (request, reply) => {
    requireOrigin(request);
    const guest = await guestActor(request, reply), sessionId = sessionIdFrom(request);
    const parsed = z.strictObject({ sequence: z.number().int().min(1).max(1000000000), event: loginEvent }).safeParse(request.body);
    if (guest.sessionId !== sessionId || !parsed.success) fail('JOB_LOGIN_SESSION_INVALID');
    return withGuestSession(reply, async () => ({ ok: true, ...(await jobSessions().input({ sessionId, userId: guest.userId, ...parsed.data })) }));
  });

  route('POST', '/jobs/login/confirm', async (request, reply) => {
    const actor = await requirePermission(request, 'jobs', true);
    const parsed = z.strictObject({ sessionId: z.uuid(), resumeId: z.string().regex(/^[a-zA-Z0-9]{1,100}$/) }).safeParse(request.body);
    if (!parsed.success) fail('invalid_request');
    const result = await jobSessions().confirm({ ...parsed.data, userId: actor.userId });
    await requirePermission(request, 'jobs');
    reply.header('Set-Cookie', jobLoginCookie(''));
    return { ok: true, ...result };
  });
  route('POST', '/jobs/login/cancel', async (request, reply) => {
    const actor = await requirePermission(request, 'jobs', true);
    const parsed = z.strictObject({ sessionId: z.uuid() }).safeParse(request.body);
    if (!parsed.success) fail('invalid_request');
    const result = await jobSessions().cancel({ ...parsed.data, userId: actor.userId });
    reply.header('Set-Cookie', jobLoginCookie(''));
    return { ok: true, ...result };
  });
  route('POST', '/jobs/login/guest/cancel', async (request, reply) => {
    requireOrigin(request);
    const guest = await guestActor(request, reply);
    const parsed = z.strictObject({ sessionId: z.uuid() }).safeParse(request.body);
    if (!parsed.success || parsed.data.sessionId !== guest.sessionId) fail('JOB_LOGIN_SESSION_INVALID');
    reply.header('Set-Cookie', jobLoginCookie(''));
    const result = await jobSessions().cancel({ sessionId: guest.sessionId, userId: guest.userId });
    return { ok: true, ...result };
  });

  async function sectionResponse(request) {
    const permission = request.params.permission;
    if (!PERMISSIONS.includes(permission)) fail('invalid_request');
    const actor = await requirePermission(request, permission);
    const userId = actor.userId;
    let items = [], notice = '', paging = { pageSize: 30, nextCursor: null };
    const cursor = request.params.cursor ?? null;
    const sourceAvailable = ({ memory: memoryService, documents: knowledgeService, devices: deviceService, life: missionControlService })[permission];
    if (cursor && (!services.sectionReader || !sourceAvailable)) fail('invalid_request');
    if (services.sectionReader && sourceAvailable) {
      const page = await services.sectionReader.read({ userId, section: permission, cursor });
      items = page.items; paging = page.paging;
      if (permission === 'life' && !cursor) {
        const data = await missionControlService.get({ userId });
        if (data.currentMission) items.unshift({ id: data.currentMission.id, title: data.currentMission.name, detail: 'Текущая миссия' });
        if (data.partial) notice = 'Часть данных Life OS временно недоступна. Договорённости показаны ниже.';
      }
    } else if (permission === 'memory' && memoryService) items = (await memoryService.list({ userId, limit: 30 }))
      .map((item) => ({ id: item.id, title: item.content }));
    else if (permission === 'documents' && knowledgeService) items = (await knowledgeService.list({ userId }))
      .slice(0, 100).map((item) => ({ id: item.id, title: item.original_name, detail: publicDocumentStatus(item) }));
    else if (permission === 'devices' && deviceService) items = (await deviceService.list({ userId }))
      .slice(0, 100).map((item) => ({ id: item.id, title: item.name, detail: item.status }));
    else if (permission === 'life' && missionControlService) {
      const data = await missionControlService.get({ userId });
      if (data.currentMission) items.push({ id: data.currentMission.id, title: data.currentMission.name, detail: 'Текущая миссия' });
      items.push(...(data.commitments || []).slice(0, 30).map((item) => ({ id: item.id, title: item.title, detail: item.dueAt ? `Договорённость · ${formatMoscowDateTime(item.dueAt)}` : 'Договорённость' })));
    } else if (permission === 'jobs') {
      notice = 'Поиск использует твой личный профиль HH. Для подключения понадобится войти в HH и выбрать основное резюме.';
    } else if (permission === 'vpn') notice = actor.level === 'owner'
      ? 'Подписки и подтверждения VPN доступны в личном чате с ботом.'
      : 'Управление общей VPN-инфраструктурой требует отдельного подтверждения владельца.';
    else if (permission === 'operations') notice = 'Управление пользователями и ролями доступно во вкладке «Управление». Закрытые операции VPS сохраняют подтверждение владельца.';
    else if (permission === 'assistant') notice = 'Открой вкладку «Ассистент» для личного диалога.';
    else notice = 'Этот раздел сейчас не подключён на сервере.';
    const currentActor = await requirePermission(request, permission); // Revocation during a read must hide the result.
    return { ok: true, section: permission, items, notice, paging,
      available: ['memory', 'documents', 'devices', 'life'].includes(permission) ? Boolean(sourceAvailable) : true,
      actions: sectionNavigation(permission, currentActor, services) };
  }
  route('GET', '/sections/:permission', sectionResponse);
  route('GET', '/sections/:permission/page/:cursor', sectionResponse);

  async function historyResponse(request) {
    const actor = await requirePermission(request, 'assistant');
    const conversation = await conversationRepository.getOrCreate({ userId: actor.userId, channel: 'pwa', externalChatId: 'mini' });
    const cursor = request.params?.cursor ?? null;
    if (cursor && !services.sectionReader) fail('invalid_request');
    const page = services.sectionReader
      ? await services.sectionReader.read({ userId: actor.userId, section: 'assistant', conversationId: conversation.id, cursor })
      : { messages: await conversationRepository.recentMessages({ userId: actor.userId, conversationId: conversation.id, limit: 30 }), paging: { pageSize: 30, nextCursor: null } };
    await requirePermission(request, 'assistant');
    return { ok: true, paging: page.paging, messages: page.messages.filter((item) => ['user', 'assistant'].includes(item.role))
      .map((item) => ({ id: String(item.id), role: item.role, content: item.content })) };
  }
  route('GET', '/assistant/messages', historyResponse);
  route('GET', '/assistant/messages/page/:cursor', historyResponse);

  route('GET', '/assistant/requests/:id', async (request) => {
    const actor = await requirePermission(request, 'assistant');
    if (!z.uuid().safeParse(request.params.id).success) fail('invalid_request');
    const row = await readReceipt(pool, actor.userId, request.params.id);
    await requirePermission(request, 'assistant');
    const result = responseForReceipt(row);
    if (!result) fail('operation_unknown');
    return result;
  });

  route('POST', '/assistant/messages', async (request) => {
    const actor = await requirePermission(request, 'assistant', true);
    const parsed = messageSchema.safeParse(request.body);
    if (!parsed.success) fail('invalid_request');
    const { requestId, text } = parsed.data;
    const userId = actor.userId, requestHash = createHash('sha256').update(text).digest('hex');
    try { chatLimiter.check(`mini:${userId}`, { limit: 10, windowMs: 60000 }); }
    catch { fail('rate_limited'); }
    const claim = await pool.query(`INSERT INTO mini_app_requests(user_id,request_id,request_hash)
      VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING request_id`, [userId, requestId, requestHash]);
    if (!claim.rowCount) {
      const original = await readReceipt(pool, userId, requestId);
      if (!original) fail('operation_unknown');
      if (original.request_hash !== requestHash) fail('operation_conflict');
      await requirePermission(request, 'assistant');
      const result = responseForReceipt(original);
      if (!result) fail('operation_unknown');
      return result;
    }
    // Processing records are intentionally not retried after uncertain results.
    // Only text is supported here; actions retain their original client confirmations.
    try {
      const conversation = await conversationRepository.getOrCreate({ userId, channel: 'pwa', externalChatId: 'mini' });
      await conversationRepository.appendMessage({ userId, conversationId: conversation.id, role: 'user', content: text, externalMessageId: `mini:${requestId}` });
      const history = await conversationRepository.recentMessages({ userId, conversationId: conversation.id, limit: 30 });
      const has = (permission) => accessService.allows(userId, permission);
      const memories = memoryService && await has('memory') ? await memoryService.memoriesForPrompt({ userId }) : [];
      const documents = knowledgeService && await has('documents') ? await knowledgeService.searchForPrompt({ userId, query: text }) : [];
      const answer = renderDocumentCitations(String(await assistant.answer({ userId, conversationId: conversation.id,
        currentRequest: text, history, memories, documents, devices: [],
        runtimeContext: { channel: 'pwa', toolsAvailable: [], verifiedToolResults: [] } })).trim(), documents).slice(0, 10000);
      if (!answer) fail('unavailable');
      await requirePermission(request, 'assistant');
      if ((memories.length && !await has('memory')) || (documents.length && !await has('documents'))) fail('forbidden');
      const completed = await completeReceipt(pool, { userId, requestId, conversationId: conversation.id, answer });
      if (!completed) fail('operation_unknown');
      return { ok: true, status: 'completed', answer };
    } catch (error) {
      // A receipt may already be committed when the connection fails. Preserve that result.
      try { await failReceipt(pool, userId, requestId); } catch {}
      throw error;
    }
  });
}

module.exports = { registerMiniAppSelfRoutes };
