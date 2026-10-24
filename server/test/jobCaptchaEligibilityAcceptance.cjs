const test = require('node:test');
const assert = require('node:assert/strict');
const { createJobPostgresFixture } = require('./helpers/jobPostgresFixture');
const { JobSearchRepository } = require('../src/jobs/jobSearchRepository');
const { JobCaptchaRepository } = require('../src/jobs/jobCaptchaRepository');
const { configuredOwnerJobAccess } = require('../src/jobs/configuredOwnerJobAccess');

test('CAPTCHA eligibility follows active private jobs scope for owner, admin and member without HH connection', async () => {
  const f = await createJobPostgresFixture();
  try {
    await f.pool.query("INSERT INTO user_identities(user_id,provider,external_id) VALUES($1,'telegram','101')", [f.owner]);
    const accessService = configuredOwnerJobAccess(f.pool, '101');
    const search = new JobSearchRepository(f.pool, { accessService });
    const captcha = new JobCaptchaRepository(f.pool, { accessService });
    const add = async (telegramId, level, { paused = false, denied = false, foreignChat = false } = {}) => {
      const userId = (await f.pool.query("INSERT INTO users(display_name,role) VALUES($1,'member') RETURNING id", [`User ${telegramId}`])).rows[0].id;
      await f.pool.query("INSERT INTO user_identities(user_id,provider,external_id) VALUES($1,'telegram',$2)", [userId, telegramId]);
      await f.pool.query('INSERT INTO access_memberships(user_id,telegram_id,level) VALUES($1,$2,$3)', [userId, telegramId, level]);
      if (!denied) await f.pool.query("INSERT INTO access_user_overrides(user_id,permission,effect) VALUES($1,'jobs','allow')", [userId]);
      const chatId = foreignChat ? '999' : telegramId;
      const conversationId = (await f.pool.query("INSERT INTO conversations(user_id,channel,external_chat_id) VALUES($1,'telegram',$2) RETURNING id", [userId, chatId])).rows[0].id;
      const scope = { userId, conversationId, chatId: telegramId, channel: 'telegram' };
      if (foreignChat || denied) {
        await f.pool.query(`INSERT INTO job_searches(user_id,conversation_id,chat_id,settings)
          VALUES($1,$2,$3,$4)`, [userId, conversationId, chatId,
          { queries: ['AI'], activated: true, paused: false }]);
      } else {
        const initial = await search.ensure({ scope });
        await search.saveSettings({ scope, expectedRevision: initial.revision,
          settings: { ...initial.settings, queries: ['AI'], activated: true, paused } });
      }
      return userId;
    };
    const ownerSettings = await search.ensure({ scope: f.scope });
    await search.saveSettings({ scope: f.scope, expectedRevision: ownerSettings.revision,
      settings: { ...ownerSettings.settings, queries: ['AI'], activated: true, paused: false } });
    const admin = await add('102', 'admin');
    const member = await add('103', 'member');
    const paused = await add('104', 'member', { paused: true });
    const revoked = await add('105', 'member', { denied: true });
    const foreign = await add('106', 'member', { foreignChat: true });
    assert.deepEqual(new Set(await captcha.activeUsers()), new Set([f.owner, admin, member]));
    assert.equal(await captcha.scope(member).then((scope) => scope.chatId), '103');
    assert.equal(await captcha.scope(foreign), null);
    assert.ok(![paused, revoked, foreign].some((id) => [f.owner, admin, member].includes(id)));
    const later = [];
    for (let index = 0; index < 101; index++) later.push(await add(String(1000 + index), 'member'));
    const eligible = await captcha.activeUsers();
    assert.equal(eligible.length, 104);
    assert.ok(later.every(id => eligible.includes(id)), 'users beyond the first SQL page remain eligible');
  } finally { await f.close(); }
});
