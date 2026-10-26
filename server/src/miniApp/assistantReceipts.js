const MAX_PROCESSING_AGE_SQL = "created_at <= clock_timestamp() - interval '5 minutes'";

function responseForReceipt(row) {
  if (!row || row.status === 'processing') return null;
  if (row.status === 'failed') return { ok: true, status: 'failed', failureCode: row.failure_code };
  return { ok: true, status: 'completed', answer: row.answer };
}

async function readReceipt(pool, userId, requestId) {
  await pool.query(`UPDATE mini_app_requests SET status='failed',failure_code='request_expired'
    WHERE user_id=$1 AND request_id=$2 AND status='processing' AND ${MAX_PROCESSING_AGE_SQL}`,
  [userId, requestId]);
  const result = await pool.query(`SELECT request_hash,status,answer,failure_code FROM mini_app_requests
    WHERE user_id=$1 AND request_id=$2`, [userId, requestId]);
  return result.rows[0] || null;
}

async function failReceipt(pool, userId, requestId) {
  await pool.query(`UPDATE mini_app_requests SET status='failed',
    failure_code=CASE WHEN ${MAX_PROCESSING_AGE_SQL} THEN 'request_expired' ELSE 'request_failed' END
    WHERE user_id=$1 AND request_id=$2 AND status='processing'`, [userId, requestId]);
}

async function completeReceipt(pool, { userId, requestId, conversationId, answer }) {
  const client = await pool.connect();
  let begun = false;
  try {
    await client.query('BEGIN'); begun = true;
    const receipt = (await client.query(`SELECT status, ${MAX_PROCESSING_AGE_SQL} AS expired
      FROM mini_app_requests WHERE user_id=$1 AND request_id=$2 FOR UPDATE`, [userId, requestId])).rows[0];
    if (!receipt || receipt.status !== 'processing') {
      await client.query('COMMIT'); begun = false;
      return false;
    }
    if (receipt.expired) {
      await client.query(`UPDATE mini_app_requests SET status='failed',failure_code='request_expired'
        WHERE user_id=$1 AND request_id=$2`, [userId, requestId]);
      await client.query('COMMIT'); begun = false;
      return false;
    }
    const message = await client.query(`INSERT INTO messages
      (user_id,conversation_id,role,content_type,content,external_message_id)
      SELECT $1,c.id,'assistant','text',$3,$4 FROM conversations c
      WHERE c.id=$2 AND c.user_id=$1 RETURNING id`,
    [userId, conversationId, answer, `mini:${requestId}:answer`]);
    if (message.rowCount !== 1) throw new Error('conversation is unavailable');
    await client.query(`UPDATE mini_app_requests SET status='completed',answer=$3
      WHERE user_id=$1 AND request_id=$2`, [userId, requestId, answer]);
    await client.query('COMMIT'); begun = false;
    return true;
  } catch (error) {
    if (begun) await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { responseForReceipt, readReceipt, failReceipt, completeReceipt };
