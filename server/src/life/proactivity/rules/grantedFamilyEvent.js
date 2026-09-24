const { defineRule } = require('../proactivityRule');
module.exports = defineRule({ id: 'family.event_attention', version: 1, inputKinds: ['family_event'], evaluate(signal) {
  if (!signal.authorizedGrant || !signal.familyEvent?.startsAt) return null;
  return { title: `Семейное событие: ${signal.familyEvent.title}`, explanation: 'Событие доступно через явное семейное разрешение и скоро начнётся.', confidence: signal.confidence || 0.9,
    riskClass: 'changing', actionName: 'reminder.create', actionArguments: signal.actions?.createReminder || {}, personId: signal.person?.id || null };
} });
