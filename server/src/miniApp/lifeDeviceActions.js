const { createCipheriv, createDecipheriv, createHash, randomBytes } = require('node:crypto');
const { accessError } = require('../access/accessPolicy');
const { MOSCOW_TIME_ZONE, parseMoscowInput, formatMoscowDateTime } = require('../../../shared/time');

const invalid = () => { throw accessError('invalid_request'); };
const missing = () => { throw accessError('not_found'); };
const conflict = () => { throw accessError('revision_conflict'); };
const iso = (value) => value ? new Date(value).toISOString() : null;
const stableRevision = (id, name) => createHash('sha256').update(`${id}\0${name}`).digest('hex');

function pairCipher(code, token) {
  const iv = randomBytes(12);
  const key = createHash('sha256').update('jarvis-mini-pairing-code:').update(token).digest();
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(code, 'utf8'), cipher.final()]);
  return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}

function openPairCipher(value, token) {
  try {
    const decipher = createDecipheriv('aes-256-gcm', createHash('sha256').update('jarvis-mini-pairing-code:').update(token).digest(), Buffer.from(value.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(value.ciphertext, 'base64')), decipher.final()]).toString('utf8');
  } catch { return null; }
}

function inputObject(command, keys) {
  if (!command || typeof command !== 'object' || !command.input || typeof command.input !== 'object' || Array.isArray(command.input)) invalid();
  if (Object.keys(command.input).some((key) => !keys.includes(key))) invalid();
  return command.input;
}

function requiredTarget(command) {
  if (!command.targetId) invalid();
}

function noTarget(command) {
  if (command.targetId !== null || command.revision !== null) invalid();
}

function exactRevision(actual, expected) {
  if (actual !== expected) conflict();
}

function reminderDto(row) {
  return { id: row.id, title: row.title, type: 'reminder', status: row.state, dueAt: iso(row.trigger_at), revision: row.revision };
}
function commitmentDto(row) {
  return { id: row.id, title: row.title, type: 'commitment', status: row.status, dueAt: iso(row.due_at), revision: row.revision };
}
function projectDto(row) {
  return { id: row.id, title: row.name, type: 'project', status: row.status,
    revision: row.priority_revision ?? null, pinned: row.pinned === true, hiddenUntil: iso(row.hidden_until) };
}

