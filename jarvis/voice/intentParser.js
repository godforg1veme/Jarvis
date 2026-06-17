const { apps } = require("../actions/appRegistry");
const {
  isVisualAnalyzeCommand,
  isVisualContinuationCommand,
  isClearVisualContextCommand,
} = require("../tools/visualCommandMatcher");
const { parseFileCommand } = require("../tools/fileCommandParser");

const wakeAliases = [
  "РґР¶Р°СЂРІРёСЃ",
  "Р¶Р°СЂРІРёСЃ",
  "РґР¶РµСЂРІРёСЃ",
  "СЏСЂРІРёСЃ",
  "джарвис",
  "жарвис",
  "джервис",
  "ярвис",
  "jarvis"
];

const launchWords = [
  "РІРєР»СЋС‡Рё",
  "Р·Р°РїСѓСЃС‚Рё",
  "РѕС‚РєСЂРѕР№",
  "СЃС‚Р°СЂС‚Р°РЅРё",
  "Р·Р°РіСЂСѓР·Рё",
  "РІСЂСѓР±Рё",
  "включи",
  "запусти",
  "открой",
  "стартани",
  "загрузи",
  "вруби"
];

const closeWords = [
  "РІС‹РєР»СЋС‡Рё",
  "Р·Р°РєСЂРѕР№",
  "Р·Р°РєСЂС‹С‚СЊ",
  "РѕСЃС‚Р°РЅРѕРІРё",
  "СѓР±РµР№",
  "РІС‹СЂСѓР±Рё",
  "выключи",
  "закрой",
  "закрыть",
  "останови",
  "убей",
  "выруби"
];

const translateSelectedPhrases = [
  "переведи выделенное",
  "переведи выделенный текст",
  "переведи выбранное",
  "переведи выбранный текст"
];

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/С‘/g, "Рµ")
    .replace(/[.,!?;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(text, words) {
  return words.some((word) => text.includes(normalizeText(word)));
}

function findAppByAlias(text) {
  for (const app of Object.values(apps)) {
    for (const alias of app.aliases) {
      if (text.includes(normalizeText(alias))) {
        return app;
      }
    }
  }

  return null;
}

function isTranslateSelectedCommand(text) {
  if (translateSelectedPhrases.some((phrase) => text.includes(normalizeText(phrase)))) {
    return true;
  }

  const hasTranslateVerb = text.includes("переведи") || text.includes("перевести");
  const hasSelectedTarget = text.includes("выделен") || text.includes("выбран");
  return hasTranslateVerb && hasSelectedTarget;
}

function parseIntent(rawText) {
  const text = normalizeText(rawText);

  const fileCommand = parseFileCommand(rawText);
  if (fileCommand) {
    const actionMap = {
      open: "open_file",
      reveal: "reveal_file",
      find: "find_file",
    };

    return {
      ok: true,
      action: actionMap[fileCommand.action],
      query: fileCommand.query,
      location: fileCommand.location,
      confidence: 0.9,
      source: "regex",
      rawText
    };
  }

  const hasWake = includesAny(text, wakeAliases);
  const hasLaunch = includesAny(text, launchWords);
  const hasClose = includesAny(text, closeWords);

  if (isTranslateSelectedCommand(text)) {
    return {
      ok: true,
      action: "translate_selected",
      confidence: 0.95,
      source: "regex",
      rawText
    };
  }

  if (isClearVisualContextCommand(text)) {
    return {
      ok: true,
      action: "clear_visual_context",
      confidence: 0.95,
      source: "regex",
      rawText
    };
  }

  if (isVisualAnalyzeCommand(text)) {
    return {
      ok: true,
      action: "visual_analyze",
      confidence: 0.95,
      source: "regex",
      rawText
    };
  }

  if (isVisualContinuationCommand(text)) {
    return {
      ok: true,
      action: "visual_continue",
      confidence: 0.85,
      source: "regex",
      rawText
    };
  }

  const app = findAppByAlias(text);

  if (hasWake && hasClose && app) {
    return {
      ok: true,
      action: "close_app",
      appId: app.id,
      confidence: 0.95,
      source: "regex",
      rawText
    };
  }

  if (hasWake && hasLaunch && app) {
    return {
      ok: true,
      action: "launch_app",
      appId: app.id,
      confidence: 0.95,
      source: "regex",
      rawText
    };
  }

  return {
    ok: false,
    reason: "Не удалось распознать команду",
    rawText
  };
}

module.exports = { parseIntent };
