function allowCaptureMedia({ requestingWebContentsId, permission, mediaTypes = [], voiceWebContentsId = null, visionWebContentsId = null }) {
  if (permission !== 'media' || !Number.isInteger(requestingWebContentsId)) return false;
  const types = Array.isArray(mediaTypes) ? mediaTypes.map(String) : [];
  if (types.length === 0) return false;
  if (requestingWebContentsId === voiceWebContentsId) return types.every((type) => type === 'audio');
  if (requestingWebContentsId === visionWebContentsId) return types.every((type) => type === 'video');
  return false;
}

module.exports = { allowCaptureMedia };
