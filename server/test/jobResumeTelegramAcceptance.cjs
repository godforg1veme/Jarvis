const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createJobPostgresFixture } = require('./helpers/jobPostgresFixture');
const { AccessService } = require('../src/access/accessService');
const { JobResumeRepository } = require('../src/jobs/jobResumeRepository');
const { JobResumeService } = require('../src/jobs/jobResumeService');
const { JobResumeTelegram } = require('../src/jobs/jobResumeTelegram');
const { JobSearchRepository } = require('../src/jobs/jobSearchRepository');
const { JobUsageRepository } = require('../src/jobs/jobUsageRepository');
const { JobTelegramService } = require('../src/jobs/jobTelegramService');
const { TelegramMessageService } = require('../src/telegram/messageService');
const { TelegramMenuService } = require('../src/telegram/telegramMenuService');
const { TelegramUpdateRepository } = require('../src/telegram/telegramUpdateRepository');
const { TelegramInteractionRepository } = require('../src/telegram/telegramInteractionRepository');
const { UserRepository } = require('../src/users/userRepository');
const { ConversationRepository } = require('../src/conversations/conversationRepository');

async function fixture() {
  const f = await createJobPostgresFixture();
  try {
    await f.pool.query("INSERT INTO user_identities(user_id,provider,external_id) VALUES($1,'telegram','101')", [f.owner]);
    const access = new AccessService({ pool: f.pool, ownerTelegramId: '101' });
    await access.initialize();
    const owner = await access.getAccessForTelegram('101');
    const role = await access.mutate(owner.userId, 'role.create', {
      operationId: randomUUID(), name: 'Resume bot acceptance', permissions: ['jobs'],
    });
    const member = await access.mutate(owner.userId, 'user.create', {
      operationId: randomUUID(), telegramId: '303', displayName: 'Fixture member', level: 'member', roleId: role.id,
    });
    await f.pool.query("INSERT INTO job_connections(user_id,resume_id,status) VALUES($1,'ownerA','connected'),($2,'memberA','connected')",
      [owner.userId, member.userId]);
    const selected = new Map([[owner.userId, 'ownerA'], [member.userId, 'memberA']]);
    const catalogs = new Map([
      [owner.userId, [{ id: 'ownerA', title: 'Owner first resume', canRaise: true }, { id: 'ownerB', title: 'Owner second resume', canRaise: true }]],
      [member.userId, [{ id: 'memberA', title: 'Member private resume', canRaise: true },
        { id: 'memberB', title: 'Member alternate resume', canRaise: true }]],
    ]);
    const calls = { list: [], select: [] };
    const gates = { list: null, select: null };
    let loseNextAck = false;
    function createGate(kind) {
      let markEntered, releaseGate;
      const entered = new Promise((resolve) => { markEntered = resolve; });
      const blocked = new Promise((resolve) => { releaseGate = resolve; });
      gates[kind] = { entered, markEntered, blocked };
      return { entered, release: releaseGate };
    }
    async function waitAtGate(kind) {
      const gate = gates[kind];
      if (!gate) return;
      gates[kind] = null;
      gate.markEntered();
      await gate.blocked;
    }
    const browserClient = { resumeToken: 'synthetic-resume-token', forUser(userId) {
      return {
        async listResumes() { calls.list.push(userId); await waitAtGate('list'); return structuredClone(catalogs.get(userId) || []); },
        async selectResume({ resumeId }) {
          calls.select.push({ userId, resumeId }); await waitAtGate('select'); selected.set(userId, resumeId);
          if (loseNextAck) { loseNextAck = false; throw new Error('synthetic acknowledgement lost'); }
          return { ok: true };
        },
        async connection() { return { resumeId: selected.get(userId) }; },
      };
    } };
    const repository = new JobResumeRepository(f.pool, access);
    const resumeService = new JobResumeService({ repository, browserClient });
    const resumePanel = new JobResumeTelegram({ service: resumeService });
    const jobs = new JobTelegramService({ pool: f.pool, accessService: access, ownerTelegramId: '101',
      searchRepository: new JobSearchRepository(f.pool, { accessService: access }), usageRepository: new JobUsageRepository(f.pool), resumeService });
    const menu = new TelegramMenuService({ interactions: new TelegramInteractionRepository(f.pool),
      jobSearchService: jobs, accessService: access, ownerTelegramId: '101' });
    const messages = new TelegramMessageService({ accessPolicy: { isAllowed: async () => true }, accessService: access,
      updateRepository: new TelegramUpdateRepository(f.pool), userRepository: new UserRepository(f.pool),
      conversationRepository: new ConversationRepository(f.pool), menuService: menu });
    return { ...f, access, owner, member, selected, catalogs, calls, repository, resumeService, resumePanel, jobs, menu, messages,
      loseNextSelectAck() { loseNextAck = true; },
      gateNextList() { return createGate('list'); },
      gateNextSelect() { return createGate('select'); },
      callback: (updateId, telegramId, chatId, data, chatType = 'private') => ({ update_id: updateId,
        callback_query: { id: `callback-${updateId}`, from: { id: Number(telegramId), first_name: 'Fixture' }, data,
          message: { message_id: updateId, chat: { id: Number(chatId), type: chatType } } } }),
      message: (updateId, telegramId, chatId, text, chatType = 'private') => ({ update_id: updateId,
        message: { message_id: updateId, from: { id: Number(telegramId), first_name: 'Fixture' },
          chat: { id: Number(chatId), type: chatType }, text } }),
    };
  } catch (error) { await f.close(); throw error; }
}

