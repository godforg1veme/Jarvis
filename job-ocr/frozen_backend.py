"""Original fine-tuned Paddle pipeline behind the existing bounded PNG contract."""
import contextlib
import hashlib
import io
import json
import math
from pathlib import Path
import sys
import warnings
from worker import image_from_bytes, valid_answer

ROOT = Path('/opt/frozen-hh')


def verify_bundle(root, manifest_sha256):
    root = Path(root).resolve()
    manifest_path = root / 'bundle.json'
    if hashlib.sha256(manifest_path.read_bytes()).hexdigest() != manifest_sha256:
        raise ValueError('OCR_MODEL_REJECTED')
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    if set(manifest) != {'sourceRevision', 'files'} or not isinstance(manifest['files'], dict):
        raise ValueError('OCR_MODEL_REJECTED')
    for name, expected in manifest['files'].items():
        path = root / name
        if Path(name).is_absolute() or '..' in Path(name).parts or path.is_symlink() or not path.resolve().is_relative_to(root):
            raise ValueError('OCR_MODEL_REJECTED')
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise ValueError('OCR_MODEL_REJECTED')
    actual = {p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file()
              and '__pycache__' not in p.parts and p.name != 'bundle.json'}
    if actual != set(manifest['files']):
        raise ValueError('OCR_MODEL_REJECTED')
    return manifest


class FrozenRecognizer:
    def __init__(self, root=ROOT, manifest_sha256=None, device='cpu'):
        # The deployment image pins this digest; no request can select it.
        if manifest_sha256 is None:
            manifest_sha256 = Path('/opt/frozen-bundle.sha256').read_text().strip()
        verify_bundle(root, manifest_sha256)
        sys.path.insert(0, str(Path(root).resolve()))
        # Upstream imports print informational messages; no dependency output
        # belongs in the worker's closed diagnostic stream.
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()), warnings.catch_warnings():
            warnings.simplefilter('ignore')
            from recognition_pipeline import Recognizer
            self.model = Recognizer(Path(root) / 'experiments/recognition_v2/frozen_config.json', device=device)

    def predict_image(self, image):
        return self.predict_images([image])[0]

    def predict_images(self, images):
        import numpy as np
        # The trained geometry is 250x90. Do not silently resize other styles.
        if not 1 <= len(images) <= 32 or any(image.size != (250, 90) for image in images):
            raise ValueError('OCR_INPUT_REJECTED')
        bgr = [np.asarray(image.convert('RGB'))[:, :, ::-1].copy() for image in images]
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()), warnings.catch_warnings():
            warnings.simplefilter('ignore')
            result = self.model.predict(bgr)
        if not isinstance(result, list) or len(result) != len(images) or any(len(item) != 2 for item in result):
            raise ValueError('OCR_RESULT_REJECTED')
        for text, score in result:
            if not isinstance(text, str) or not isinstance(score, (float, int)) or not math.isfinite(score):
                raise ValueError('OCR_RESULT_REJECTED')
        return result

    def recognize(self, data):
        text, _ = self.predict_image(image_from_bytes(data))
        # The trained score is not a calibrated whole-string probability.
        # Use the frozen selection without inventing a confidence threshold.
        if not valid_answer(text):
            raise ValueError('OCR_NO_CONSENSUS')
        return text
