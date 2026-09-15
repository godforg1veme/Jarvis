const crypto = require('node:crypto');

class OperationsRepository {
  constructor(pool) { this.pool = pool; }

  async ensureHost({ hostKey, label }) {
    const result = await this.pool.query(`
      INSERT INTO ops_hosts (host_key, label, status, last_contact_at)
      VALUES ($1, $2, 'unknown', now())
      ON CONFLICT (host_key) DO UPDATE SET label = EXCLUDED.label, updated_at = now()
      RETURNING id, host_key, label, status, last_contact_at
    `, [hostKey, label]);
    return result.rows[0];
  }

  async recordHostSnapshot({ hostId, state = 'healthy' }) {
    const result = await this.pool.query(`
      UPDATE ops_hosts SET status = $2, last_contact_at = now(), updated_at = now()
      WHERE id = $1 RETURNING id, status, last_contact_at
    `, [hostId, state]);
    return result.rows[0] || null;
  }

  async recordMetricSamples({ hostId, serviceId = null, sampledAt, metrics }) {
    const entries = Object.entries(metrics).filter(([, value]) => Number.isFinite(value)).slice(0, 20);
    if (entries.length === 0) return;
    await this.pool.query(`
      INSERT INTO ops_metric_samples (host_id,service_id,metric_name,metric_value,sampled_at)
      SELECT $1,$2,item.name,item.value,$3
      FROM jsonb_to_recordset($4::jsonb) AS item(name text,value double precision)
      ON CONFLICT DO NOTHING
    `, [hostId, serviceId, sampledAt, JSON.stringify(entries.map(([name, value]) => ({ name, value })))]);
  }

  async upsertService({ hostId, serviceKey, displayName, serviceType, sourceState, healthState }) {
    const result = await this.pool.query(`
      INSERT INTO ops_services (host_id, service_key, display_name, service_type, source_state, health_state, last_observed_at)
      VALUES ($1, $2, $3, $4, $5, $6, now())
      ON CONFLICT (host_id, service_key) DO UPDATE SET
        display_name = EXCLUDED.display_name, source_state = EXCLUDED.source_state,
        health_state = EXCLUDED.health_state, last_observed_at = now(), updated_at = now()
      RETURNING id, service_key, display_name, service_type, source_state, health_state, last_observed_at
    `, [hostId, serviceKey, displayName, serviceType, sourceState, healthState]);
    return result.rows[0];
  }

  async overview(hostId) {
    const result = await this.pool.query(`
      SELECT h.host_key, h.label,
        CASE WHEN h.last_contact_at IS NULL OR h.last_contact_at < now()-interval '90 seconds' THEN 'no_fresh_data' ELSE h.status END AS status, h.last_contact_at,
        COALESCE(json_agg(json_build_object('key', s.service_key, 'name', s.display_name, 'state', CASE WHEN s.last_observed_at IS NULL OR s.last_observed_at < now()-interval '90 seconds' THEN 'no_fresh_data' ELSE s.health_state END, 'observedAt', s.last_observed_at)
          ORDER BY s.service_key) FILTER (WHERE s.id IS NOT NULL), '[]'::json) AS services
      FROM ops_hosts h LEFT JOIN ops_services s ON s.host_id = h.id
      WHERE h.id = $1 GROUP BY h.id
    `, [hostId]);
    return result.rows[0] || null;
  }

  async listServices(hostId) {
    const result = await this.pool.query(`
      SELECT id,service_key AS key,display_name AS name,service_type AS type,
        source_state AS "sourceState",CASE WHEN last_observed_at IS NULL OR last_observed_at < now()-interval '90 seconds' THEN 'no_fresh_data' ELSE health_state END AS state,last_observed_at AS "observedAt",
        COALESCE((SELECT json_agg(c.action ORDER BY c.action) FROM ops_service_capabilities c WHERE c.service_id=ops_services.id AND c.enabled=true),'[]'::json) AS capabilities
      FROM ops_services WHERE host_id=$1 ORDER BY display_name,id LIMIT 100
    `, [hostId]);
    return result.rows;
  }

