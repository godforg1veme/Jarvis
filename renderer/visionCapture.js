const video = document.getElementById('camera');
const canvas = document.getElementById('frame');
const signatureCanvas = document.getElementById('signature');
let stream = null;

function stopTracks() {
  if (stream) stream.getTracks().forEach((track) => track.stop());
  stream = null;
  video.srcObject = null;
}

async function enumerateCameras(args = {}) {
  let devices = await navigator.mediaDevices.enumerateDevices();
  if (args.requestPermission === true && !devices.some((device) => device.kind === 'videoinput' && device.deviceId)) {
    const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
    permissionStream.getTracks().forEach((track) => track.stop());
    devices = await navigator.mediaDevices.enumerateDevices();
  }
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
  const signatureContext = signatureCanvas.getContext('2d', { alpha: false, willReadFrequently: true });
  signatureContext.drawImage(video, 0, 0, signatureCanvas.width, signatureCanvas.height);
  const rgba = signatureContext.getImageData(0, 0, signatureCanvas.width, signatureCanvas.height).data;
  const signature = new Uint8Array(signatureCanvas.width * signatureCanvas.height);
  for (let source = 0, target = 0; source < rgba.length; source += 4, target += 1) {
    signature[target] = Math.round(rgba[source] * 0.299 + rgba[source + 1] * 0.587 + rgba[source + 2] * 0.114);
  }
  const blob = await canvasBlob('image/jpeg', Number(args.quality));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return {
    bytes,
    contentType: 'image/jpeg',
    width,
    height,
    capturedAt: new Date().toISOString(),
    signature,
  };
}

async function composeWorkspace(args = {}) {
  const frames = Array.isArray(args.frames) ? args.frames.slice(0, 8) : [];
  if (!frames.length) throw new Error('workspace_frames_required');
  const tileWidth = Math.max(320, Math.min(Number(args.tileWidth || 960), 1920));
  const gap = 8;
  const labelHeight = 30;
  const decoded = [];
  for (const frame of frames) {
    const bytes = frame.bytes instanceof Uint8Array ? frame.bytes : new Uint8Array(frame.bytes || []);
    const bitmap = await createImageBitmap(new Blob([bytes], { type: frame.contentType || 'image/jpeg' }));
    const width = Math.min(tileWidth, bitmap.width);
    decoded.push({ ...frame, bitmap, width, height: Math.max(1, Math.round(bitmap.height * width / bitmap.width)) });
  }
  const width = decoded.reduce((sum, frame) => sum + frame.width, 0) + gap * (decoded.length - 1);
  const height = Math.max(...decoded.map((frame) => frame.height)) + labelHeight;
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#080908'; context.fillRect(0, 0, width, height);
  context.font = '13px Arial'; context.textBaseline = 'middle';
  let x = 0;
  const tiles = [];
  for (const frame of decoded) {
    context.fillStyle = '#171a18'; context.fillRect(x, 0, frame.width, labelHeight);
    context.fillStyle = '#d8ff65'; context.fillText(`DISPLAY ${Number(frame.displayIndex) + 1}`, x + 12, labelHeight / 2);
    context.drawImage(frame.bitmap, x, labelHeight, frame.width, frame.height);
    tiles.push({ sourceId: frame.sourceId, displayIndex: frame.displayIndex, x, y: labelHeight, width: frame.width, height: frame.height });
    frame.bitmap.close();
    x += frame.width + gap;
  }
  const blob = await canvasBlob('image/jpeg', Math.max(.4, Math.min(Number(args.quality || .82), .95)));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), contentType: 'image/jpeg', width, height, tiles };
}

async function handleCommand(payload) {
  const requestId = String(payload && payload.requestId || '');
  const command = String(payload && payload.command || '');
  try {
    let result;
    if (command === 'list') result = { cameras: await enumerateCameras(payload.args || {}) };
    else if (command === 'start') result = await startCamera(payload.args || {});
    else if (command === 'capture') result = await captureFrame(payload.args || {});
    else if (command === 'compose') result = await composeWorkspace(payload.args || {});
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
