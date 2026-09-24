import math
import sys
from pathlib import Path
from types import SimpleNamespace


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "stt_runtime"))

from faster_whisper_worker import FasterWhisperStream


stream = FasterWhisperStream({
    "maxNoSpeechProb": 0.6,
    "minAvgLogProb": -1.0,
})

accepted = SimpleNamespace(text="джарвис открой браузер", no_speech_prob=0.05, avg_logprob=-0.2)
likely_noise = SimpleNamespace(text="джарвис запусти доту", no_speech_prob=0.92, avg_logprob=-0.1)
low_confidence = SimpleNamespace(text="джарвис запусти доту", no_speech_prob=0.05, avg_logprob=-1.8)
missing_metadata = SimpleNamespace(text="джарвис запусти доту", no_speech_prob=math.nan, avg_logprob=-0.1)

assert stream.is_confident_segment(accepted)
assert not stream.is_confident_segment(likely_noise)
assert not stream.is_confident_segment(low_confidence)
assert not stream.is_confident_segment(missing_metadata)

print('[test] Faster Whisper quality filter OK')
