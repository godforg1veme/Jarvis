FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HOME=/models/huggingface \
    TRANSFORMERS_CACHE=/models/huggingface

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg libsndfile1 sox \
  && rm -rf /var/lib/apt/lists/*

COPY server_runtime/qwen-asr/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch==2.7.1+cpu \
  && pip install --no-cache-dir -r requirements.txt

RUN groupadd --system qwen \
  && useradd --system --gid qwen --home-dir /app --shell /usr/sbin/nologin qwen \
  && mkdir -p /models /tmp/qwen-asr \
  && chown -R qwen:qwen /app /models /tmp/qwen-asr

COPY --chown=qwen:qwen server_runtime/qwen-asr/app.py ./app.py

ENV NUMBA_CACHE_DIR=/tmp/numba \
    MPLCONFIGDIR=/tmp/matplotlib

USER qwen
EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=180s --retries=3 \
  CMD python -c "from urllib.request import urlopen; urlopen('http://127.0.0.1:8000/health/ready', timeout=3).read()"

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-access-log"]
