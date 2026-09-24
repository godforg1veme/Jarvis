const CALCULATION_VERSION = 1;

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(Number(value) || 0, minimum), maximum);
}

function finiteDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function hoursBetween(left, right) {
  return (right.getTime() - left.getTime()) / 3600000;
}

function deadlineFactor(project, now) {
  const target = finiteDate(project.target_at);
  if (!target) return null;
  const hours = hoursBetween(now, target);
  if (hours < 0) return { code: 'deadline.overdue', contribution: 25 };
  if (hours <= 24) return { code: 'deadline.today', contribution: 22 };
  if (hours <= 72) return { code: 'deadline.near', contribution: 16 };
  if (hours <= 168) return { code: 'deadline.week', contribution: 8 };
  return null;
}

function commitmentFactors(commitments, now) {
  const open = commitments.filter((item) => item.status === 'open');
  const overdue = open.filter((item) => finiteDate(item.due_at) && finiteDate(item.due_at) < now).length;
  const result = [];
  if (open.length) result.push({ code: 'commitments.open', contribution: clamp(open.length * 3, 0, 15) });
  if (overdue) result.push({ code: 'commitments.overdue', contribution: clamp(overdue * 6, 0, 18) });
  return result;
}

function activityFactors(project, events, now) {
  const latest = events.map((event) => finiteDate(event.occurred_at)).filter(Boolean).sort((a, b) => b - a)[0]
    || finiteDate(project.updated_at);
  if (!latest) return { factors: [], latestAt: null };
  const ageHours = Math.max(0, hoursBetween(latest, now));
  if (ageHours <= 24) return { factors: [{ code: 'activity.today', contribution: 15 }], latestAt: latest };
  if (ageHours <= 168) return { factors: [{ code: 'activity.week', contribution: 9 }], latestAt: latest };
  if (ageHours >= 720) return { factors: [{ code: 'activity.stalled', contribution: 8 }], latestAt: latest };
  return { factors: [{ code: 'activity.recent', contribution: 3 }], latestAt: latest };
}

function unresolvedFactor(events) {
  const count = events.filter((event) => ['workflow.failed', 'workflow.outcome_unknown'].includes(event.event_type)).length;
  return count ? { code: 'workflow.unresolved', contribution: clamp(count * 6, 0, 18) } : null;
}

function modeFactor(mode, area) {
  const key = String(area?.area_key || '').toLowerCase();
  const compatible = {
    work: ['work', 'career', 'projects'], focus: ['work', 'career', 'projects'],
    home: ['home'], family: ['family'], travel: ['travel'], rest: ['health', 'rest'], sleep: ['health', 'rest'],
  };
  return compatible[mode]?.includes(key) ? { code: `mode.${mode}`, contribution: 8 } : null;
}

function calculateProjectPriority(input) {
  const now = finiteDate(input.now) || new Date();
  const factors = [];
  const state = input.state || {};
  if (state.user_weight) factors.push({ code: 'user.weight', contribution: clamp(state.user_weight * 20, -20, 20) });
  if (input.areaWeight) factors.push({ code: 'area.weight', contribution: clamp(input.areaWeight * 15, -15, 15) });
  const deadline = deadlineFactor(input.project, now);
  if (deadline) factors.push(deadline);
  factors.push(...commitmentFactors(input.commitments || [], now));
  const activity = activityFactors(input.project, input.events || [], now);
  factors.push(...activity.factors);
  const unresolved = unresolvedFactor(input.events || []);
  if (unresolved) factors.push(unresolved);
  const mode = modeFactor(input.mode || 'work', input.area);
  if (mode) factors.push(mode);
  if (input.calendarCompatible === true) factors.push({ code: 'calendar.window', contribution: 7 });
  if (input.resourceAvailable === true) factors.push({ code: 'resource.available', contribution: 5 });
  const evidenceConfidence = clamp(input.evidenceConfidence ?? 1, 0, 1);
  factors.push({ code: 'evidence.confidence', contribution: Math.round(evidenceConfidence * 5 * 100) / 100 });
  const score = clamp(factors.reduce((sum, factor) => sum + factor.contribution, 0), -1000, 1000);
  const availability = [
    true,
    Boolean(input.commitments),
    Boolean(input.events),
    input.calendarCompatible !== undefined && input.calendarCompatible !== null,
    input.resourceAvailable !== undefined && input.resourceAvailable !== null,
    Boolean(input.mode),
  ];
  const confidence = Math.round((availability.filter(Boolean).length / availability.length) * evidenceConfidence * 1000) / 1000;
  return { score, confidence, factors: factors.slice(0, 16), latestActivityAt: activity.latestAt?.toISOString() || null };
}

module.exports = { CALCULATION_VERSION, calculateProjectPriority, clamp, finiteDate };
