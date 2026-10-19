async function jobTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('jarvis-access-admin'))");
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
module.exports = { jobTransaction };
