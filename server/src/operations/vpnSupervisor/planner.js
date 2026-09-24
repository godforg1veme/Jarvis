const { plannerContextSchema, plannerResponseSchema } = require('./contracts');
const { buildPlannerMessages } = require('./prompt');

class VpnSupervisorPlannerError extends Error {
  constructor(code, issueHints = []) {
    super('VPN Supervisor planning failed');
    this.code = code;
    this.issueHints = issueHints;
  }
}

const CLOSED_ISSUE_KINDS = new Set(['invalid_type', 'invalid_value', 'unrecognized_keys', 'too_big', 'too_small', 'custom']);
const CLOSED_ISSUE_PATHS = /^(?:version|decision|playbookId|reasonCode|confidence|requiredChecks(?:\.[0-9]{1,2})?|evidenceRefs(?:\.[0-9]{1,2})?)$/;

function schemaIssueHints(issues) {
  const hints = [];
  const seen = new Set();
  for (const issue of issues) {
    const path = issue.path.map(String).join('.') || 'response';
    const kind = CLOSED_ISSUE_KINDS.has(issue.code) ? issue.code : 'invalid_value';
    if (!CLOSED_ISSUE_PATHS.test(path)) continue;
    const key = `${path}:${kind}`;
    if (!seen.has(key)) { hints.push({ path, kind }); seen.add(key); }
    if (hints.length >= 8) break;
  }
  return hints;
}

function parsePlannerResponse(value, context) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 16 * 1024) throw new VpnSupervisorPlannerError('VPN_SUPERVISOR_RESPONSE_INVALID', [{ path: 'response', kind: 'invalid_type' }]);
  let decoded;
  try { decoded = JSON.parse(value); } catch (_) { throw new VpnSupervisorPlannerError('VPN_SUPERVISOR_RESPONSE_INVALID', [{ path: 'response', kind: 'invalid_json' }]); }
  const parsed = plannerResponseSchema.safeParse(decoded);
  if (!parsed.success) throw new VpnSupervisorPlannerError('VPN_SUPERVISOR_RESPONSE_INVALID', schemaIssueHints(parsed.error.issues));
  const refs = new Set([...context.facts.map((item) => item.id), ...context.evidence.map((item) => item.id)]);
  if (parsed.data.evidenceRefs.some((ref) => !refs.has(ref))) throw new VpnSupervisorPlannerError('VPN_SUPERVISOR_EVIDENCE_INVALID', [{ path: 'evidenceRefs', kind: 'invalid_reference' }]);
  return Object.freeze(parsed.data);
}

class VpnSupervisorPlanner {
  constructor({ provider }) { this.provider = provider; }
  async plan(value) {
    const context = plannerContextSchema.parse(value);
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const answer = await this.provider.answer({ messages: buildPlannerMessages(context, { correction: attempt === 1, issueHints: lastError?.issueHints }) });
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
