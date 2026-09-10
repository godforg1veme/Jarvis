import asyncio
import gc
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

import gigaam
import torch
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from gigaam.onnx_utils import infer_onnx, load_onnx


MODEL_VERSION = 'v3_e2e_rnnt'
MODEL_CACHE = '/models/checkpoints'
ONNX_DIR = Path('/models/onnx')
TEMP_DIR = Path('/tmp/gigaam-asr')
MAX_UPLOAD_BYTES = 5 * 1024 * 1024
THREADS = 4
REQUIRED_ONNX_FILES = (
    f'{MODEL_VERSION}.yaml',
    f'{MODEL_VERSION}_encoder.onnx',
    f'{MODEL_VERSION}_decoder.onnx',
    f'{MODEL_VERSION}_joint.onnx',
)

torch.set_num_threads(THREADS)
torch.set_num_interop_threads(1)
runtime = None
model_lock = asyncio.Lock()


def onnx_cache_is_complete():
    return all((ONNX_DIR / filename).is_file() for filename in REQUIRED_ONNX_FILES)


def bootstrap_onnx_cache():
    if onnx_cache_is_complete():
        return
    model = gigaam.load_model(
        MODEL_VERSION,
        fp16_encoder=False,
        device='cpu',
        download_root=MODEL_CACHE,
    )
    try:
        model.to_onnx(dir_path=str(ONNX_DIR), dtype=torch.float32)
    finally:
        del model
        gc.collect()
    if not onnx_cache_is_complete():
        raise RuntimeError('incomplete ONNX cache')


def load_runtime():
    ONNX_DIR.mkdir(parents=True, exist_ok=True)
    bootstrap_onnx_cache()
    return load_onnx(str(ONNX_DIR), MODEL_VERSION, provider='CPUExecutionProvider')


def transcribe(path):
    sessions, model_config = runtime
    results = infer_onnx(
        [str(path)],
        model_config,
        sessions,
        batch_size=1,
        num_workers=0,
        progress=False,
    )
    if not results:
        raise RuntimeError('model returned no transcription')
    text = str(results[0]).strip()
    if not text or len(text) > 10000:
        raise RuntimeError('model returned invalid transcription')
    return text


@asynccontextmanager
async def lifespan(_app):
    global runtime
    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    runtime = await asyncio.to_thread(load_runtime)
    yield
    runtime = None


app = FastAPI(title='Jarvis private GigaAM ASR worker', docs_url=None, redoc_url=None, lifespan=lifespan)


@app.get('/health/ready')
async def readiness():
    if runtime is None:
        raise HTTPException(status_code=503, detail='model unavailable')
    return {'ok': True, 'model': MODEL_VERSION}


@app.post('/v1/audio/transcriptions')
async def create_transcription(
    file: UploadFile = File(...),
    model_name: str = Form('', alias='model'),
    language: str = Form('', max_length=12),
    response_format: str = Form('json'),
):
    del model_name, language, response_format
    if runtime is None:
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
            text = await asyncio.to_thread(transcribe, path)
        return {'text': text, 'language': 'ru'}
    except Exception:
        raise HTTPException(status_code=503, detail='transcription unavailable') from None
    finally:
        if path:
            path.unlink(missing_ok=True)
