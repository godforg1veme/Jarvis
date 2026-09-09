import asyncio
import os
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

import torch
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from qwen_asr import Qwen3ASRModel


MODEL_ID = os.environ.get('QWEN_ASR_MODEL', 'Qwen/Qwen3-ASR-1.7B').strip()
MODEL_REVISION = os.environ.get('QWEN_ASR_MODEL_REVISION', '').strip()
MAX_UPLOAD_BYTES = 5 * 1024 * 1024
TEMP_DIR = Path('/tmp/qwen-asr')
LANGUAGE_NAMES = {
    'ru': 'Russian',
    'russian': 'Russian',
    'en': 'English',
    'english': 'English',
}

model = None
model_lock = asyncio.Lock()


def load_model():
    kwargs = {
        'dtype': torch.bfloat16,
        'device_map': 'cpu',
        'max_inference_batch_size': 1,
        'max_new_tokens': 256,
    }
    if MODEL_REVISION:
        kwargs['revision'] = MODEL_REVISION
    return Qwen3ASRModel.from_pretrained(MODEL_ID, **kwargs)


def normalize_language(value):
    key = str(value or '').strip().lower()
    return LANGUAGE_NAMES.get(key) if key else None


def transcribe(path, language):
    results = model.transcribe(audio=str(path), language=language)
    if not results:
        raise RuntimeError('model returned no transcription')
    result = results[0]
    text = str(getattr(result, 'text', '')).strip()
    if not text or len(text) > 10000:
        raise RuntimeError('model returned invalid transcription')
    return {
        'text': text,
        'language': str(getattr(result, 'language', '') or language or '').strip()[:12],
    }


@asynccontextmanager
async def lifespan(_app):
    global model
    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    model = await asyncio.to_thread(load_model)
    yield
    model = None


app = FastAPI(title='Jarvis private Qwen3-ASR worker', docs_url=None, redoc_url=None, lifespan=lifespan)


@app.get('/health/ready')
async def readiness():
    if model is None:
        raise HTTPException(status_code=503, detail='model unavailable')
    return {'ok': True, 'model': MODEL_ID}


@app.post('/v1/audio/transcriptions')
async def create_transcription(
    file: UploadFile = File(...),
    model_name: str = Form('', alias='model'),
    language: str = Form('', max_length=12),
    response_format: str = Form('json'),
):
    del model_name, response_format
    if model is None:
        raise HTTPException(status_code=503, detail='model unavailable')

    audio = await file.read(MAX_UPLOAD_BYTES + 1)
    if not audio or len(audio) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail='invalid audio')

    path = None
    try:
        with tempfile.NamedTemporaryFile(mode='wb', suffix='.wav', dir=TEMP_DIR, delete=False) as temporary:
            temporary.write(audio)
            path = Path(temporary.name)
        async with model_lock:
            result = await asyncio.to_thread(transcribe, path, normalize_language(language))
        return result
    except Exception:
        raise HTTPException(status_code=503, detail='transcription unavailable') from None
    finally:
        if path:
            path.unlink(missing_ok=True)
