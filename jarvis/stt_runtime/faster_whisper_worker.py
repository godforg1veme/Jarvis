import argparse
import json
import math
import os
import sys
from collections import deque
from pathlib import Path

from stt_frame_protocol import (
    FRAME_TYPE_CONTROL,
    FRAME_TYPE_PCM,
    SttFrameProtocolError,
    decode_control,
    read_frames,
)
from stt_profiles import resolve_performance_profile

try:
    import numpy as np
except Exception as exc:
    sys.stdout.write(json.dumps({
        "type": "error",
        "message": f"numpy import failed: {exc}",
    }) + "\n")
    sys.stdout.flush()
    sys.exit(1)


ROOT = Path(__file__).resolve().parents[1]
SAMPLE_RATE = 16000
DLL_DIR_HANDLES = []


def send(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def log(message):
    print(f"[faster-whisper-worker] {message}", file=sys.stderr, flush=True)


def add_cuda_dll_directories():
    if os.name != "nt":
        return

    site_packages = Path(sys.prefix) / "Lib" / "site-packages"
    candidates = [
        site_packages / "nvidia" / "cublas" / "bin",
        site_packages / "nvidia" / "cudnn" / "bin",
        site_packages / "nvidia" / "cuda_nvrtc" / "bin",
    ]

    existing = [str(path) for path in candidates if path.exists()]
    if not existing:
        return

    os.environ["PATH"] = os.pathsep.join(existing + [os.environ.get("PATH", "")])
    if hasattr(os, "add_dll_directory"):
        for directory in existing:
            DLL_DIR_HANDLES.append(os.add_dll_directory(directory))

    log("CUDA DLL paths: " + "; ".join(existing))


def load_settings(settings_path):
    with open(settings_path, "r", encoding="utf-8") as handle:
        settings = json.load(handle)
    return settings.get("fasterWhisper", {})


def pcm_rms(pcm_bytes):
    if not pcm_bytes:
        return 0.0
    samples = np.frombuffer(pcm_bytes, dtype=np.int16)
    if samples.size == 0:
        return 0.0
    float_samples = samples.astype(np.float32) / 32768.0
    return float(math.sqrt(float(np.mean(float_samples * float_samples))))


def pcm_duration_ms(pcm_bytes):
    return (len(pcm_bytes) / 2) / SAMPLE_RATE * 1000.0


def pcm_to_float32(pcm_bytes):
    samples = np.frombuffer(pcm_bytes, dtype=np.int16)
    return samples.astype(np.float32) / 32768.0


class FasterWhisperStream:
    def __init__(self, settings):
        self.settings = settings
        self.model = None
        self.pre_roll = deque()
        self.recording = False
        self.audio_chunks = []
        self.speech_ms = 0.0
        self.silence_ms = 0.0
        self.total_ms = 0.0

        self.min_speech_ms = float(settings.get("minSpeechMs", 450))
        self.silence_limit_ms = float(settings.get("silenceMs", 900))
        self.max_segment_ms = float(settings.get("maxSegmentMs", 10000))
        self.pre_roll_ms = float(settings.get("preRollMs", 300))
        self.start_rms = float(settings.get("startRms", 0.012))
        self.continue_rms = float(settings.get("continueRms", 0.006))

    def load(self):
        add_cuda_dll_directories()
        try:
            from faster_whisper import WhisperModel
        except Exception as exc:
            raise RuntimeError(
                f"faster-whisper import failed: {exc}. Run node scripts/ensureStt.js."
            ) from exc

        model_name = self.settings.get("model", "small")
        device = self.settings.get("device", "cuda")
        compute_type = self.settings.get("computeType", "int8_float16")
        profile, beam_size, vad_filter = resolve_performance_profile(self.settings)
        log(
            f"loading model={model_name} device={device} compute_type={compute_type} "
            f"profile={profile} beam_size={beam_size} vad_filter={vad_filter}"
        )
        self.model = WhisperModel(model_name, device=device, compute_type=compute_type)
        send({
            "type": "ready",
            "provider": "faster-whisper",
            "model": model_name,
            "device": device,
            "computeType": compute_type,
            "performanceProfile": profile,
        })
        log("model loaded")

    def reset_segment(self):
        self.recording = False
        self.audio_chunks = []
        self.speech_ms = 0.0
        self.silence_ms = 0.0
        self.total_ms = 0.0

    def remember_pre_roll(self, pcm_bytes, duration_ms):
        self.pre_roll.append((pcm_bytes, duration_ms))
        total = sum(item[1] for item in self.pre_roll)
        while self.pre_roll and total > self.pre_roll_ms:
            _, removed_ms = self.pre_roll.popleft()
            total -= removed_ms

    def handle_pcm(self, pcm_bytes):
        duration_ms = pcm_duration_ms(pcm_bytes)
        rms = pcm_rms(pcm_bytes)

        if not self.recording:
            self.remember_pre_roll(pcm_bytes, duration_ms)
            if rms < self.start_rms:
                return

            self.recording = True
            self.audio_chunks = [chunk for chunk, _duration in self.pre_roll]
            self.speech_ms = duration_ms
            self.silence_ms = 0.0
            self.total_ms = sum(item[1] for item in self.pre_roll)
            send({"type": "partial", "text": "..."})
            return

        self.audio_chunks.append(pcm_bytes)
        self.total_ms += duration_ms

        if rms >= self.continue_rms:
            self.speech_ms += duration_ms
            self.silence_ms = 0.0
        else:
            self.silence_ms += duration_ms

        if self.should_finalize():
            self.finalize_segment()

    def should_finalize(self):
        if self.total_ms >= self.max_segment_ms:
            return True
        return self.speech_ms >= self.min_speech_ms and self.silence_ms >= self.silence_limit_ms

    def finalize_segment(self):
        pcm_bytes = b"".join(self.audio_chunks)
        self.reset_segment()
        if pcm_duration_ms(pcm_bytes) < self.min_speech_ms:
            return

        try:
            text = self.transcribe(pcm_bytes)
        except Exception as exc:
            send({"type": "error", "message": f"faster-whisper transcription failed: {exc}"})
            log(f"transcription failed: {exc}")
            return

        if text:
            send({
                "type": "final",
                "text": text,
            })

    def transcribe(self, pcm_bytes):
        audio = pcm_to_float32(pcm_bytes)
        language = self.settings.get("language") or "ru"
        _profile, beam_size, vad_filter = resolve_performance_profile(self.settings)
        initial_prompt = self.settings.get("initialPrompt") or None
        hotwords = self.settings.get("hotwords") or None

        kwargs = {
            "language": language,
            "task": "transcribe",
            "beam_size": beam_size,
            "vad_filter": vad_filter,
            "condition_on_previous_text": False,
            "initial_prompt": initial_prompt,
        }
        if hotwords:
            kwargs["hotwords"] = hotwords

        segments, _info = self.model.transcribe(audio, **kwargs)
        parts = [segment.text.strip() for segment in segments if segment.text and segment.text.strip()]
        return " ".join(parts).strip()

    def stop(self):
        if self.recording and self.audio_chunks:
            self.finalize_segment()
        send({"type": "stopped"})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--settings", default=str(ROOT / "data" / "stt-settings.json"))
    args = parser.parse_args()

    try:
        settings = load_settings(args.settings)
        stream = FasterWhisperStream(settings)
        stream.load()
    except Exception as exc:
        send({"type": "error", "message": f"faster-whisper init failed: {exc}"})
        log(f"init failed: {exc}")
        sys.exit(1)

    try:
        for frame_type, payload in read_frames(sys.stdin.buffer):
            if frame_type == FRAME_TYPE_PCM:
                try:
                    stream.handle_pcm(payload)
                except Exception as exc:
                    send({"type": "error", "message": f"Processing error: {exc}"})
                    log(f"processing error: {exc}")
                continue

            if frame_type == FRAME_TYPE_CONTROL:
                message = decode_control(payload)
                if message.get("type") == "stop":
                    stream.stop()
                    return
                send({
                    "type": "error",
                    "message": f"Unknown control message type: {message.get('type')}",
                })
    except SttFrameProtocolError as exc:
        send({"type": "error", "message": f"STT input protocol error: {exc}"})
        log(f"input protocol error: {exc}")


if __name__ == "__main__":
    main()
