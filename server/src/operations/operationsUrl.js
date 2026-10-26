function operationsPanelUrl(enabled, origin) {
  if (enabled !== true || typeof origin !== 'string' || !origin || origin !== origin.trim()) return null;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password
      || url.pathname !== '/' || url.search || url.hash || url.href !== `${url.origin}/`) return null;
    return `${url.origin}/ops/`;
  } catch { return null; }
}

module.exports = { operationsPanelUrl };
