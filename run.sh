#!/usr/bin/env bash
# AK Music Player — start on macOS / Linux.  Usage: ./run.sh   (then open http://localhost:8000)
set -e
cd "$(dirname "$0")"
command -v python3 >/dev/null || { echo "Python 3.10+ is required: https://www.python.org/downloads/"; exit 1; }
command -v ffmpeg >/dev/null || echo "⚠  FFmpeg not found — playback works, but MP3/FLAC downloads need it. macOS: brew install ffmpeg | Ubuntu: sudo apt install ffmpeg"
command -v deno >/dev/null || command -v node >/dev/null || echo "⚠  Deno or Node.js not found — YouTube links need one. Install: curl -fsSL https://deno.land/install.sh | sh"
if [ ! -d .venv ]; then python3 -m venv .venv; fi
source .venv/bin/activate
pip install -q --upgrade pip
pip install -q -r backend/requirements.txt
pip install -q -U "yt-dlp[default]"
PORT="${PORT:-8000}"
echo ""
echo "  AK Music Player is running →  http://localhost:$PORT"
echo "  On your phone (same Wi-Fi) → http://$( (hostname -I 2>/dev/null || ipconfig getifaddr en0 2>/dev/null) | awk '{print $1}'):$PORT"
echo ""
cd backend && exec python -m uvicorn app:app --host 0.0.0.0 --port "$PORT"
