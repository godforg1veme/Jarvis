FROM python:3.12-slim@sha256:2b4f19dae3a777dfc3b76730bda1e82e1f66ab2a2686fa93ca78edbfb4f04ffe
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 OMP_THREAD_LIMIT=1
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 libgomp1 && rm -rf /var/lib/apt/lists/*
COPY requirements.lock /opt/requirements.lock
RUN python -m pip install --no-cache-dir --only-binary=:all: --no-deps --require-hashes -r /opt/requirements.lock
WORKDIR /opt/worker
COPY model.json characters.json /opt/ocr-model/
COPY fetch_model.py /opt/fetch_model.py
RUN python /opt/fetch_model.py && rm /opt/fetch_model.py && mkdir -p /run/job-ocr && chown 1001:1001 /run/job-ocr && chmod 0700 /run/job-ocr
COPY worker.py health.py ./
COPY LICENSES /usr/share/licenses/jarvis-job-ocr/
USER 1001:1001
CMD ["python", "worker.py"]
