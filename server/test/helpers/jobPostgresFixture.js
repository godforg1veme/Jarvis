const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');

async function createJobPostgresFixture() {
  const url = process.env.JARVIS_JOB_TEST_DATABASE_URL;
  if (!url) throw new Error('JARVIS_JOB_TEST_DATABASE_URL is required');
  const schema = `job_test_${crypto.randomBytes(10).toString('hex')}`;
  const admin = new Pool({ connectionString: url, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: url, options: `-c search_path=${schema}`, max: 8 });
  try {
    // This domain acceptance applies the actual identity and job migrations.
    // pgvector is unrelated to jobs and isn't required for this isolated schema.
    for (const name of ['001_identity_and_conversations.sql', '015_telegram_interactions.sql',
      '024_telegram_update_outcomes.sql', '025_telegram_update_kind.sql',
      '028_telegram_subscription_interaction_kinds.sql', '029_job_search.sql', '030_job_search_interactions.sql', '031_job_captcha_attention.sql', '032_job_telegram_captcha.sql', '033_job_captcha_resilience.sql', '034_job_letter_modes.sql']) {
      const sql = await fs.readFile(path.join(__dirname, '../../src/db/migrations', name), 'utf8');
      await pool.query(sql.replace(/^CREATE EXTENSION[^;]+;\s*/gm, ''));
    }
    const owner = (await pool.query("INSERT INTO users(display_name,role) VALUES('Fixture owner','owner') RETURNING id")).rows[0].id;
    const stranger = (await pool.query("INSERT INTO users(display_name,role) VALUES('Fixture member','member') RETURNING id")).rows[0].id;
    const conversation = (await pool.query("INSERT INTO conversations(user_id,channel,external_chat_id) VALUES($1,'telegram','101') RETURNING id", [owner])).rows[0].id;
    return { pool, owner, stranger, scope: { userId: owner, conversationId: conversation, chatId: '101', channel: 'telegram' },
      async close() { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); } };
  } catch (error) {
    await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); throw error;
  }
}
module.exports = { createJobPostgresFixture };