async function send(f, updateId, data, telegramId = 101, chatId = telegramId, chatType = 'private') {
  return f.messages.handleCallback(f.callback(updateId, telegramId, chatId, data, chatType));
}
function button(response, text) {
  return (response.buttons || []).flat().find((item) => item.text === text);
}
function buttonWithTitle(response, title) {
  return (response.buttons || []).flat().find((item) => item.text.includes(title));
}

test('real bot home exposes resume management only for a connected HH account', async () => {
  const f = await fixture();
  try {
    const noConnection = await f.pool.query('DELETE FROM job_connections WHERE user_id=$1', [f.member.userId]);
    assert.equal(noConnection.rowCount, 1);
    const disconnected = await send(f, 4001, 'job:menu', 303);
    assert.equal(disconnected.status, 'answered');
    assert.equal(button(disconnected, 'Резюме HH'), undefined);
    await f.pool.query("INSERT INTO job_connections(user_id,resume_id,status) VALUES($1,'memberA','connected')", [f.member.userId]);
    const connected = await send(f, 4002, 'job:menu', 303);
    assert.ok(button(connected, 'Резюме HH'));
  } finally { await f.close(); }
});

test('Telegram resume menu shows only the actor catalog and primary mark; selection previews without mutation', async () => {
  const f = await fixture();
  try {
    const result = await send(f, 4010, 'job:resumes', 101);
    assert.equal(result.status, 'answered');
    assert.match(result.answer, /Owner first resume/);
    assert.match(result.answer, /Автоподнятие: включено|Автоподнятие: выключено/);
    assert.equal(JSON.stringify(result.buttons).includes('Member private resume'), false);
    const first = button(result, '✓ Owner first resume');
    const second = button(result, 'Owner second resume');
    assert.ok(first); assert.ok(second);
    assert.equal(first.data.startsWith('job:rs_pick:'), true);
    assert.equal(Buffer.byteLength(second.data) <= 64, true);
    const before = (await f.resumeService.get(f.owner.userId));
    const preview = await send(f, 4011, second.data, 101);
    assert.match(preview.answer, /Проверь изменения HH/);
    assert.match(preview.answer, /Owner second resume/);
    assert.ok(button(preview, 'Подтвердить'));
    assert.equal((await f.resumeService.get(f.owner.userId)).primaryResumeId, before.primaryResumeId);
    assert.equal(f.calls.select.length, 0);
  } finally { await f.close(); }
});

