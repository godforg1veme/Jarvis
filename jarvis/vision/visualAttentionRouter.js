const { requiredId } = require('./visionSchemas');

const CAMERA_INTENT = /(?:\b(?:camera|webcam|camo)\b|камер)/iu;
const SCREEN_INTENT = /(?:\b(?:screen|display|monitor)\b|экран|монитор)/iu;
const BOTH_SCREENS_INTENT = /(?:оба\s+(?:экрана|монитора)|все\s+(?:экраны|мониторы)|both\s+(?:screens|displays|monitors))/iu;
const FIRST_DISPLAY_INTENT = /(?:перв(?:ый|ом)\s+(?:экран|монитор)|лев(?:ый|ом)\s+(?:экран|монитор)|(?:screen|display|monitor)\s*1)/iu;
const SECOND_DISPLAY_INTENT = /(?:втор(?:ой|ом)\s+(?:экран|монитор)|прав(?:ый|ом)\s+(?:экран|монитор)|(?:screen|display|monitor)\s*2)/iu;

function activeSources(sources) {
  if (!Array.isArray(sources)) return [];
  return sources.filter((source) => source && source.active && source.available !== false && !source.protected);
}

function byId(sources, sourceId) {
  return sources.find((source) => source.sourceId === sourceId) || null;
}

function addScore(scores, source, amount, reason) {
  if (!source) return;
  const current = scores.get(source.sourceId) || { source, score: 0, reasons: [] };
  current.score += amount;
  current.reasons.push(reason);
  scores.set(source.sourceId, current);
}

function resolveVisualAttention(input = {}) {
  const sources = activeSources(input.sources);
  if (sources.length === 0) return { kind: 'unavailable', reason: 'no_active_visual_source' };
  const requestedSourceId = input.requestedSourceId ? requiredId(input.requestedSourceId, 'requested vision source id') : '';
  if (requestedSourceId) {
    const requested = byId(sources, requestedSourceId);
    return requested
      ? { kind: 'resolved', sourceId: requested.sourceId, sourceType: requested.type, confidence: 1, reason: 'explicit_source_id' }
      : { kind: 'unavailable', reason: 'requested_source_unavailable' };
  }

  const text = String(input.text || '').slice(0, 10000);
  const scores = new Map();
  const workspace = sources.find((source) => source.type === 'screen_workspace');
  const cameras = sources.filter((source) => source.type === 'camera');
  const displays = sources.filter((source) => source.type === 'display')
    .sort((a, b) => Number(a.displayIndex || 0) - Number(b.displayIndex || 0));

  if (BOTH_SCREENS_INTENT.test(text)) addScore(scores, workspace, 100, 'explicit_both_displays');
  if (CAMERA_INTENT.test(text)) cameras.forEach((source) => addScore(scores, source, 90, 'explicit_camera'));
  if (FIRST_DISPLAY_INTENT.test(text)) addScore(scores, displays[0], 100, 'explicit_first_display');
  if (SECOND_DISPLAY_INTENT.test(text)) addScore(scores, displays[1], 100, 'explicit_second_display');
  if (SCREEN_INTENT.test(text) && !FIRST_DISPLAY_INTENT.test(text) && !SECOND_DISPLAY_INTENT.test(text)) {
    addScore(scores, workspace || displays[0], 70, 'explicit_screen');
  }

  addScore(scores, byId(sources, input.controlSourceId), 85, 'visual_control_target');
  addScore(scores, byId(sources, input.memorySourceId), 80, 'memory_provenance');
  addScore(scores, byId(sources, input.selectedSourceId), 50, 'user_selected_source');
  addScore(scores, byId(sources, input.activeWindowSourceId), 45, 'active_window');
  const cursorDisplay = displays.find((source) => source.displayIndex === input.cursorDisplayIndex);
  addScore(scores, cursorDisplay, 40, 'cursor_display');
  addScore(scores, byId(sources, input.recentSourceId), 30, 'recent_visual_topic');

  if (scores.size === 0 && sources.length === 1) {
    const only = sources[0];
    return { kind: 'resolved', sourceId: only.sourceId, sourceType: only.type, confidence: 0.7, reason: 'only_active_source' };
  }
  if (scores.size === 0) return { kind: 'ambiguous', candidates: sources.map((source) => source.sourceId).slice(0, 4), reason: 'no_attention_signal' };

  const ranked = [...scores.values()].sort((a, b) => b.score - a.score);
  if (ranked.length > 1 && ranked[0].score - ranked[1].score < 15) {
    return {
      kind: 'ambiguous',
      candidates: ranked.slice(0, 2).map((entry) => entry.source.sourceId),
      reason: 'attention_scores_too_close',
    };
  }
  const best = ranked[0];
  return {
    kind: 'resolved',
    sourceId: best.source.sourceId,
    sourceType: best.source.type,
    confidence: Math.min(1, Math.max(0.5, best.score / 100)),
    reason: best.reasons[0],
  };
}

function regionAroundPoint(point, imageSize, options = {}) {
  const width = Math.min(Number(options.width || 900), imageSize.width);
  const height = Math.min(Number(options.height || 600), imageSize.height);
  if (![point.x, point.y, imageSize.width, imageSize.height, width, height].every(Number.isFinite)) {
    throw new Error('visual attention region values are invalid');
  }
  return {
    x: Math.max(0, Math.min(Math.round(point.x - width / 2), imageSize.width - width)),
    y: Math.max(0, Math.min(Math.round(point.y - height / 2), imageSize.height - height)),
    width: Math.round(width),
    height: Math.round(height),
  };
}

module.exports = {
  CAMERA_INTENT,
  SCREEN_INTENT,
  regionAroundPoint,
  resolveVisualAttention,
};

