const EXPLICIT_VISUAL = /(?:посмотр(?:и|еть)|взглян(?:и|уть)|покаж(?:и|и-ка)|наблюдай|следи|смотри\s+(?:пока|за)|что\s+(?:ты\s+)?видишь|что\s+(?:сейчас\s+)?на\s+(?:моем\s+)?(?:экране|мониторе|камере)|проанализируй\s+(?:кадр|экран|камеру)|look\s+at|what\s+(?:do\s+you\s+)?see|watch|monitor)/iu;
const CAMERA = /(?:камер(?:а|у|е|ой)|camo|camera|вебк)/iu;
const SCREEN = /(?:экран(?:е|а|ы|ов)?|монитор(?:е|а|ы|ов)?|рабоч(?:ий|его)\s+стол|screen|display|monitor)/iu;
const BOTH = /(?:оба|обоих|все|вместе|одновременно|both|all)/iu;
const ACTIVE = /(?:наблюдай|следи|смотри\s+(?:пока|за)|не\s+переставай|watch|monitor)/iu;

function classifyVisualIntent(text) {
  const value = String(text || '').trim().slice(0, 10000);
  if (!value || !EXPLICIT_VISUAL.test(value)) return { visual: false };
  const camera = CAMERA.test(value);
  const screen = SCREEN.test(value);
  return {
    visual: true,
    target: camera && screen ? 'all' : camera ? 'camera' : screen ? 'screen' : BOTH.test(value) ? 'all' : 'all',
    kind: ACTIVE.test(value) ? 'active' : 'short',
  };
}

module.exports = { ACTIVE, BOTH, CAMERA, EXPLICIT_VISUAL, SCREEN, classifyVisualIntent };