test('confirmation is one-shot across duplicate updates and repeated new update IDs', async () => {
  const f = await fixture();
  try {
    const menu = await send(f, 4020, 'job:resumes', 101);
    const pick = button(menu, 'Owner second resume');
    const preview = await send(f, 4021, pick.data, 101);
    const confirm = button(preview, 'Подтвердить');
    assert.ok(confirm);
    const first = await send(f, 4022, confirm.data, 101);
    assert.match(first.answer, /сохранены/);
    assert.equal((await f.resumeService.get(f.owner.userId)).primaryResumeId, 'ownerB');
    assert.equal(f.calls.select.length, 1);
    assert.equal((await send(f, 4022, confirm.data, 101)).status, 'duplicate');
    const replayWithNewUpdate = await send(f, 4023, confirm.data, 101);
    assert.match(replayWithNewUpdate.answer, /недоступно|сохранены/);
    assert.equal(f.calls.select.length, 1);
  } finally { await f.close(); }
});

test('member, foreign confirmation, another private conversation, and group chat cannot use an owner menu', async () => {
  const f = await fixture();
  try {
    const ownerMenu = await send(f, 4030, 'job:resumes', 101);
    const ownerPick = button(ownerMenu, 'Owner second resume');
    const memberPick = await send(f, 4031, ownerPick.data, 303);
    assert.match(memberPick.answer, /недоступно|недоступен|доступен только/);
    assert.equal(f.calls.select.length, 0);

    const ownerPreview = await send(f, 4032, ownerPick.data, 101);
    const confirmData = button(ownerPreview, 'Подтвердить').data;
    // A second valid Telegram identity resolves to the same Jarvis user, but
    // gets a distinct Telegram conversation and cannot consume the first one.
    await f.pool.query("INSERT INTO user_identities(user_id,provider,external_id) VALUES($1,'telegram','909')", [f.owner.userId]);
    const foreignConversation = await send(f, 4033, confirmData, 909, 909);
    assert.match(foreignConversation.answer, /недоступно|недоступен|доступен только/);
    const group = await send(f, 4034, confirmData, 101, -101, 'group');
    assert.match(group.answer, /личном чате|недоступен/);
    assert.equal(f.calls.select.length, 0);

    const memberMenu = await send(f, 4035, 'job:resumes', 303);
    const memberOnlyPick = buttonWithTitle(memberMenu, 'Member private resume');
    assert.ok(memberOnlyPick, `member menu response: ${memberMenu.answer}`);
    assert.notEqual(memberOnlyPick.data, ownerPick.data);
    assert.equal(JSON.stringify(memberMenu.buttons).includes('Owner second resume'), false);
    assert.equal((await f.resumeService.get(f.member.userId)).primaryResumeId, 'memberA');
  } finally { await f.close(); }
});

test('permission revocation during read-only resume listing wins before any browser selection', async () => {
  const f = await fixture();
  try {
    const state = await f.resumeService.get(f.member.userId);
    const gate = f.gateNextList();
    const selecting = f.resumeService.settings(f.member.userId, {
      requestId: randomUUID(), expectedRevision: state.revision, connectionRevision: state.connectionRevision,
      resumeId: 'memberB', autoRaiseEnabled: false,
    });
    await gate.entered;
    const current = await f.access.getAccessForTelegram('303');
    await f.access.mutate(f.owner.userId, 'user.update', { operationId: randomUUID(), revision: current.revision,
      overrides: { jobs: 'deny' } }, '303');
    gate.release();
    await assert.rejects(selecting);
    assert.equal(f.calls.select.length, 0);
    assert.match((await send(f, 4070, 'job:resumes', 303)).answer, /недоступен/);
  } finally { await f.close(); }
});

