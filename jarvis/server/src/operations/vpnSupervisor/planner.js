const { plannerContextSchema, plannerResponseSchema } = require('./contracts');
const { buildPlannerMessages } = require('./prompt');

class VpnSupervisorPlannerError extends Error {
  constructor(code) { super('VPN Supervisor planning failed'); this.code = code; }
}

function parsePlannerResponse(value, context) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 16 * 1024) throw new VpnSupervisorPlannerError('VPN_SUPERVISOR_RESPONSE_INVALID');
  let decoded;
  try { decoded = JSON.parse(value); } catch (_) { throw new VpnSupervisorPlannerError('VPN_SUPERVISOR_RESPONSE_INVALID'); }
  const parsed = plannerResponseSchema.safeParse(decoded);
  if (!parsed.success) throw new VpnSupervisorPlannerError('VPN_SUPERVISOR_RESPONSE_INVALID');
  const refs = new Set([...context.facts.map((item) => item.id), ...context.evidence.map((item) => item.id)]);
  if (parsed.data.evidenceRefs.some((ref) => !refs.has(ref))) throw new VpnSupervisorPlannerError('VPN_SUPERVISOR_EVIDENCE_INVALID');
  return Object.freeze(parsed.data);
}

class VpnSupervisorPlanner {
  constructor({ provider }) { this.provider = provider; }
  async plan(value) {
    const context = plannerContextSchema.parse(value);
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const answer = await this.provider.answer({ messages: buildPlannerMessages(context, { correction: attempt === 1 }) });
        return parsePlannerResponse(answer, context);
      } catch (error) {
        lastError = error;
        if (error?.code !== 'VPN_SUPERVISOR_RESPONSE_INVALID' && error?.code !== 'VPN_SUPERVISOR_EVIDENCE_INVALID') break;
      }
    }
    if (lastError instanceof VpnSupervisorPlannerError) throw lastError;
    throw new VpnSupervisorPlannerError('VPN_SUPERVISOR_PROVIDER_UNAVAILABLE');
  }
}

module.exports = { VpnSupervisorPlanner, VpnSupervisorPlannerError, parsePlannerResponse };
