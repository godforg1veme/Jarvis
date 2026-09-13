class CommandRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async create({ id, userId, deviceId, conversationId, originChannel, originDeviceId = null, action, args, policy, status, prompt, expiresAt, workflowId = null, actionRunId = null }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const command = await client.query(`
        INSERT INTO commands (id, user_id, device_id, conversation_id, origin_channel, origin_device_id, action, arguments, policy, status, expires_at, workflow_id, action_run_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13)
        RETURNING *
      `, [id, userId, deviceId, conversationId || null, originChannel, originDeviceId, action, JSON.stringify(args), policy, status, expiresAt || null, workflowId, actionRunId]);
      await client.query(`
        INSERT INTO command_steps (command_id, position, action, arguments, status)
        VALUES ($1, 0, $2, $3::jsonb, $4)
      `, [id, action, JSON.stringify(args), status === 'queued' ? 'pending' : 'pending']);
      let confirmation = null;
      if (status === 'awaiting_confirmation') {
        const result = await client.query(`
          INSERT INTO confirmations (user_id, command_id, origin_channel, prompt, expires_at)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING *
        `, [userId, id, originChannel, prompt, expiresAt]);
        confirmation = result.rows[0];
      }
      await client.query(`
        INSERT INTO audit_events (user_id, device_id, command_id, event_type, metadata)
        VALUES ($1, $2, $3, 'command.created', $4::jsonb)
      `, [userId, deviceId, id, JSON.stringify({ action, policy, originChannel })]);
      await client.query('COMMIT');
      return { command: command.rows[0], confirmation };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getForUser({ userId, commandId }) {
    const result = await this.pool.query(`
      SELECT * FROM commands WHERE id = $1 AND user_id = $2
    `, [commandId, userId]);
    return result.rows[0] || null;
  }

  async getForDevice({ userId, deviceId, commandId }) {
    const result = await this.pool.query(`
      SELECT * FROM commands WHERE id = $1 AND user_id = $2 AND device_id = $3
    `, [commandId, userId, deviceId]);
    return result.rows[0] || null;
  }

  async approve({ userId, commandId, originChannel, originDeviceId = null }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      let targetCommandId = commandId;
      if (!targetCommandId) {
        const latest = await client.query(`
          SELECT c.command_id
          FROM confirmations c
          JOIN commands cmd ON cmd.id = c.command_id AND cmd.user_id = c.user_id
          WHERE c.user_id = $1 AND c.origin_channel = $2
            AND c.decision = 'pending' AND c.expires_at > now()
            AND ($3::uuid IS NULL OR cmd.origin_device_id = $3::uuid)
          ORDER BY c.created_at DESC
          LIMIT 1
        `, [userId, originChannel, originDeviceId]);
        if (latest.rowCount !== 1) {
          await client.query('ROLLBACK');
          return null;
        }
        targetCommandId = latest.rows[0].command_id;
      }
      const confirmation = await client.query(`
        SELECT c.*, cmd.origin_device_id
        FROM confirmations c
        JOIN commands cmd ON cmd.id = c.command_id AND cmd.user_id = c.user_id
        WHERE c.command_id = $1 AND c.user_id = $2 AND c.origin_channel = $3
          AND c.decision = 'pending' AND c.expires_at > now()
          AND ($4::uuid IS NULL OR cmd.origin_device_id = $4::uuid)
        FOR UPDATE
      `, [targetCommandId, userId, originChannel, originDeviceId]);
      if (confirmation.rowCount !== 1) {
        await client.query('ROLLBACK');
        return null;
      }
      await client.query(`
        UPDATE confirmations SET decision = 'approved', decided_at = now()
        WHERE command_id = $1 AND user_id = $2
      `, [targetCommandId, userId]);
      const updated = await client.query(`
        UPDATE commands SET status = 'queued', updated_at = now()
        WHERE id = $1 AND user_id = $2 AND status = 'awaiting_confirmation'
        RETURNING *
      `, [targetCommandId, userId]);
      if (updated.rowCount !== 1) {
        await client.query('ROLLBACK');
        return null;
      }
      await client.query(`
        INSERT INTO audit_events (user_id, device_id, command_id, event_type, metadata)
        VALUES ($1, $2, $3, 'command.approved', $4::jsonb)
      `, [userId, updated.rows[0]?.device_id || null, targetCommandId, JSON.stringify({ originChannel })]);
      await client.query('COMMIT');
      return updated.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async reject({ userId, commandId, originChannel, originDeviceId = null }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      let targetCommandId = commandId;
      if (!targetCommandId) {
        const latest = await client.query(`
          SELECT c.command_id
          FROM confirmations c
          JOIN commands cmd ON cmd.id = c.command_id AND cmd.user_id = c.user_id
          WHERE c.user_id = $1 AND c.origin_channel = $2
            AND c.decision = 'pending' AND c.expires_at > now()
            AND ($3::uuid IS NULL OR cmd.origin_device_id = $3::uuid)
          ORDER BY c.created_at DESC
          LIMIT 1
        `, [userId, originChannel, originDeviceId]);
        if (latest.rowCount !== 1) {
          await client.query('ROLLBACK');
          return null;
        }
        targetCommandId = latest.rows[0].command_id;
      }
      const result = await client.query(`
        UPDATE confirmations c
        SET decision = 'rejected', decided_at = now()
        FROM commands cmd
        WHERE c.command_id = $1 AND c.user_id = $2 AND c.origin_channel = $3
          AND c.decision = 'pending' AND c.expires_at > now()
          AND cmd.id = c.command_id AND cmd.status = 'awaiting_confirmation'
          AND ($4::uuid IS NULL OR cmd.origin_device_id = $4::uuid)
        RETURNING c.command_id
      `, [targetCommandId, userId, originChannel, originDeviceId]);
      if (result.rowCount !== 1) {
        await client.query('ROLLBACK');
        return null;
      }
      const command = await client.query(`
        UPDATE commands SET status = 'cancelled', completed_at = now(), updated_at = now()
        WHERE id = $1 AND user_id = $2 AND status = 'awaiting_confirmation'
        RETURNING *
      `, [targetCommandId, userId]);
      if (command.rowCount !== 1) {
        await client.query('ROLLBACK');
        return null;
      }
      await client.query('COMMIT');
      return command.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async markRunning({ userId, commandId }) {
    const result = await this.pool.query(`
      UPDATE commands SET status = 'running', delivered_at = now(), started_at = now(), updated_at = now()
      WHERE id = $1 AND user_id = $2 AND status = 'queued'
      RETURNING *
    `, [commandId, userId]);
    return result.rows[0] || null;
  }

  async complete({ userId, deviceId, commandId, result, ok, errorCode = null }) {
    const status = ok ? 'succeeded' : 'failed';
    const updated = await this.pool.query(`
      UPDATE commands SET status = $4, result = $5::jsonb, error_code = $6, completed_at = now(), updated_at = now()
      WHERE id = $1 AND user_id = $2 AND device_id = $3 AND status IN ('queued', 'running')
      RETURNING *
    `, [commandId, userId, deviceId, status, JSON.stringify(result), errorCode]);
    return updated.rows[0] || null;
  }

  async cancel({ userId, commandId, originChannel, originDeviceId = null }) {
    const result = await this.pool.query(`
      UPDATE commands cmd
      SET status = 'cancelled', completed_at = now(), updated_at = now()
      WHERE cmd.id = $1 AND cmd.user_id = $2 AND cmd.origin_channel = $3
        AND cmd.status IN ('pending', 'awaiting_confirmation', 'queued')
        AND ($4::uuid IS NULL OR cmd.origin_device_id = $4::uuid)
      RETURNING cmd.*
    `, [commandId, userId, originChannel, originDeviceId]);
    return result.rows[0] || null;
  }

  async fail({ userId, commandId, errorCode, result = {} }) {
    const updated = await this.pool.query(`
      UPDATE commands SET status = 'failed', error_code = $3, result = $4::jsonb, completed_at = now(), updated_at = now()
      WHERE id = $1 AND user_id = $2 AND status IN ('pending', 'queued', 'running')
      RETURNING *
    `, [commandId, userId, errorCode, JSON.stringify(result)]);
    return updated.rows[0] || null;
  }

  async expirePending() {
    const result = await this.pool.query(`
      WITH expired AS (
        UPDATE confirmations SET decision = 'expired', decided_at = now()
        WHERE decision = 'pending' AND expires_at <= now()
        RETURNING command_id, user_id
      )
      UPDATE commands cmd SET status = 'expired', completed_at = now(), updated_at = now()
      FROM expired WHERE cmd.id = expired.command_id AND cmd.user_id = expired.user_id
      RETURNING cmd.id
    `);
    return result.rowCount;
  }

  async expireStale() {
    const confirmations = await this.pool.query(`
      WITH expired AS (
        UPDATE confirmations SET decision = 'expired', decided_at = now()
        WHERE decision = 'pending' AND expires_at <= now()
        RETURNING command_id, user_id
      ), changed AS (
        UPDATE commands cmd SET status = 'expired', completed_at = now(), updated_at = now()
        FROM expired
        WHERE cmd.id = expired.command_id AND cmd.user_id = expired.user_id
          AND cmd.status = 'awaiting_confirmation'
        RETURNING cmd.id, cmd.user_id, cmd.device_id
      )
      INSERT INTO audit_events (user_id, device_id, command_id, event_type, metadata)
      SELECT user_id, device_id, id, 'command.expired', '{"reason":"confirmation_timeout"}'::jsonb
      FROM changed
      RETURNING command_id
    `);
    const executions = await this.pool.query(`
      WITH changed AS (
        UPDATE commands
        SET status = 'failed', error_code = 'COMMAND_EXPIRED',
            result = '{"ok":false,"error":"Command expired."}'::jsonb,
            completed_at = now(), updated_at = now()
        WHERE status IN ('queued', 'running') AND expires_at IS NOT NULL AND expires_at <= now()
        RETURNING id, user_id, device_id
      )
      INSERT INTO audit_events (user_id, device_id, command_id, event_type, metadata)
      SELECT user_id, device_id, id, 'command.expired', '{"reason":"execution_timeout"}'::jsonb
      FROM changed
      RETURNING command_id
    `);
    return confirmations.rowCount + executions.rowCount;
  }

  async audit({ userId, deviceId, commandId, eventType, metadata = {} }) {
    await this.pool.query(`
      INSERT INTO audit_events (user_id, device_id, command_id, event_type, metadata)
      VALUES ($1, $2, $3, $4, $5::jsonb)
    `, [userId, deviceId || null, commandId || null, eventType, JSON.stringify(metadata)]);
  }
}

module.exports = { CommandRepository };
