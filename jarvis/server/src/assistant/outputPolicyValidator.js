const PROVIDER_IDENTITY_PATTERNS = [
  /(?:^|\s)я\s*[—–-]?\s*(?:это\s+)?(?:gemini|chatgpt|claude|deepseek)(?:\s|[.,!?]|$)/i,
  /(?:^|\s)я\s*[—–-]?\s*(?:ии[- ]ассистент|языковая модель)[^.!?]{0,100}(?:google|openai|anthropic|deepseek)(?:\s|[.,!?]|$)/i,
  /(?:^|\s)(?:меня|я)\s+(?:создал[аи]?|разработан[а]?)\s+(?:компанией\s+)?(?:google|openai|anthropic|deepseek)(?:\s|[.,!?]|$)/i,
];

const TOOL_SUCCESS_PATTERNS = [
  /(?:^|\s)я\s+(?:уже\s+)?(?:открыл|запустил|удалил|изменил|переместил|переименовал|установил|выключил|включил)(?:\s|[.,!?]|$)/i,
  /(?:^|\s)(?:готово|выполнено)[:,.!]?\s+(?:файл|приложение|компьютер|устройство|настройк)/i,
];

function normalizeForPolicy(value) {
  return String(value || '').replace(/[\\*_`~\[\]()]/g, ' ').replace(/\s+/g, ' ').trim();
}

function hasProviderIdentity(answer) {
  const text = normalizeForPolicy(answer);
  return PROVIDER_IDENTITY_PATTERNS.some((pattern) => pattern.test(text));
}

function validateOutput(answer, context = {}) {
  const text = String(answer || '').trim();
  const violations = [];
  if (!text) violations.push('empty_answer');
  if (hasProviderIdentity(text)) violations.push('provider_identity');
  if (/<\/?JARVIS_(?:TRUSTED_POLICY|UNTRUSTED_USER_REQUEST_JSON)(?:\s[^>]*)?>/i.test(text)) violations.push('trusted_prompt_leak');
  if (!context.hasVerifiedToolResults && TOOL_SUCCESS_PATTERNS.some((pattern) => pattern.test(text))) {
    violations.push('unverified_tool_success');
  }
  return { ok: violations.length === 0, violations };
}

module.exports = {
  PROVIDER_IDENTITY_PATTERNS,
  TOOL_SUCCESS_PATTERNS,
  hasProviderIdentity,
  normalizeForPolicy,
  validateOutput,
};