  async serviceByKey(hostId, serviceKey) {
    const result = await this.pool.query(`
      SELECT id,service_key AS key,display_name AS name,service_type AS type,
        source_state AS "sourceState",CASE WHEN last_observed_at IS NULL OR last_observed_at < now()-interval '90 seconds' THEN 'no_fresh_data' ELSE health_state END AS state,last_observed_at AS "observedAt",
        COALESCE((SELECT json_agg(c.action ORDER BY c.action) FROM ops_service_capabilities c WHERE c.service_id=ops_services.id AND c.enabled=true),'[]'::json) AS capabilities
      FROM ops_services WHERE host_id=$1 AND service_key=$2
    `, [hostId, serviceKey]);
    return result.rows[0] || null;
  }

  async metrics({ hostId, serviceId = null, since, limit }) {
    const result = await this.pool.query(`
      SELECT metric_name AS name,metric_value AS value,sampled_at AS "sampledAt"
      FROM ops_metric_samples
      WHERE host_id=$1 AND service_id IS NOT DISTINCT FROM $2 AND sampled_at >= $3
      ORDER BY sampled_at DESC,metric_name LIMIT $4
    `, [hostId, serviceId, since, limit]);
    return result.rows.reverse();
  }

  async incidents(hostId, limit) {
    const result = await this.pool.query(`
      SELECT i.id,i.failure_kind AS kind,i.state,i.severity,i.summary,
        i.first_observed_at AS "firstObservedAt",i.last_observed_at AS "lastObservedAt",i.resolved_at AS "resolvedAt",
        s.service_key AS "serviceKey",s.display_name AS "serviceName"
      FROM ops_incidents i LEFT JOIN ops_services s ON s.id=i.service_id
      WHERE i.host_id=$1 ORDER BY (i.state='open') DESC,i.last_observed_at DESC LIMIT $2
    `, [hostId, limit]);
    return result.rows;
  }

  async events(hostId, limit) {
    const result = await this.pool.query(`
      SELECT * FROM (
        SELECT 'event:'||e.id::text AS id,e.event_type AS type,e.payload,e.created_at AS "createdAt",s.service_key AS "serviceKey"
        FROM ops_events e LEFT JOIN ops_services s ON s.id=e.service_id WHERE e.host_id=$1
        UNION ALL
        SELECT 'operation:'||o.id::text,o.operation,jsonb_build_object('status',o.status,'errorCode',o.error_code),o.updated_at,o.target_key
        FROM ops_operation_runs o WHERE o.host_id=$1
        UNION ALL
        SELECT 'audit:'||a.id::text,a.event_type,
          jsonb_strip_nulls(jsonb_build_object('identityId',a.metadata->'identityId','fromUserId',a.metadata->'fromUserId',
          'toUserId',a.metadata->'toUserId','oldDeviceId',a.metadata->'oldDeviceId','reassignmentId',a.metadata->'reassignmentId')),
          a.created_at,NULL::text
        FROM ops_admin_audit a LEFT JOIN ops_operation_runs o ON o.id=a.operation_run_id
        WHERE a.operation_run_id IS NULL OR o.host_id=$1
      ) combined ORDER BY "createdAt" DESC,id DESC LIMIT $2
    `, [hostId, limit]);
    return result.rows;
  }

  async backups(hostId, limit) {
    const result = await this.pool.query(`
      SELECT id,source,status,started_at AS "startedAt",completed_at AS "completedAt",byte_size AS "byteSize",error_code AS "errorCode",detail
      FROM ops_backup_runs WHERE host_id=$1 ORDER BY started_at DESC LIMIT $2
    `, [hostId, limit]);
    return result.rows;
  }

  async healthChecks(hostId) {
    const result = await this.pool.query(`SELECT check_key AS key,summary,checked_at AS "checkedAt",
      CASE WHEN checked_at < now() - CASE WHEN check_key='provider' THEN interval '7 hours' ELSE interval '90 seconds' END
        THEN 'no_fresh_data' ELSE state END AS state
      FROM ops_health_checks WHERE host_id=$1 ORDER BY check_key LIMIT 20`, [hostId]);
    return result.rows;
  }

  async recordLogEntries({ hostId, serviceId, source, entries }) {
    if (!entries.length) return;
    await this.pool.query(`INSERT INTO ops_log_entries(host_id,service_id,source,observed_at,priority,message,byte_size,fingerprint)
      SELECT $1,$2,$3,item."observedAt",item.priority,item.message,item."byteSize",decode(item.fingerprint,'hex')
      FROM jsonb_to_recordset($4::jsonb) AS item("observedAt" timestamptz,priority int,message text,"byteSize" int,fingerprint text)
      ON CONFLICT DO NOTHING`, [hostId, serviceId, source, JSON.stringify(entries.slice(0, 100))]);
  }