test('revocation started inside select waits for settings lock, then completes after one commit and blocks follow-up', async () => {
  const f = await fixture();
  try {
    const state = await f.resumeService.get(f.member.userId);
    const gate = f.gateNextSelect();
    const selecting = f.resumeService.settings(f.member.userId, {
      requestId: randomUUID(), expectedRevision: state.revision, connectionRevision: state.connectionRevision,
      resumeId: 'memberB', autoRaiseEnabled: false,
    });
    await gate.entered;
    const current = await f.access.getAccessForTelegram('303');
    let revokeFinished = false;
    const revoking = f.access.mutate(f.owner.userId, 'user.update', { operationId: randomUUID(), revision: current.revision,
      overrides: { jobs: 'deny' } }, '303').then((result) => { revokeFinished = true; return result; });

    // Observe the real revocation transaction waiting for the same global
    // advisory lock held by settings across the external selection and commit.
    let waiting = false;
    for (let attempt = 0; attempt < 500 && !waiting; attempt++) {
      const row = (await f.pool.query(`SELECT count(*)::int AS n FROM pg_locks l
        JOIN pg_stat_activity a USING(pid)
        WHERE l.locktype='advisory' AND NOT l.granted
          AND a.query ILIKE '%jarvis-access-admin%'`)).rows[0];
      waiting = row.n > 0;
      if (!waiting) await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(waiting, true, 'revocation should be queued behind the active selection transaction');
    assert.equal(revokeFinished, false);
    gate.release();
    const result = await selecting;
    assert.equal(result.status, 'complete');
    const row = (await f.pool.query('SELECT resume_id FROM job_connections WHERE user_id=$1', [f.member.userId])).rows[0];
    assert.equal(row.resume_id, 'memberB');
    await revoking;
    assert.equal(revokeFinished, true);
    assert.equal(f.calls.select.length, 1);
    const denied = await send(f, 4071, 'job:resumes', 303);
    assert.match(denied.answer, /недоступен/);
  } finally { await f.close(); }
});

test('stale catalog revision, expiry, and cancel leave the primary selection untouched', async () => {
  const f = await fixture();
  try {
    const staleMenu = await send(f, 4040, 'job:resumes', 101);
    const stalePick = button(staleMenu, 'Owner second resume');
    await f.pool.query('UPDATE job_resume_managers SET revision=revision+1 WHERE user_id=$1', [f.owner.userId]);
    const stalePreview = await send(f, 4041, stalePick.data, 101);
    assert.match(stalePreview.answer, /изменил|актуальн/);
    assert.equal(f.calls.select.length, 0);

    const menu = await send(f, 4042, 'job:resumes', 101);
    const pick = button(menu, 'Owner second resume');
    const preview = await send(f, 4043, pick.data, 101);
    const confirm = button(preview, 'Подтвердить');
    const id = confirm.data.slice('job:rs_ok:'.length);
    await f.pool.query("UPDATE job_confirmations SET expires_at=now()-interval '1 second' WHERE id=$1", [id]);
    const expired = await send(f, 4044, confirm.data, 101);
    assert.match(expired.answer, /недоступно|истекло/);
    assert.equal(f.calls.select.length, 0);

    const freshMenu = await send(f, 4045, 'job:resumes', 101);
    const freshPreview = await send(f, 4046, button(freshMenu, 'Owner second resume').data, 101);
    const cancelled = await send(f, 4047, button(freshPreview, 'Отмена').data, 101);
    assert.equal(cancelled.status, 'answered');
    assert.equal((await f.resumeService.get(f.owner.userId)).primaryResumeId, 'ownerA');
    assert.equal(f.calls.select.length, 0);
  } finally { await f.close(); }
});

test('lost select acknowledgement is reconciled with original confirmation without another selection', async () => {
  const f = await fixture();
  try {
    const menu = await send(f, 4050, 'job:resumes', 101);
    const preview = await send(f, 4051, button(menu, 'Owner second resume').data, 101);
    const confirm = button(preview, 'Подтвердить');
    f.loseNextSelectAck();
    const lost = await send(f, 4052, confirm.data, 101);
    assert.match(lost.answer, /не подтверждён|исходный запрос/);
    assert.ok(button(lost, 'Проверить исходный запрос'));
    assert.equal((await f.resumeService.get(f.owner.userId)).primaryResumeId, 'ownerA');
    const status = await send(f, 4053, button(lost, 'Проверить исходный запрос').data, 101);
    assert.match(status.answer, /сохранены/);
    assert.equal((await f.resumeService.get(f.owner.userId)).primaryResumeId, 'ownerB');
    assert.equal(f.calls.select.length, 1);
    assert.equal(f.selected.get(f.owner.userId), 'ownerB');
  } finally { await f.close(); }
});

test('bot and Mini App use the same resume service; disabling auto-raise persists without selecting a resume', async () => {
  const f = await fixture();
  try {
    const initial = await f.resumeService.get(f.owner.userId);
    const menu = await send(f, 4060, 'job:resumes', 101);
    const auto = button(menu, 'Выключить автоподнятие');
    assert.ok(auto);
    const preview = await send(f, 4061, auto.data, 101);
    const saved = await send(f, 4062, button(preview, 'Подтвердить').data, 101);
    assert.match(saved.answer, /сохранены/);
    const selectionsAfterSave = f.calls.select.length;
    assert.equal(selectionsAfterSave, 0);
    const shared = await f.resumeService.get(f.owner.userId);
    assert.equal(shared.primaryResumeId, initial.primaryResumeId);
    assert.equal(shared.autoRaise.enabled, false);
    await f.resumeService.get(f.owner.userId);
    await f.resumeService.get(f.member.userId);
    assert.equal((await f.resumeService.get(f.owner.userId)).autoRaise.enabled, false);
    const row = (await f.pool.query('SELECT auto_raise_enabled,auto_raise_preference FROM job_resume_managers WHERE user_id=$1', [f.owner.userId])).rows[0];
    assert.deepEqual(row, { auto_raise_enabled: false, auto_raise_preference: false });
    assert.equal(f.calls.select.length, selectionsAfterSave);
  } finally { await f.close(); }
});

test('auto-raise can be turned off when the primary resume is absent from an empty HH catalog', async () => {
  const f = await fixture();
  try {
    f.catalogs.set(f.owner.userId, []);
    const initial = await f.resumeService.get(f.owner.userId);
    assert.equal(initial.primaryResumeId, 'ownerA');
    assert.equal(initial.autoRaise.enabled, true);

    const menu = await send(f, 4080, 'job:resumes', 101);
    assert.match(menu.answer, /выбранное ранее резюме недоступно/);
    const stop = button(menu, 'Выключить автоподнятие');
    assert.ok(stop);
    const preview = await send(f, 4081, stop.data, 101);
    assert.match(preview.answer, /Основное резюме: «ранее выбранное резюме»/);
    assert.match(preview.answer, /Автоподнятие: выключено/);
    const confirm = button(preview, 'Подтвердить');
    assert.ok(confirm);

    // Opening the menu may refresh once. Confirming a local off setting must
    // not issue another HH list read or select call.
    const readsBeforeConfirm = f.calls.list.length;
    assert.ok(readsBeforeConfirm >= 1);
    const saved = await send(f, 4082, confirm.data, 101);
    assert.match(saved.answer, /сохранены/);
    assert.equal(f.calls.list.length, readsBeforeConfirm);
    assert.equal(f.calls.select.length, 0);

    const after = await f.resumeService.get(f.owner.userId);
    assert.equal(after.primaryResumeId, 'ownerA');
    assert.equal(after.autoRaise.enabled, false);
    await f.resumeService.get(f.owner.userId);
    await f.resumeService.get(f.owner.userId);
    assert.equal((await f.resumeService.get(f.owner.userId)).autoRaise.enabled, false);
    const persisted = (await f.pool.query('SELECT auto_raise_enabled,auto_raise_preference,auto_raise_policy_applied FROM job_resume_managers WHERE user_id=$1', [f.owner.userId])).rows[0];
    assert.deepEqual(persisted, { auto_raise_enabled: false, auto_raise_preference: false, auto_raise_policy_applied: true });
  } finally { await f.close(); }
});