function createLifeDeviceActions({ deviceService, reminderService, reminderRepository, commitmentRepository, commitmentLifecycleService, missionControlService }) {
  const hasDevices = Boolean(deviceService && deviceService.repository);
  const hasLife = Boolean(reminderService && reminderRepository && commitmentRepository && commitmentLifecycleService && missionControlService);

  const devices = {
    kinds: ['pair', 'pair.cancel', 'revoke'],
    validate(command) {
      if (command.kind === 'pair') {
        noTarget(command);
        const input = inputObject(command, ['name']);
        if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 100) invalid();
      } else if (command.kind === 'pair.cancel' || command.kind === 'revoke') {
        requiredTarget(command);
        if (Object.keys(inputObject(command, [])).length) invalid();
        if (command.kind === 'pair.cancel' && command.revision !== null) invalid();
        if (command.kind === 'revoke' && (typeof command.revision !== 'string' || !/^[a-f0-9]{64}$/.test(command.revision))) invalid();
      } else invalid();
    },
    async describe({ db, actor }) {
      const devices = await deviceService.list({ userId: actor.userId, db });
      const pairings = await db.query(`
          SELECT id, device_name, expires_at FROM device_pairing_codes
          WHERE user_id=$1 AND consumed_at IS NULL AND expires_at>now()
          ORDER BY created_at DESC LIMIT 20
        `, [actor.userId]);
      return {
        devices: devices.filter((row) => row.status !== 'revoked').map((row) => ({
          id: row.id, title: row.name, name: row.name, status: row.status, revision: stableRevision(row.id, row.name),
        })),
        pairings: pairings.rows.map((row) => ({ id: row.id, title: row.device_name, expiresAt: iso(row.expires_at) })),
      };
    },
    async target({ db, actor, targetId, kind }) {
      if (kind === 'pair') return null;
      if (kind === 'pair.cancel') {
        const row = await deviceService.repository.getPairingCodeForUser({ userId: actor.userId, pairingId: targetId, db });
        if (!row || row.consumed_at || new Date(row.expires_at) <= new Date()) missing();
        return { id: row.id, title: row.device_name, type: 'pairing', status: 'pending', expiresAt: iso(row.expires_at), revision: null };
      }
      const row = await deviceService.repository.getForUser({ userId: actor.userId, deviceId: targetId, db });
      if (!row || row.status === 'revoked') missing();
      return { id: row.id, title: row.name, type: 'device', status: row.status, revision: stableRevision(row.id, row.name) };
    },
    async execute({ db, actor, session, command }) {
      devices.validate(command);
      if (command.kind === 'pair') {
        const paired = await deviceService.beginPairing({ userId: actor.userId, deviceName: command.input.name, db });
        return { result: { pairingId: paired.pairingId, expiresAt: iso(paired.expiresAt), codeCipher: pairCipher(paired.code, session.token) } };
      }
      const target = await devices.target({ db, actor, targetId: command.targetId, kind: command.kind });
      exactRevision(target.revision, command.revision);
      if (command.kind === 'pair.cancel') {
        const cancelled = await deviceService.cancelPairing({ userId: actor.userId, pairingId: command.targetId, db });
        if (!cancelled) conflict();
        return { result: { pairingId: cancelled.id, status: 'cancelled' } };
      }
      const revoked = await deviceService.revoke({ userId: actor.userId, deviceId: command.targetId, db });
      if (!revoked) conflict();
      return { result: { id: revoked.id, title: revoked.name, type: 'device', status: 'revoked' } };
    },
    async publicResult(stored, { session, actor, db }) {
      if (!stored?.codeCipher) return stored;
      const pairing = db && actor ? await deviceService.repository.getPairingCodeForUser({
        userId: actor.userId, pairingId: stored.pairingId, db,
      }) : null;
      const available = pairing && !pairing.consumed_at && new Date(pairing.expires_at) > new Date();
      const code = available && session?.token ? openPairCipher(stored.codeCipher, session.token) : null;
      return { pairingId: stored.pairingId, expiresAt: stored.expiresAt, code, codeAvailable: Boolean(code) };
    },
  };

  const life = {
    kinds: ['reminder.create', 'reminder.reschedule', 'reminder.cancel', 'commitment.complete', 'commitment.dismiss', 'project.pin', 'project.hide', 'project.restore'],
    validate(command) {
      if (command.kind === 'reminder.create') {
        noTarget(command);
        const input = inputObject(command, ['title', 'triggerAt']);
        if (typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 300) invalid();
        if (!input.triggerAt) invalid();
        try { parseMoscowInput(input.triggerAt); } catch { invalid(); }
      } else if (command.kind === 'reminder.reschedule') {
        requiredTarget(command);
        if (!Number.isInteger(command.revision) || command.revision < 1) invalid();
        const input = inputObject(command, ['triggerAt']);
        if (!input.triggerAt) invalid();
        try { parseMoscowInput(input.triggerAt); } catch { invalid(); }
      } else if (command.kind === 'project.hide') {
        requiredTarget(command);
        if (command.revision !== null && (!Number.isInteger(command.revision) || command.revision < 1)) invalid();
        const input = inputObject(command, ['hiddenUntil']);
        if (input.hiddenUntil !== undefined) {
          try { if (new Date(parseMoscowInput(input.hiddenUntil)) <= new Date()) invalid(); } catch { invalid(); }
        }
      } else if (['reminder.cancel', 'commitment.complete', 'commitment.dismiss', 'project.pin', 'project.restore'].includes(command.kind)) {
        requiredTarget(command);
        inputObject(command, []);
        if (command.kind.startsWith('project.')) {
          if (command.revision !== null && (!Number.isInteger(command.revision) || command.revision < 1)) invalid();
        } else if (!Number.isInteger(command.revision) || command.revision < 1) invalid();
      } else invalid();
    },
    async describe({ db, actor }) {
      const reminders = await reminderRepository.list({ userId: actor.userId, states: ['scheduled', 'failed', 'outcome_unknown'], limit: 30, db });
      const commitments = await commitmentRepository.listRecent({ userId: actor.userId, limit: 30, db });
      const projects = await db.query(`SELECT p.id,p.name,p.status,s.revision AS priority_revision,s.pinned,s.hidden_until
          FROM life_projects p LEFT JOIN life_project_priority_state s ON s.project_id=p.id AND s.user_id=p.user_id
          WHERE p.user_id=$1 AND p.status='active' ORDER BY p.updated_at DESC,p.id LIMIT 30`, [actor.userId]);
      const conversation = await db.query(`SELECT c.id FROM conversations c JOIN user_identities i ON i.user_id=c.user_id
          AND i.provider='telegram' AND i.external_id=c.external_chat_id
          WHERE c.user_id=$1 AND c.channel='telegram' AND c.external_chat_id=$2 LIMIT 1`, [actor.userId, String(actor.telegramId)]);
      return { reminders: reminders.map(reminderDto), commitments: commitments.map(commitmentDto), projects: projects.rows.map(projectDto),
        canCreateReminder: conversation.rowCount > 0, reminderCreateHint: conversation.rowCount ? null : 'Откройте личный чат с ботом Jarvis' };
    },
    async target({ db, actor, targetId, kind }) {
      if (kind === 'reminder.create') return null;
      if (kind.startsWith('reminder.')) {
        const row = await reminderRepository.get({ userId: actor.userId, reminderId: targetId, db });
        if (!row || !['scheduled', 'failed', 'outcome_unknown'].includes(row.state)) missing();
        return reminderDto(row);
      }
      if (kind.startsWith('commitment.')) {
        const row = await commitmentRepository.get({ userId: actor.userId, commitmentId: targetId, db });
        if (!row || row.status !== 'open') missing();
        return commitmentDto(row);
      }
      const row = (await db.query(`SELECT p.id,p.name,p.status,s.revision AS priority_revision,s.pinned,s.hidden_until
        FROM life_projects p LEFT JOIN life_project_priority_state s ON s.project_id=p.id AND s.user_id=p.user_id
        WHERE p.id=$1 AND p.user_id=$2 AND p.status='active'`, [targetId, actor.userId])).rows[0];
      if (!row) missing();
      return projectDto(row);
    },
    async execute({ db, actor, command }) {
      life.validate(command);
      const userId = actor.userId;
      let row, eventType;
      if (command.kind === 'reminder.create') {
        const conversation = (await db.query(`SELECT c.id FROM conversations c JOIN user_identities i ON i.user_id=c.user_id
          AND i.provider='telegram' AND i.external_id=c.external_chat_id
          WHERE c.user_id=$1 AND c.channel='telegram' AND c.external_chat_id=$2 LIMIT 1`,
        [userId, String(actor.telegramId)])).rows[0];
        if (!conversation) missing();
        row = await reminderService.create({ userId, origin: { channel: 'life_os', conversationId: conversation.id },
          input: { requestId: command.operationId, title: command.input.title.trim(), triggerAt: parseMoscowInput(command.input.triggerAt),
            timezone: MOSCOW_TIME_ZONE, deliveryChannels: ['telegram'] }, db });
        if (!row) missing();
        eventType = 'reminder.created';
        return { result: reminderDto(row) };
      }
      const target = await life.target({ db, actor, targetId: command.targetId, kind: command.kind });
      exactRevision(target.revision, command.revision);
      if (command.kind === 'reminder.reschedule') {
        row = await reminderService.reschedule({ userId, reminderId: command.targetId, revision: command.revision,
          triggerAt: parseMoscowInput(command.input.triggerAt), timezone: MOSCOW_TIME_ZONE, db });
        eventType = 'reminder.rescheduled';
      } else if (command.kind === 'reminder.cancel') {
        row = await reminderService.cancel({ userId, reminderId: command.targetId, revision: command.revision, db });
        eventType = 'reminder.cancelled';
      } else if (command.kind.startsWith('commitment.')) {
        row = await commitmentLifecycleService.transitionFromUserAction({ userId, commitmentId: command.targetId, revision: command.revision,
          status: command.kind === 'commitment.complete' ? 'completed' : 'dismissed', db });
      } else {
        const intent = { userId, projectId: command.targetId, revision: command.revision, db };
        if (command.kind === 'project.pin') row = await missionControlService.pin(intent);
        else if (command.kind === 'project.hide') row = await missionControlService.hide({ ...intent,
          hiddenUntil: command.input.hiddenUntil ? parseMoscowInput(command.input.hiddenUntil) : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() });
        else row = await missionControlService.restore(intent);
      }
      if (!row) conflict();
      if (eventType) return { result: reminderDto(row) };
      if (command.kind.startsWith('commitment.')) {
        await commitmentLifecycleService.recordUserTransition(userId, row, db);
        return { result: commitmentDto(row) };
      }
      return { result: { ...target, revision: row.revision, pinned: row.pinned, hiddenUntil: iso(row.hidden_until),
        preview: command.kind === 'project.hide' ? formatMoscowDateTime(row.hidden_until) : null } };
    },
  };
  return { devices: hasDevices ? devices : null, life: hasLife ? life : null };
}

module.exports = { createLifeDeviceActions };
