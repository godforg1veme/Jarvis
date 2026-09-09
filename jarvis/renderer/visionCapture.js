const video = document.getElementById('camera');
const canvas = document.getElementById('frame');
let stream = null;

function stopTracks() {
  if (stream) stream.getTracks().forEach((track) => track.stop());
  stream = null;
  video.srcObject = null;
}

async function enumerateCameras() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((device) => device.kind === 'videoinput')
    .slice(0, 32)
    .map((device) => ({ deviceId: device.deviceId, label: device.label }));
}

async function startCamera(args = {}) {
  stopTracks();
  const deviceId = String(args.deviceId || '');
  if (!deviceId) throw new Error('camera_device_required');
  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      deviceId: { exact: deviceId },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
  });
  video.srcObject = stream;
  await video.play();
  const settings = stream.getVideoTracks()[0]?.getSettings?.() || {};
  return { width: Number(settings.width || video.videoWidth || 0), height: Number(settings.height || video.videoHeight || 0) };
}

function canvasBlob(type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('camera_encode_failed'));
    }, type, quality);
  });
}

async function captureFrame(args = {}) {
  if (!stream || stream.getVideoTracks().every((track) => track.readyState !== 'live')) {
    throw new Error('camera_not_active');
  }
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  if (!sourceWidth || !sourceHeight) throw new Error('camera_frame_unavailable');
  const scale = Math.min(1, Number(args.maxWidth) / sourceWidth, Number(args.maxHeight) / sourceHeight);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  context.drawImage(video, 0, 0, width, height);
  const blob = await canvasBlob('image/jpeg', Number(args.quality));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return {
    bytes,
    contentType: 'image/jpeg',
    width,
    height,
    capturedAt: new Date().toISOString(),
  };
}

async function handleCommand(payload) {
  const requestId = String(payload && payload.requestId || '');
  const command = String(payload && payload.command || '');
  try {
    let result;
    if (command === 'list') result = { cameras: await enumerateCameras() };
    else if (command === 'start') result = await startCamera(payload.args || {});
    else if (command === 'capture') result = await captureFrame(payload.args || {});
    else if (command === 'stop') { stopTracks(); result = { stopped: true }; }
    else throw new Error('camera_command_invalid');
    window.jarvisVisionCapture.sendResult({ requestId, ok: true, result });
  } catch (error) {
    stopTracks();
    window.jarvisVisionCapture.sendResult({
      requestId,
      ok: false,
      errorCode: String(error && (error.name || error.message) || 'camera_capture_failed').slice(0, 80),
    });
  }
}

window.jarvisVisionCapture.onCommand(handleCommand);
window.addEventListener('beforeunload', stopTracks);

