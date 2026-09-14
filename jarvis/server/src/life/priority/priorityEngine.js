const { CALCULATION_VERSION, calculateProjectPriority, finiteDate } = require('./priorityFactors');

function preferenceValues(rows) {
  return new Map((rows || []).map((row) => [row.preference_key, row.value]));
}

class PriorityEngine {
  constructor(options = {}) {
    this.repository = options.repository;
    this.now = options.now || (() => new Date());
  }

  async evaluate(input) {
    const now = input.now ? finiteDate(input.now) : this.now();
    const projects = (input.projects || []).filter((project) => project.status === 'active').slice(0, 200);
    const stateByProject = new Map((input.states || []).map((state) => [state.project_id, state]));
    const areaById = new Map((input.areas || []).map((area) => [area.id, area]));
    const values = preferenceValues(input.preferences);
    const areaWeights = new Map((values.get('areas.priorities') || []).map((item) => [item.areaId, item.weight]));
    const ranked = [];
    for (const project of projects) {
      const state = stateByProject.get(project.id) || {};
      const hidden = Boolean(state.hidden_until && new Date(state.hidden_until) > now);
      if (hidden) continue;
      const events = (input.events || []).filter((event) => (event.links || []).some((link) => link.targetType === 'project' && link.targetId === project.id));
      const commitments = (input.commitments || []).filter((item) => item.project_id === project.id);
      const evidence = events.length ? events.reduce((sum, event) => sum + Number(event.confidence || 0), 0) / events.length : 0.7;
      const calculation = calculateProjectPriority({
        project, state, area: areaById.get(project.area_id), areaWeight: areaWeights.get(project.area_id) || 0,
        commitments, events, mode: input.mode?.mode || 'work',
        calendarCompatible: input.calendarByProject?.[project.id] ?? null,
        resourceAvailable: input.resourceAvailable,
        evidenceConfidence: evidence, now,
      });
      if (this.repository && input.persist !== false) await this.repository.saveCalculation({
        userId: input.userId, projectId: project.id, score: calculation.score,
        confidence: calculation.confidence, factors: calculation.factors,
        calculationVersion: CALCULATION_VERSION,
      });
      ranked.push({ project, state, ...calculation, pinned: state.pinned === true });
    }
    ranked.sort((left, right) => Number(right.pinned) - Number(left.pinned)
      || right.score - left.score
      || new Date(right.latestActivityAt || 0) - new Date(left.latestActivityAt || 0)
      || String(left.project.id).localeCompare(String(right.project.id)));
    const selected = ranked.find((entry) => entry.pinned) || ranked[0] || null;
    return {
      selected,
      ranked,
      asOf: now.toISOString(),
      calculationVersion: CALCULATION_VERSION,
      selectionReason: selected ? (selected.pinned ? 'user_pin' : 'calculated_priority') : 'no_eligible_project',
    };
  }

  fallback({ projects = [], states = [], now = this.now() }) {
    const stateByProject = new Map(states.map((state) => [state.project_id, state]));
    const eligible = projects.filter((project) => project.status === 'active' && !(
      stateByProject.get(project.id)?.hidden_until && new Date(stateByProject.get(project.id).hidden_until) > now
    ));
    const pinned = eligible.find((project) => stateByProject.get(project.id)?.pinned);
    const selected = pinned || eligible.sort((left, right) => new Date(right.updated_at || 0) - new Date(left.updated_at || 0))[0] || null;
    return { selected, selectionReason: pinned ? 'fallback_user_pin' : selected ? 'fallback_recent_activity' : 'no_eligible_project' };
  }
}

module.exports = { PriorityEngine };
