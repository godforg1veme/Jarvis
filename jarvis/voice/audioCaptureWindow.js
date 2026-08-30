let audioContext = null;
let sourceNode = null;
let workletNode = null;
let scriptProcessor = null;
let silentGain = null;
let mediaStream = null;
let isCapturing = false;
let isStarting = false;
let captureRequested = false;
let captureGeneration = 0;
let retryTimer = null;
let captureBackend = null;

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

function sendPcm(buffer) {
  if (!buffer || buffer.byteLength === 0) return;
  if (window.jarvisAudioCapture && window.jarvisAudioCapture.sendPcm) {
    window.jarvisAudioCapture.sendPcm(buffer);
  }
}

function connectSilentOutput(node) {
  silentGain = audioContext.createGain();
  silentGain.gain.value = 0;
  node.connect(silentGain);
  silentGain.connect(audioContext.destination);
}

async function startAudioWorklet() {
  if (!audioContext.audioWorklet || typeof window.AudioWorkletNode !== 'function') {
    throw new Error('AudioWorklet is not supported by this Electron runtime.');
  }

  await audioContext.audioWorklet.addModule('pcmCaptureProcessor.js');
  workletNode = new window.AudioWorkletNode(audioContext, 'jarvis-pcm-capture', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    channelCount: 1,
    channelCountMode: 'explicit',
  });
  workletNode.port.onmessage = (event) => {
    if (!isCapturing || !event.data || event.data.type !== 'pcm') return;
    sendPcm(event.data.buffer);
  };
  sourceNode.connect(workletNode);
  connectSilentOutput(workletNode);
  captureBackend = 'audio-worklet';
}

function startScriptProcessor(actualSampleRate) {
  scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);
  scriptProcessor.onaudioprocess = (event) => {
    if (!isCapturing) return;
    const input = event.inputBuffer.getChannelData(0);
    const downsampled = downsample(input, actualSampleRate, 16000);
    sendPcm(floatToPcm16(downsampled));
  };
  sourceNode.connect(scriptProcessor);
  connectSilentOutput(scriptProcessor);
  captureBackend = 'script-processor-fallback';
}

function disconnectNode(node) {
  if (!node) return;
  try { node.disconnect(); } catch (error) {}
}

function releaseAudioResources() {
  disconnectNode(workletNode);
  if (workletNode && workletNode.port) workletNode.port.onmessage = null;
  workletNode = null;
  if (scriptProcessor) {
    scriptProcessor.onaudioprocess = null;
    disconnectNode(scriptProcessor);
    scriptProcessor = null;
  }
  disconnectNode(silentGain);
  silentGain = null;
  disconnectNode(sourceNode);
  sourceNode = null;
  if (audioContext) {
    try { audioContext.close(); } catch (error) {}
    audioContext = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }
}

async function startCapture() {
  captureRequested = true;
  if (isCapturing || isStarting) return;
  if (!window.jarvisAudioCapture) {
    console.error("[audioCapture] jarvisAudioCapture API not available");
    return;
  }

  const generation = ++captureGeneration;
  isStarting = true;
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    if (!captureRequested || generation !== captureGeneration) return;

    audioContext = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: 16000,
    });
    const actualSampleRate = audioContext.sampleRate;

    await audioContext.resume();
    if (!captureRequested || generation !== captureGeneration) return;

    sourceNode = audioContext.createMediaStreamSource(mediaStream);
    isCapturing = true;
    try {
      await startAudioWorklet();
    } catch (workletError) {
      if (!captureRequested || generation !== captureGeneration) return;
      disconnectNode(workletNode);
      workletNode = null;
      disconnectNode(silentGain);
      silentGain = null;
      console.warn('[audioCapture] AudioWorklet unavailable, using fallback:', workletError.message);
      startScriptProcessor(actualSampleRate);
    }
    if (!captureRequested || generation !== captureGeneration) return;

    console.log(`[audioCapture] Microphone capture started (${captureBackend})`);
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  } catch (err) {
    isCapturing = false;
    if (captureRequested && generation === captureGeneration) {
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
  } finally {
    const shouldRestart = captureRequested && generation !== captureGeneration;
    if (!isCapturing || generation !== captureGeneration) {
      isCapturing = false;
      releaseAudioResources();
      captureBackend = null;
    }
    isStarting = false;
    if (shouldRestart) startCapture();
  }
}

function stopCapture() {
  captureRequested = false;
  captureGeneration += 1;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  const stoppedBackend = captureBackend || 'none';
  isCapturing = false;
  releaseAudioResources();
  console.log(`[audioCapture] Microphone capture stopped (${stoppedBackend})`);
  captureBackend = null;
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
