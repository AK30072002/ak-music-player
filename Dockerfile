FROM python:3.12-slim

# ffmpeg: audio extraction + MP3/FLAC conversion. deno: JavaScript runtime yt-dlp needs for YouTube.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl unzip \
    && rm -rf /var/lib/apt/lists/*
COPY --from=denoland/deno:bin /deno /usr/local/bin/deno

WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend backend
COPY frontend frontend

ENV AK_DATA=/data
VOLUME ["/data"]
EXPOSE 8000
WORKDIR /app/backend
# keep yt-dlp current on every start: sites change often and old versions stop working
CMD ["sh", "-c", "pip install -q -U 'yt-dlp[default]' || true; exec uvicorn app:app --host 0.0.0.0 --port 8000"]
