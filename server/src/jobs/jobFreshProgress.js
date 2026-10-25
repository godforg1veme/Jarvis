const MINUTE = 60000;
const moscowDay = value => Math.floor((Date.parse(value) + 3 * 60 * MINUTE) / 86400000);

function refreshFreshProgress(progress, queries, now) {
  const previous = progress.headUntil || progress.until;
  if (now.getTime() - Date.parse(previous) < 5 * MINUTE) return;
  const until = now.toISOString();
  const pivot = Math.max(0, queries.indexOf(progress.windows[0]?.query));
  const ordered = [...queries.slice(pivot), ...queries.slice(0, pivot)];
  const heads = ordered.map(query => ({ query,
    from: new Date(Math.max(Date.parse(progress.lower), Date.parse(previous) - 60 * MINUTE)).toISOString(),
    to: until, page: 0, offset: 0 }));
  // An unopened overlapping window has no cursor to lose. An exhausted same-day
  // window has already reached HH's accessible page cap; a new head can cover it
  // again. Keep every partially read cursor and every older saturated day.
  progress.windows = progress.windows.filter(window => {
    const head = heads.find(candidate => candidate.query === window.query);
    const merge = head && window.to >= head.from && window.from <= head.to
      && ((window.page === 0 && window.offset === 0)
        || (window.exhausted && moscowDay(window.from) === moscowDay(until)));
    if (merge && window.from < head.from) head.from = window.from;
    return !merge;
  });
  progress.windows.unshift(...heads);
  progress.headUntil = until;
}

function boundFreshProgress(progress) {
  if (progress.windows.length <= 256 && Buffer.byteLength(JSON.stringify(progress)) <= 96 * 1024) return;
  // Conservatively replay the union for each query rather than deleting an
  // unchecked range. Reset cursors, retain all lower/upper bounds, and do not
  // advance the checkpoint. Outbox dedup prevents duplicate cards during replay.
  const unions = new Map();
  for (const window of progress.windows) {
    const union = unions.get(window.query);
    if (!union) unions.set(window.query, { query: window.query, from: window.from, to: window.to, page: 0, offset: 0 });
    else {
      if (window.from < union.from) union.from = window.from;
      if (window.to > union.to) union.to = window.to;
    }
  }
  progress.windows = [...unions.values()];
}

module.exports = { refreshFreshProgress, boundFreshProgress };
