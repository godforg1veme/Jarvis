let audioContext = null;
let sourceNode = null;
let scriptProcessor = null;
let mediaStream = null;
let isCapturing = false;
let retryTimer = null;

function downsample(buffer, sourceRate, targetRate) {
  if (sourceRate === targetRate) return buffer;
  const ratio = sourceRate / targetRate;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i += 1) {
    const index = i * ratio;
    const indexFloor = Math.floor(index);
    const indexCeil = Math.min(indexFloor + 1, buffer.length - 1);
    const fraction = index - indexFloor;
    result[i] = buffer[indexFloor] * (1 - fraction) + buffer[indexCeil] * fraction;
  }
  return result;
}

function floatToPcm16(float32Array) {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < float32Array.length; i += 1) {
    let sample = Math.max(-1, Math.min(1, float32Array[i]));
    sample *= 32767;
    view.setInt16(i * 2, sample, true);
  }
  return buffer;
}

async function startCapture() {
  if (isCapturing) return;
  if (!window.jarvisAudioCapture) {
    console.error("[audioCapture] jarvisAudioCapture API not available");
    return;
  }

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    audioContext = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: 16000,
    });
    const actualSampleRate = audioContext.sampleRate;

    await audioContext.resume();

    sourceNode = audioContext.createMediaStreamSource(mediaStream);
    scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);

    scriptProcessor.onaudioprocess = (event) => {
      if (!isCapturing) return;
      const input = event.inputBuffer.getChannelData(0);
      const downsampled = downsample(input, actualSampleRate, 16000);
      const pcm16 = floatToPcm16(downsampled);
      if (window.jarvisAudioCapture && window.jarvisAudioCapture.sendPcm) {
        window.jarvisAudioCapture.sendPcm(pcm16);
      }
    };

    sourceNode.connect(scriptProcessor);
    scriptProcessor.connect(audioContext.destination);

    isCapturing = true;
    console.log("[audioCapture] Microphone capture started");
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  } catch (err) {
    console.error("[audioCapture] Failed to start capture:", err);
    if (window.jarvisAudioCapture && window.jarvisAudioCapture.sendError) {
      window.jarvisAudioCapture.sendError(err.message);
    }
    if (!retryTimer) {
      retryTimer = setTimeout(() => {
        retryTimer = null;
        startCapture();
      }, 5000);
    }
  }
}

function stopCapture() {
  isCapturing = false;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  if (scriptProcessor) {
    try { scriptProcessor.disconnect(); } catch (e) {}
    scriptProcessor = null;
  }
  if (sourceNode) {
    try { sourceNode.disconnect(); } catch (e) {}
    sourceNode = null;
  }
  if (audioContext) {
    try { audioContext.close(); } catch (e) {}
    audioContext = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }
  console.log("[audioCapture] Microphone capture stopped");
}

document.addEventListener("DOMContentLoaded", () => {
  if (window.jarvisAudioCapture && window.jarvisAudioCapture.onCommand) {
    window.jarvisAudioCapture.onCommand((command) => {
      if (command === "start") {
        startCapture();
      } else if (command === "stop") {
        stopCapture();
      }
    });
  }
});