  async logs(hostId, serviceId, limit) {
    const result = await this.pool.query(`SELECT observed_at AS "observedAt",message FROM ops_log_entries
      WHERE host_id=$1 AND service_id=$2 ORDER BY observed_at DESC,id DESC LIMIT $3`, [hostId, serviceId, limit]);
    return result.rows.reverse();
  }

  async recordBackupResult({ hostId, runId, status, startedAt, completedAt }) {
    // Stable per-host run identity makes every polling iteration idempotent.
    const id = crypto.createHash('sha256').update(`${hostId}:${runId}`).digest('hex').slice(0, 32);
    await this.pool.query(`
      INSERT INTO ops_backup_runs (id,host_id,source,status,started_at,completed_at,error_code)
      VALUES ($1,$2,'scheduled',$3,$4,$5,$6)
      ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status,completed_at=EXCLUDED.completed_at,error_code=EXCLUDED.error_code
    `, [id, hostId, status, startedAt, completedAt, status === 'failed' ? 'BACKUP_FAILED' : null]);
  }

  async parserResults(hostId, limit) {
    const result = await this.pool.query(`
      SELECT id,observed_at AS "observedAt",result_kind AS kind,summary
      FROM ops_parser_results WHERE host_id=$1 ORDER BY observed_at DESC LIMIT $2
    `, [hostId, limit]);
    return result.rows;
  }

  async recordParserResult({ hostId, kind, summary, observedAt, fingerprint }) {
    const result = await this.pool.query(`
      INSERT INTO ops_parser_results (host_id,observed_at,result_kind,summary,fingerprint)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (host_id,result_kind,fingerprint) DO UPDATE SET observed_at=EXCLUDED.observed_at,summary=EXCLUDED.summary
      RETURNING id,observed_at,result_kind,summary
    `, [hostId, observedAt, kind, summary, fingerprint]);
    return result.rows[0];
  }

  async recordEvent({ hostId, serviceId = null, type, payload }) {
    const result = await this.pool.query(`
      INSERT INTO ops_events (host_id,service_id,event_type,payload)
      VALUES ($1,$2,$3,$4::jsonb) RETURNING id,event_type,created_at
    `, [hostId, serviceId, type, JSON.stringify(payload || {})]);
    return result.rows[0];
  }

  async rollupMetrics() {
    const result = await this.pool.query(`
      INSERT INTO ops_metric_rollups (host_id,service_id,metric_name,bucket_at,minimum,maximum,average,sample_count)
      SELECT host_id,service_id,metric_name,date_trunc('hour',sampled_at)+floor(date_part('minute',sampled_at)/5)*interval '5 minutes',
        min(metric_value),max(metric_value),avg(metric_value),count(*)::int
      FROM ops_metric_samples
      WHERE sampled_at >= now()-interval '24 hours' AND sampled_at < date_trunc('minute',now())
      GROUP BY host_id,service_id,metric_name,4
      ON CONFLICT (host_id,(COALESCE(service_id,'00000000-0000-0000-0000-000000000000'::uuid)),metric_name,bucket_at)
      DO UPDATE SET minimum=EXCLUDED.minimum,maximum=EXCLUDED.maximum,average=EXCLUDED.average,sample_count=EXCLUDED.sample_count
    `);
    return result.rowCount;
  }

