@echo off
REM AK Music Player — start on Windows. Double-click this file, then open http://localhost:8000
cd /d "%~dp0"
where python >nul 2>nul || (echo Python 3.10+ is required: https://www.python.org/downloads/ & pause & exit /b 1)
where ffmpeg >nul 2>nul || echo WARNING: FFmpeg not found. Playback works, but MP3/FLAC downloads need it. Install: winget install Gyan.FFmpeg
where deno >nul 2>nul || where node >nul 2>nul || echo WARNING: Deno or Node.js not found. YouTube links need one. Install: winget install DenoLand.Deno
if not exist .venv python -m venv .venv
call .venv\Scripts\activate.bat
python -m pip install -q --upgrade pip
pip install -q -r backend\requirements.txt
pip install -q -U "yt-dlp[default]"
echo.
echo   AK Music Player is running at http://localhost:8000
echo.
cd backend
python -m uvicorn app:app --host 0.0.0.0 --port 8000
pause
