# Elsewhere API (FastAPI). Build from the repo root so prompts and demo data are included.
FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY services/api/requirements.txt services/api/requirements.txt
RUN pip install --no-cache-dir -r services/api/requirements.txt
COPY services/api services/api
COPY packages/prompts packages/prompts
COPY demo demo
WORKDIR /app/services/api
ENV PORT=8000 PYTHONUNBUFFERED=1
# One worker on purpose: SSE wake-ups, per-simulation locks and rate limits live in process.
CMD ["sh", "-c", "uvicorn elsewhere.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