  async applyRetention() {
    const statements = [
      `DELETE FROM ops_metric_samples WHERE id IN (SELECT id FROM ops_metric_samples WHERE sampled_at < now()-interval '24 hours' ORDER BY id LIMIT 5000)`,
      `DELETE FROM ops_metric_rollups WHERE id IN (SELECT id FROM ops_metric_rollups WHERE bucket_at < now()-interval '60 days' ORDER BY id LIMIT 5000)`,
      `DELETE FROM ops_incidents WHERE id IN (SELECT id FROM ops_incidents WHERE state='resolved' AND resolved_at < now()-interval '60 days' ORDER BY resolved_at LIMIT 1000)`,
      `DELETE FROM ops_operation_runs WHERE id IN (SELECT id FROM ops_operation_runs WHERE completed_at < now()-interval '60 days' ORDER BY completed_at LIMIT 1000)`,
      `DELETE FROM ops_admin_audit WHERE id IN (SELECT id FROM ops_admin_audit WHERE created_at < now()-interval '60 days' ORDER BY id LIMIT 2000)`,
      `DELETE FROM ops_events WHERE id IN (SELECT id FROM ops_events WHERE created_at < now()-interval '60 days' ORDER BY id LIMIT 2000)`,
      `DELETE FROM ops_parser_results WHERE id IN (SELECT id FROM ops_parser_results WHERE observed_at < now()-interval '15 days' ORDER BY id LIMIT 1000)`,
      `DELETE FROM ops_log_entries WHERE id IN (SELECT id FROM ops_log_entries WHERE observed_at < now()-interval '60 days' ORDER BY id LIMIT 5000)`,
      `DELETE FROM ops_log_entries WHERE id IN (SELECT id FROM (SELECT id,sum(byte_size) OVER (PARTITION BY service_id ORDER BY observed_at DESC,id DESC) AS bytes FROM ops_log_entries) quota WHERE bytes>268435456 ORDER BY id LIMIT 5000)`,
      `DELETE FROM ops_log_entries WHERE id IN (SELECT id FROM (SELECT id,sum(byte_size) OVER (ORDER BY observed_at DESC,id DESC) AS bytes FROM ops_log_entries) quota WHERE bytes>10737418240 ORDER BY id LIMIT 5000)`,
    ];
    const counts = [];
    for (const sql of statements) counts.push((await this.pool.query(sql)).rowCount);
    return counts;
  }

  async openOrUpdateIncident({ hostId, serviceId, failureKind, severity, summary, technicalDetail }) {
    const result = await this.pool.query(`
      WITH inserted AS (
        INSERT INTO ops_incidents (host_id,service_id,failure_kind,severity,summary,technical_detail)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT DO NOTHING
        RETURNING *,true AS opened
      ), updated AS (
        UPDATE ops_incidents SET severity=$4,summary=$5,technical_detail=$6,last_observed_at=now()
        WHERE host_id=$1 AND service_id IS NOT DISTINCT FROM $2 AND failure_kind=$3 AND state='open' AND NOT EXISTS (SELECT 1 FROM inserted)
        RETURNING *,false AS opened
      ) SELECT * FROM inserted UNION ALL SELECT * FROM updated
    `, [hostId, serviceId, failureKind, severity, summary, technicalDetail]);
    return result.rows[0] || null;
  }

  async resolveServiceIncidents({ hostId, serviceId, failureKind = null }) {
    const result = await this.pool.query(`
      UPDATE ops_incidents SET state='resolved',resolved_at=now(),last_observed_at=now()
      WHERE host_id=$1 AND service_id IS NOT DISTINCT FROM $2 AND state='open'
        AND ($3::text IS NULL OR failure_kind=$3) RETURNING id
    `, [hostId, serviceId, failureKind]);
    return result.rows;
  }

  async resolveClassifiedVpnIncidents({ hostId, exceptFailureKind = null }) {
    const result = await this.pool.query(`
      UPDATE ops_incidents SET state='resolved',resolved_at=now(),last_observed_at=now()
      WHERE host_id=$1 AND state='open' AND failure_kind LIKE 'vpn.%'
        AND ($2::text IS NULL OR failure_kind<>$2) RETURNING id
    `, [hostId, exceptFailureKind]);
    return result.rows;
  }

  async claimIncidentNotification(id) {
    const result = await this.pool.query(`
      UPDATE ops_incidents SET notification_attempts=notification_attempts+1,
        notification_retry_at=now()+LEAST(1800,30*power(2,LEAST(notification_attempts,6))) * interval '1 second'
      WHERE id=$1 AND state='open' AND notified_at IS NULL
        AND (notification_retry_at IS NULL OR notification_retry_at<=now())
      RETURNING id
    `, [id]);
    return result.rows.length === 1;
  }

  async markIncidentNotified(id) {
    await this.pool.query('UPDATE ops_incidents SET notified_at=now() WHERE id=$1', [id]);
  }
}

module.exports = { OperationsRepository };
