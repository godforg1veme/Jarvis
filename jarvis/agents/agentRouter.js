function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[.,!?;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const EXPLICIT_PATTERNS = [
  /^\/agent\s+/i,
  /^(агент|agent)\b/i,
  /^(джарвис|jarvis)\s+(сделай|выполни задачу|разберись|организуй)\b/i,
  /^(джарвис|jarvis)\s+(do|run task|handle|figure out|organize)\b/i,
  /^(сделай|выполни задачу|разберись|организуй)\b/i,
  /^(do|run task|handle|figure out|organize)\b/i,
];

function stripAgentPrefix(input) {
  let command = String(input || '').trim();
  command = command.replace(/^\/agent\s+/i, '');
  command = command.replace(/^(агент|agent)[,\s:]*/i, '');
  command = command.replace(/^(джарвис|jarvis)\s+(сделай|выполни задачу|разберись|организуй)[,\s:]*/i, '');
  command = command.replace(/^(джарвис|jarvis)\s+(do|run task|handle|figure out|organize)[,\s:]*/i, '');
  command = command.replace(/^(сделай|выполни задачу|разберись|организуй)[,\s:]*/i, '');
  command = command.replace(/^(do|run task|handle|figure out|organize)[,\s:]*/i, '');
  return command.trim();
}

function hasExplicitAgentTrigger(input) {
  return EXPLICIT_PATTERNS.some((pattern) => pattern.test(String(input || '').trim()));
}

function looksBatch(text) {
  return /\b(all|every|до\s+\d+|все|кажд|несколько)\b/.test(text) || /[*?]\.[a-z0-9]+/.test(text) || /\bpng|jpg|pdf|txt\b/.test(text) && /\bmove|copy|delete|перемест|скопир|удал/i.test(text);
}

function looksMultiStep(text) {
  const hasConnector = /\b(and then|then|после этого|затем|и потом|а потом)\b/.test(text) || text.includes(' и ');
  const actionWords = [
    'find', 'search', 'move', 'copy', 'rename', 'delete', 'create', 'open',
    'найди', 'поиск', 'перемести', 'скопируй', 'переименуй', 'удали', 'создай', 'открой',
  ];
  const count = actionWords.reduce((sum, word) => sum + (text.includes(word) ? 1 : 0), 0);
  return hasConnector && count >= 2;
}

function looksWindowLayout(text) {
  const hasWindow = /\bwindow|windows|окн|приложени|app\b/.test(text);
  const hasLayout = /\b(left|right|top|bottom|layout|snap|columns|слева|справа|сверху|снизу|размест|располож|колонк)\b/.test(text);
  return hasWindow && hasLayout;
}

function shouldUseDesktopAgent(input) {
  const raw = String(input || '').trim();
  if (!raw) return false;
  if (hasExplicitAgentTrigger(raw)) return true;

  const text = normalizeText(raw);
  return looksBatch(text) || looksMultiStep(text) || looksWindowLayout(text);
}

function parseAgentCommand(input) {
  if (!shouldUseDesktopAgent(input)) return null;
  const command = stripAgentPrefix(input);
  if (!command) return null;
  return {
    action: 'desktop_agent',
    command,
    explicit: hasExplicitAgentTrigger(input),
  };
}

function shouldEscalateResult(result) {
  return !!(result && (result.needsSelection || result.needsConfirmation || result.requiresStrongConfirmation));
}

module.exports = {
  normalizeText,
  stripAgentPrefix,
  hasExplicitAgentTrigger,
  shouldUseDesktopAgent,
  parseAgentCommand,
  shouldEscalateResult,
};
