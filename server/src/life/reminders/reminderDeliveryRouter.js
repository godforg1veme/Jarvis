class ReminderDeliveryRouter {
  constructor(options = {}) {
    this.telegram = options.telegram || null;
    this.desktop = options.desktop || null;
  }

  async deliver({ reminder, channel, deliveryKey }) {
    const transport = channel === 'telegram' ? this.telegram : channel === 'desktop' ? this.desktop : null;
    if (!transport || typeof transport.deliver !== 'function') return { status: 'permanent_failure', errorCode: 'CHANNEL_UNAVAILABLE' };
    try {
      const result = await transport.deliver({
        userId: reminder.user_id,
        conversationId: channel === 'telegram' ? reminder.origin_conversation_id : null,
        deviceId: channel === 'desktop' ? reminder.origin_device_id : null,
        title: reminder.title,
        reminderId: reminder.id,
        occurrenceKey: reminder.occurrence_key,
        deliveryKey,
      });
      if (!result || !['delivered', 'transient_failure', 'permanent_failure', 'outcome_unknown'].includes(result.status)) {
        return { status: 'outcome_unknown', errorCode: 'INVALID_TRANSPORT_RESULT' };
      }
      return { status: result.status, errorCode: result.errorCode || null };
    } catch (_) {
      return { status: 'outcome_unknown', errorCode: 'TRANSPORT_OUTCOME_UNKNOWN' };
    }
  }

  async reconcile(input) {
    const transport = input.channel === 'telegram' ? this.telegram : input.channel === 'desktop' ? this.desktop : null;
    if (!transport || typeof transport.reconcile !== 'function') return { status: 'outcome_unknown' };
    try {
      const result = await transport.reconcile(input);
      return result && ['delivered', 'permanent_failure', 'outcome_unknown'].includes(result.status)
        ? result : { status: 'outcome_unknown' };
    } catch (_) { return { status: 'outcome_unknown' }; }
  }
}

module.exports = { ReminderDeliveryRouter };
