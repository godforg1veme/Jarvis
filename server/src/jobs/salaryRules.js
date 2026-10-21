function currency(value) { return value === 'RUR' ? 'RUB' : String(value || 'RUB').toUpperCase(); }

function descriptionSalary(text) {
  // Conservative extraction: unknown period/tax status is never silently inferred.
  const normalized = String(text || '').replace(/<[^>]*>/g, ' ').replace(/\u00a0/g, ' ');
  const matches = [...normalized.matchAll(/(?:зарплат[аыу]|доход|оплата|оклад)\s*[:—-]?\s*(?:(от|до)\s*)?(\d[\d ]{1,10})(?:\s*[–—-]\s*(\d[\d ]{1,10}))?\s*(тыс\.?|k)?\s*(₽|руб\w*|\$|usd|eur|€)([^.!?\n]{0,110})/giu)];
  return matches.slice(0, 10).map((m) => {
    const multiplier = m[4] ? 1000 : 1;
    const low = Number(m[2].replace(/ /g, '')) * multiplier;
    const high = m[3] ? Number(m[3].replace(/ /g, '')) * multiplier : null;
    const suffix = m[6];
    return { from: m[1] === 'до' ? null : low, to: high || (m[1] === 'до' ? low : null),
      currency: /\$|usd/i.test(m[5]) ? 'USD' : /€|eur/i.test(m[5]) ? 'EUR' : 'RUB',
      gross: /на руки|после (?:вычета )?налог/i.test(suffix) ? false : undefined,
      period: /в месяц|ежемесяч|\/мес/i.test(suffix) ? 'month' : 'unknown',
      bonus: /преми|бонус|kpi/i.test(suffix) };
  });
}

function evaluateSalary({ salary, description = '', targetRub = null, rateSnapshot }) {
  if (targetRub == null) return { include: true, reasonCodes: [], annotations: [] };
  const annotations = [];
  const sources = [];
  if (salary && (salary.from != null || salary.to != null)) sources.push({ ...salary,
    period: salary.period || 'month', currency: currency(salary.currency) });
  sources.push(...descriptionSalary(description));
  if (!sources.length) return { include: true, reasonCodes: [], annotations: ['SALARY_UNKNOWN'] };
  const proven = [];
  let uncertain = false;
  for (const item of sources) {
    if (item.gross !== false || item.period !== 'month' || item.bonus) { uncertain = true; continue; }
    const code = currency(item.currency);
    const rate = code === 'RUB' ? 1 : rateSnapshot?.fresh === true ? rateSnapshot?.rates?.[code] : null;
    if (!(rate > 0)) { uncertain = true; continue; }
    const from = item.from == null ? null : Number(item.from) * rate;
    const to = item.to == null ? null : Number(item.to) * rate;
    if ((from != null && (!Number.isFinite(from) || from <= 0))
      || (to != null && (!Number.isFinite(to) || to <= 0)) || (from != null && to != null && from > to)) {
      uncertain = true; continue;
    }
    proven.push({ from, to, below: (to ?? from) < targetRub });
  }
  if (uncertain) annotations.push('SALARY_NEEDS_CLARIFICATION');
  if (proven.length > 1 && proven.some((x) => x.from !== proven[0].from || x.to !== proven[0].to)) {
    annotations.push('SALARY_CONFLICT');
    return { include: true, reasonCodes: [], annotations };
  }
  if (proven.some((x) => x.from == null || x.from < targetRub)) annotations.push('SALARY_MINIMUM_NOT_GUARANTEED');
  const below = proven.length > 0 && proven.every((x) => x.below) && !uncertain;
  return { include: !below, reasonCodes: below ? ['SALARY_BELOW_TARGET'] : [], annotations };
}

module.exports = { evaluateSalary, descriptionSalary };
