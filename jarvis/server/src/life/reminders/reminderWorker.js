const { createHash } = require('node:crypto');
const { nextOccurrence } = require('./nextOccurrence');
const { occurrenceKey } = require('./reminderRepository');
const { zonedDate, zonedParts } = require('../commitments/temporalParser');

function deliveryKey(reminder, channel) {
  return `delivery:${createHash('sha256').update(`${reminder.user_id}\0${reminder.occurrence_key}\0${channel}`).digest('hex')}`;
}

function quietEnd(now, quietHours) {
  if (!quietHours) return null;
  const timezone = quietHours.timezone || 'UTC';
  const parts = zonedParts(now, timezone);
  const minute = parts.hour * 60 + parts.minute;
  const start = quietHours.startMinutes; const end = quietHours.endMinutes;
  const inside = start < end ? minute >= start && minute < end : minute >= start || minute < end;
  if (!inside || start === end) return null;
  const addDay = start > end && minute >= start ? 1 : 0;
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + addDay));
  return zonedDate({
    year: date.getUTCFullYear(), month: date.getUTCMonth(), day: date.getUTCDate(),
    hour: Math.floor(end / 60), minute: end % 60,
  }, timezone);
}

function nextDay(now) {
  return new Date(now.getTime() + 24 * 60 * 60 * 1000);
}

function localDayStart(now, timezone) {
  const parts = zonedParts(now, timezone || 'UTC');
  return zonedDate({ year: parts.year, month: parts.month - 1, day: parts.day }, timezone || 'UTC');
}

