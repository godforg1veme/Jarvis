const DEFAULT_PROTECTED_APPS = Object.freeze([
  '1password',
  'bitwarden',
  'keepass',
  'credential manager',
  'диспетчер учетных данных',
]);

function normalize(value) {
  return String(value || '').trim().toLowerCase().replace(/\.exe$/i, '');
}

function boundedPatterns(values, label) {
  if (!Array.isArray(values) || values.length > 100) throw new Error(`${label} is invalid`);
  return values.map((value) => {
    const normalized = normalize(value);
    if (!normalized || normalized.length > 160) throw new Error(`${label} contains an invalid value`);
    return normalized;
  });
}

class ScreenPrivacyGuard {
  constructor(options = {}) {
    this.protectedApps = boundedPatterns(options.protectedApps || DEFAULT_PROTECTED_APPS, 'protected apps');
    this.protectedTitleFragments = boundedPatterns(options.protectedTitleFragments || [], 'protected window titles');
  }

  isProtectedWindow(window = {}) {
    const processName = normalize(window.processName);
    const title = normalize(window.title);
    return this.protectedApps.some((app) => processName === app || processName.includes(app) || title.includes(app))
      || this.protectedTitleFragments.some((fragment) => title.includes(fragment));
  }

  evaluate(input = {}) {
    const displayIds = new Set((input.displayIds || []).map((value) => String(value)));
    const windows = Array.isArray(input.windows) ? input.windows.slice(0, 500) : [];
    const protectedDisplays = new Set();
    let protectedWindowCount = 0;
    for (const window of windows) {
      if (!window || window.visible === false || !this.isProtectedWindow(window)) continue;
      const displayId = String(window.displayId || '');
      if (displayIds.size && !displayIds.has(displayId)) continue;
      protectedWindowCount += 1;
      if (displayId) protectedDisplays.add(displayId);
    }
    return {
      allowed: protectedWindowCount === 0,
      reason: protectedWindowCount ? 'protected_application_visible' : '',
      protectedWindowCount,
      protectedDisplayIds: [...protectedDisplays],
    };
  }
}

function redactAccessibilityNodes(nodes, options = {}) {
  if (!Array.isArray(nodes)) return [];
  const maxNodes = Math.max(1, Math.min(Number(options.maxNodes || 500), 1000));
  return nodes.slice(0, maxNodes).map((node) => {
    const value = node && typeof node === 'object' ? node : {};
    const sensitive = value.password === true
      || value.sensitive === true
      || /password|credential|secret|token|парол/iu.test(String(value.controlType || ''));
    return {
      candidateId: String(value.candidateId || '').slice(0, 128),
      controlType: String(value.controlType || '').slice(0, 80),
      name: sensitive ? '[REDACTED]' : String(value.name || '').slice(0, 300),
      value: sensitive ? '[REDACTED]' : String(value.value || '').slice(0, 1000),
      enabled: value.enabled !== false,
      sensitive,
    };
  });
}

module.exports = {
  DEFAULT_PROTECTED_APPS,
  ScreenPrivacyGuard,
  redactAccessibilityNodes,
};
