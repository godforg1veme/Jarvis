function allowCaptureMedia({ requestingWebContentsId, permission, mediaTypes = [], mediaType = '', voiceWebContentsId = null, visionWebContentsId = null }) {
  if (permission !== 'media' || !Number.isInteger(requestingWebContentsId)) return false;
  const types = Array.isArray(mediaTypes) && mediaTypes.length
    ? mediaTypes.map(String)
    : (mediaType ? [String(mediaType)] : []);
  if (types.length === 0) return false;
  if (requestingWebContentsId === voiceWebContentsId) return types.every((type) => type === 'audio');
  if (requestingWebContentsId === visionWebContentsId) return types.every((type) => type === 'video');
  return false;
}

module.exports = { allowCaptureMedia };