class ReminderWorker {
  constructor(options = {}) {
    this.repository = options.repository;
    this.router = options.router;
    this.gateway = options.gateway || null;
    this.policyProvider = options.policyProvider || (async () => ({}));
    this.now = options.now || (() => new Date());
    this.intervalMs = Math.min(Math.max(Number(options.intervalMs) || 5000, 250), 60000);
    this.batchSize = Math.min(Math.max(Number(options.batchSize) || 10, 1), 50);
    this.maxAttempts = Math.min(Math.max(Number(options.maxAttempts) || 5, 1), 20);
    this.logger = options.logger || null;
    this.timer = null;
    this.running = false;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref?.();
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  async tick() {
    if (this.running) return false;
    this.running = true;
    try {
      const now = this.now();
      await this.repository.markStaleClaimsUnknown({ before: new Date(now.getTime() - Math.max(this.intervalMs * 4, 60000)) });
      const unknown = await this.repository.listUnknownDeliveries({ limit: this.batchSize });
      for (const delivery of unknown) await this._reconcile(delivery);
      const claim = await this.repository.claimDue({ now, limit: this.batchSize });
      for (const reminder of claim.reminders) await this._process(reminder, claim.claimToken, now);
      return true;
    } catch (error) {
      this.logger?.warn?.({ code: 'LIFE_REMINDER_WORKER_FAILED' }, 'Life reminder worker failed');
      return false;
    } finally { this.running = false; }
  }

  async _process(reminder, claimToken, now) {
    if (reminder.expires_at && new Date(reminder.expires_at) <= now) {
      await this._transitionFailure(reminder, claimToken, 'expired', 'REMINDER_EXPIRED'); return;
    }
    if (Number(reminder.attempt_count || 0) > this.maxAttempts) {
      await this._transitionFailure(reminder, claimToken, 'failed', 'ATTEMPT_LIMIT'); return;
    }
    const policy = await this.policyProvider({ userId: reminder.user_id }).catch(() => ({}));
    const deferred = quietEnd(now, policy.quietHours);
    if (deferred || ['defer_non_urgent', 'critical_only'].includes(policy.notificationPolicy)) {
      const nextAttemptAt = deferred || (policy.deferUntil ? new Date(policy.deferUntil) : nextDay(now));
      await this.repository.transitionClaim({
        userId: reminder.user_id, reminderId: reminder.id, claimToken,
        state: 'scheduled', nextAttemptAt, errorCode: null,
      });
      return;
    }
    const cap = Math.min(Math.max(Number(policy.maxPerDay) || 5, 1), 50);
    const dayStart = localDayStart(now, policy.timezone || policy.quietHours?.timezone || reminder.timezone);
    if (await this.repository.countDeliveredSince({ userId: reminder.user_id, since: dayStart }) >= cap) {
      await this.repository.transitionClaim({
        userId: reminder.user_id, reminderId: reminder.id, claimToken,
        state: 'scheduled', nextAttemptAt: nextDay(now), errorCode: null,
      });
      return;
    }

    let finalStatus = 'delivered'; let errorCode = null;
    for (const channel of reminder.delivery_channels) {
      const key = deliveryKey(reminder, channel);
      let delivery = await this.repository.beginDelivery({
        userId: reminder.user_id, reminderId: reminder.id,
        occurrenceKey: reminder.occurrence_key, channel, deliveryKey: key,
      });
      if (!delivery) { finalStatus = 'outcome_unknown'; errorCode = 'DELIVERY_CLAIM_MISSING'; break; }
      if (delivery.state === 'delivered') continue;
      if (delivery.state === 'outcome_unknown' || delivery.state === 'sending' && !delivery.canSend) {
        finalStatus = 'outcome_unknown'; errorCode = delivery.error_code || 'DELIVERY_OUTCOME_UNKNOWN'; break;
      }
      if (delivery.state === 'failed') delivery = await this.repository.retryDelivery({
        userId: reminder.user_id, deliveryId: delivery.id, deliveryKey: key,
      });
      if (!delivery || delivery.state !== 'sending') { finalStatus = 'outcome_unknown'; errorCode = 'DELIVERY_STATE_CONFLICT'; break; }
      const result = await this.router.deliver({ reminder, channel, deliveryKey: key });
      const deliveryState = result.status === 'delivered' ? 'delivered'
        : result.status === 'transient_failure' || result.status === 'permanent_failure' ? 'failed' : 'outcome_unknown';
      const finished = await this.repository.finishDelivery({
        userId: reminder.user_id, deliveryId: delivery.id, deliveryKey: key,
        state: deliveryState, errorCode: result.errorCode,
      });
      if (!finished) { finalStatus = 'outcome_unknown'; errorCode = 'DELIVERY_RESULT_PERSIST_FAILED'; break; }
      if (result.status !== 'delivered') { finalStatus = result.status; errorCode = result.errorCode; break; }
    }

    if (finalStatus === 'delivered') {
      const following = nextOccurrence(reminder.trigger_at, reminder.recurrence, reminder.timezone);
      const updated = await this.repository.completeClaim({
        userId: reminder.user_id, reminderId: reminder.id, claimToken,
        nextTriggerAt: following,
        nextOccurrenceKey: following ? occurrenceKey(reminder.idempotency_key, following) : null,
      });
      if (updated) await this._record(reminder, 'reminder.delivered');
      return;
    }
    if (finalStatus === 'transient_failure') {
      await this.repository.transitionClaim({
        userId: reminder.user_id, reminderId: reminder.id, claimToken,
        state: 'scheduled', nextAttemptAt: new Date(now.getTime() + 60000), errorCode,
      });
      return;
    }
    await this._transitionFailure(reminder, claimToken,
      finalStatus === 'outcome_unknown' ? 'outcome_unknown' : 'failed', errorCode || 'DELIVERY_FAILED');
  }

  async _transitionFailure(reminder, claimToken, state, errorCode) {
    const updated = await this.repository.transitionClaim({
      userId: reminder.user_id, reminderId: reminder.id, claimToken, state, errorCode,
    });
    if (updated) await this._record(reminder, state === 'outcome_unknown' ? 'reminder.outcome_unknown' : 'reminder.delivery_failed');
  }

  async _reconcile(delivery) {
    const reminder = {
      ...delivery, id: delivery.reminder_id, user_id: delivery.user_id,
      occurrence_key: delivery.occurrence_key,
    };
    const result = await this.router.reconcile({
      reminder, channel: delivery.channel, deliveryKey: delivery.delivery_key,
    });
    if (result.status === 'outcome_unknown') return;
    const state = result.status === 'delivered' ? 'delivered' : 'failed';
    const updatedDelivery = await this.repository.reconcileDelivery({
      userId: delivery.user_id, deliveryId: delivery.id, deliveryKey: delivery.delivery_key,
      state, errorCode: result.errorCode,
    });
    if (!updatedDelivery) return;
    if (state === 'failed') {
      const updated = await this.repository.transitionUnknown({
        userId: delivery.user_id, reminderId: delivery.reminder_id,
        revision: delivery.reminder_revision, state: 'failed', errorCode: result.errorCode || 'DELIVERY_FAILED',
      });
      if (updated) await this._record(reminder, 'reminder.delivery_failed');
      return;
    }
    const allDelivered = await this.repository.occurrenceDelivered({
      userId: delivery.user_id, reminderId: delivery.reminder_id,
      key: delivery.occurrence_key, expectedChannels: delivery.delivery_channels,
    });
    if (!allDelivered) return;
    const following = nextOccurrence(delivery.trigger_at, delivery.recurrence, delivery.timezone);
    const updated = await this.repository.completeUnknown({
      userId: delivery.user_id, reminderId: delivery.reminder_id, revision: delivery.reminder_revision,
      nextTriggerAt: following,
      nextOccurrenceKey: following ? occurrenceKey(delivery.idempotency_key, following) : null,
    });
    if (updated) await this._record(reminder, 'reminder.delivered');
  }

  async _record(reminder, eventType) {
    if (!this.gateway) return;
    await this.gateway.record({
      userId: reminder.user_id, eventType, occurredAt: this.now(), sourceChannel: 'reminder',
      sourceRef: reminder.occurrence_key, deduplicationKey: `${eventType}:${reminder.occurrence_key}`,
      summary: eventType === 'reminder.delivered' ? 'Напоминание доставлено' : 'Статус доставки напоминания требует внимания',
      structuredData: { reminderId: reminder.id, occurrenceKey: reminder.occurrence_key,
        ...(reminder.commitment_id ? { commitmentId: reminder.commitment_id } : {}),
        ...(reminder.project_id ? { projectId: reminder.project_id } : {}) },
      trustLevel: 'trusted', privacyClass: 'personal',
    });
  }
}

module.exports = { ReminderWorker, deliveryKey, quietEnd };
