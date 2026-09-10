FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    OMP_NUM_THREADS=4 \
    MKL_NUM_THREADS=4 \
    OPENBLAS_NUM_THREADS=4

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends libsndfile1 \
  && rm -rf /var/lib/apt/lists/*

COPY server_runtime/gigaam-asr/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch==2.8.0+cpu torchaudio==2.8.0+cpu \
  && pip install --no-cache-dir -r requirements.txt

RUN groupadd --system gigaam \
  && useradd --system --gid gigaam --home-dir /app --shell /usr/sbin/nologin gigaam \
  && mkdir -p /models/checkpoints /models/onnx \
  && chown -R gigaam:gigaam /app /models

COPY --chown=gigaam:gigaam server_runtime/gigaam-asr/app.py ./app.py

USER gigaam

HEALTHCHECK --interval=15s --timeout=5s --start-period=300s --retries=3 \
  CMD python -c "from urllib.request import urlopen; response = urlopen('http://127.0.0.1:8000/health/ready', timeout=3); assert response.status == 200"

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-access-log"]
