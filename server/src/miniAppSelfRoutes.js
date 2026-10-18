const { z } = require('zod');
const { createHash } = require('node:crypto');
const { PERMISSIONS } = require('./access/permissionCatalog');
const { renderDocumentCitations, publicDocumentStatus } = require('./knowledge/knowledgeService');
const { FixedWindowRateLimiter } = require('./http/rateLimiter');

const messageSchema = z.object({ requestId: z.uuid(), text: z.string().trim().min(1).max(10000) }).strict();
const fail = (code) => { throw Object.assign(new Error(code), { code }); };

function registerMiniAppSelfRoutes({ route, authorize }, services) {
  const { accessService, memoryService, knowledgeService, deviceService, missionControlService,
    assistant, conversationRepository, pool } = services;
  const chatLimiter = new FixedWindowRateLimiter();
  const requirePermission = async (request, permission, mutation = false) => {
    const session = await authorize(request, { mutation });
    if (!session.actor.permissions.includes(permission)) fail('forbidden');
    return session.actor;
  };

  route('GET', '/sections/:permission', async (request) => {
    const permission = request.params.permission;
    if (!PERMISSIONS.includes(permission)) fail('invalid_request');
    const actor = await requirePermission(request, permission);
    const userId = actor.userId;
    let items = [], notice = '';
    if (permission === 'memory' && memoryService) items = (await memoryService.list({ userId, limit: 30 }))
      .map((item) => ({ id: item.id, title: item.content }));
    else if (permission === 'documents' && knowledgeService) items = (await knowledgeService.list({ userId }))
      .slice(0, 100).map((item) => ({ id: item.id, title: item.original_name, detail: publicDocumentStatus(item) }));
    else if (permission === 'devices' && deviceService) items = (await deviceService.list({ userId }))
      .slice(0, 100).map((item) => ({ id: item.id, title: item.name, detail: item.status }));
    else if (permission === 'life' && missionControlService) {
      const data = await missionControlService.get({ userId });
      if (data.currentMission) items.push({ id: data.currentMission.id, title: data.currentMission.name, detail: 'Текущая миссия' });
      items.push(...(data.commitments || []).slice(0, 30).map((item) => ({ id: item.id, title: item.title, detail: 'Договорённость' })));
    } else if (permission === 'jobs') {
      if (actor.level !== 'owner') notice = 'Нужно отдельное подключение HH. Аккаунт владельца другим людям не передаётся.';
      else notice = 'Настройки поиска, вакансии и подтверждения откликов доступны в личном чате с ботом.';
    } else if (permission === 'vpn') notice = actor.level === 'owner'
      ? 'Подписки и подтверждения VPN доступны в личном чате с ботом.'
      : 'Управление общей VPN-инфраструктурой требует отдельного подтверждения владельца.';
    else if (permission === 'operations') notice = 'Управление пользователями и ролями доступно во вкладке «Управление». Закрытые операции VPS сохраняют подтверждение владельца.';
    else if (permission === 'assistant') notice = 'Открой вкладку «Ассистент» для личного диалога.';
    else notice = 'Этот раздел сейчас не подключён на сервере.';
    await requirePermission(request, permission); // Revocation during a read must hide the result.
    return { ok: true, section: permission, items, notice };
  });

  route('GET', '/assistant/messages', async (request) => {
    const actor = await requirePermission(request, 'assistant');
    const conversation = await conversationRepository.getOrCreate({ userId: actor.userId, channel: 'pwa', externalChatId: 'mini' });
    const messages = await conversationRepository.recentMessages({ userId: actor.userId, conversationId: conversation.id, limit: 30 });
    await requirePermission(request, 'assistant');
    return { ok: true, messages: messages.filter((item) => ['user', 'assistant'].includes(item.role))
      .map((item) => ({ id: String(item.id), role: item.role, content: item.content })) };
  });

  route('GET', '/assistant/requests/:id', async (request) => {
    const actor = await requirePermission(request, 'assistant');
    if (!z.uuid().safeParse(request.params.id).success) fail('invalid_request');
    const row = (await pool.query('SELECT status,answer FROM mini_app_requests WHERE user_id=$1 AND request_id=$2', [actor.userId, request.params.id])).rows[0];
    if (!row || row.status !== 'completed') fail('operation_unknown');
    return { ok: true, answer: row.answer };
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
      const original = (await pool.query('SELECT request_hash,status,answer FROM mini_app_requests WHERE user_id=$1 AND request_id=$2', [userId, requestId])).rows[0];
      if (original.request_hash !== requestHash) fail('operation_conflict');
      if (original.status !== 'completed') fail('operation_unknown');
      return { ok: true, answer: original.answer };
    }
    // Processing records are intentionally not retried after uncertain results.
    // Only text is supported here; actions retain their original client confirmations.
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
    await conversationRepository.appendMessage({ userId, conversationId: conversation.id, role: 'assistant', content: answer, externalMessageId: `mini:${requestId}:answer` });
    await pool.query("UPDATE mini_app_requests SET status='completed',answer=$1 WHERE user_id=$2 AND request_id=$3", [answer, userId, requestId]);
    return { ok: true, answer };
  });
}

module.exports = { registerMiniAppSelfRoutes };
