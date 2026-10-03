"""
AK Music Player — a self-hosted, ad-free music player for links.

Paste a YouTube / Instagram / SoundCloud / Vimeo / TikTok / Bandcamp / ... link
(anything yt-dlp understands), play it, build playlists, and download tracks.

Run:  uvicorn app:app --host 0.0.0.0 --port 8000   (from the backend folder)
"""
from __future__ import annotations

import io
import json
import mimetypes
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
import uuid
import zipfile
from contextlib import contextmanager
from pathlib import Path
from typing import Optional

import yt_dlp

import musiclinks
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# ---------------------------------------------------------------- paths & config
BASE = Path(__file__).resolve().parent.parent
FRONTEND = Path(os.environ.get("AK_FRONTEND", BASE / "frontend")).resolve()
DATA = Path(os.environ.get("AK_DATA", BASE / "data")).resolve()
AUDIO_DIR = DATA / "audio"
COVER_DIR = DATA / "covers"
EXPORT_DIR = DATA / "exports"
DB_PATH = DATA / "ak-music.db"
for d in (DATA, AUDIO_DIR, COVER_DIR, EXPORT_DIR):
    d.mkdir(parents=True, exist_ok=True)

COOKIES_FILE = os.environ.get("AK_COOKIES")              # path to a cookies.txt (Netscape format)
COOKIES_BROWSER = os.environ.get("AK_COOKIES_BROWSER")   # e.g. "chrome", "firefox"
MP3_BITRATE = os.environ.get("AK_MP3_BITRATE", "320k")
ON_ANDROID = os.environ.get("AK_PLATFORM") == "android"   # running inside the Android app
HAS_FFMPEG = shutil.which("ffmpeg") is not None
HAS_FFPROBE = shutil.which("ffprobe") is not None
APP_VERSION = "2.0.0"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"

AUDIO_TYPES = {
    ".m4a": "audio/mp4", ".mp4": "audio/mp4", ".aac": "audio/aac", ".mp3": "audio/mpeg",
    ".webm": "audio/webm", ".opus": "audio/ogg", ".ogg": "audio/ogg", ".flac": "audio/flac",
    ".wav": "audio/wav",
}


# ---------------------------------------------------------------- database
SCHEMA = """
CREATE TABLE IF NOT EXISTS tracks (
    id TEXT PRIMARY KEY,
    source_url TEXT NOT NULL,
    platform TEXT,
    title TEXT,
    artist TEXT,
    album TEXT,
    duration REAL,
    thumbnail TEXT,
    status TEXT DEFAULT 'new',        -- new | ready | error
    error TEXT,
    file TEXT,
    liked INTEGER DEFAULT 0,
    liked_at REAL,
    play_count INTEGER DEFAULT 0,
    added_at REAL,
    last_played REAL
);
CREATE TABLE IF NOT EXISTS playlists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    source_url TEXT,
    pinned INTEGER DEFAULT 0,
    created_at REAL,
    updated_at REAL
);
CREATE TABLE IF NOT EXISTS playlist_tracks (
    playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    added_at REAL,
    PRIMARY KEY (playlist_id, track_id)
);
CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    played_at REAL
);
CREATE INDEX IF NOT EXISTS idx_history_time ON history(played_at DESC);
CREATE INDEX IF NOT EXISTS idx_pt_pos ON playlist_tracks(playlist_id, position);
"""


@contextmanager
def db():
    con = sqlite3.connect(DB_PATH, timeout=30)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    try:
        yield con
        con.commit()
    finally:
        con.close()


with db() as _c:
    _c.execute("PRAGMA journal_mode = WAL")
    _c.executescript(SCHEMA)


def dump(model) -> dict:
    return model.model_dump() if hasattr(model, "model_dump") else model.dict()


def row(r):
    return dict(r) if r else None


def track_out(r) -> dict:
    t = dict(r)
    t["liked"] = bool(t.get("liked"))
    t["cover"] = f"/api/tracks/{t['id']}/cover" if (t.get("thumbnail") or _cover_path(t["id"])) else None
    f = t.pop("file", None)
    t["ext"] = Path(f).suffix if f else None
    return t


# ---------------------------------------------------------------- yt-dlp helpers
JS_RUNTIMES = {name: {"path": p} for name, exe in
               (("deno", "deno"), ("node", "node"), ("bun", "bun"), ("quickjs", "qjs"))
               if (p := shutil.which(exe))}


def ydl_base_opts() -> dict:
    o = {
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "noplaylist": True,
        "http_headers": {"User-Agent": UA},
        "socket_timeout": 30,
        "retries": 3,
    }
    if JS_RUNTIMES:
        o["js_runtimes"] = dict(JS_RUNTIMES)
    if ON_ANDROID:
        # if a self-updated yt-dlp needs a newer YouTube solver than the one bundled, fetch it from yt-dlp's GitHub
        o["remote_components"] = ["ejs:github"]
    if COOKIES_FILE and Path(COOKIES_FILE).exists() and Path(COOKIES_FILE).stat().st_size > 40:
        o["cookiefile"] = COOKIES_FILE
    if COOKIES_BROWSER:
        o["cookiesfrombrowser"] = (COOKIES_BROWSER,)
    return o


def safe_id(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]", "_", s)[:120]


PLATFORM_NAMES = {
    "youtube": "YouTube", "youtubetab": "YouTube", "instagram": "Instagram", "soundcloud": "SoundCloud",
    "tiktok": "TikTok", "vimeo": "Vimeo", "bandcamp": "Bandcamp", "facebook": "Facebook",
    "twitter": "X", "reddit": "Reddit", "dailymotion": "Dailymotion", "mixcloud": "Mixcloud",
    "audiomack": "Audiomack", "generic": "Web", "upload": "Upload",
}


def platform_of(extractor: str) -> str:
    key = (extractor or "generic").lower()
    for k, v in PLATFORM_NAMES.items():
        if key.startswith(k):
            return v
    return extractor.split(":")[0].capitalize() if extractor else "Web"


def best_thumb(info: dict) -> Optional[str]:
    if info.get("thumbnail"):
        return info["thumbnail"]
    thumbs = info.get("thumbnails") or []
    thumbs = [t for t in thumbs if t.get("url")]
    if not thumbs:
        return None
    thumbs.sort(key=lambda t: (t.get("preference") or 0, (t.get("width") or 0) * (t.get("height") or 0)))
    return thumbs[-1]["url"]


def split_title(info: dict) -> tuple[str, str]:
    """Best guess at (title, artist)."""
    title = info.get("track") or info.get("title") or "Untitled"
    artist = info.get("artist") or info.get("creator") or ""
    if isinstance(artist, list):
        artist = ", ".join(artist)
    if not artist and not info.get("track") and " - " in title:
        a, t = title.split(" - ", 1)
        if 0 < len(a) < 60:
            artist, title = a.strip(), t.strip()
    if not artist:
        artist = info.get("uploader") or info.get("channel") or ""
    artist = re.sub(r"\s*-\s*Topic$", "", artist or "").strip()
    # strip common noise from titles
    title = re.sub(r"\s*[\(\[](official\s*(music\s*)?(video|audio|lyric video|visualizer)|lyrics?|hd|4k|audio)[\)\]]",
                   "", title, flags=re.I).strip() or title
    return title, artist


def upsert_track(con, info: dict, source_url: str) -> dict:
    extractor = info.get("extractor_key") or info.get("ie_key") or info.get("extractor") or "generic"
    vid = info.get("id") or uuid.uuid5(uuid.NAMESPACE_URL, source_url).hex
    tid = safe_id(f"{extractor}-{vid}".lower())
    existing = con.execute("SELECT * FROM tracks WHERE id=?", (tid,)).fetchone()
    if existing:
        return track_out(existing)
    title, artist = split_title(info)
    con.execute(
        """INSERT INTO tracks (id, source_url, platform, title, artist, album, duration, thumbnail, status, added_at)
           VALUES (?,?,?,?,?,?,?,?, 'new', ?)""",
        (tid, source_url, platform_of(extractor), title, artist, info.get("album") or "",
         info.get("duration"), best_thumb(info), time.time()),
    )
    return track_out(con.execute("SELECT * FROM tracks WHERE id=?", (tid,)).fetchone())


def entry_url(entry: dict) -> Optional[str]:
    url = entry.get("webpage_url") or entry.get("url")
    if not url:
        return None
    if not url.startswith("http"):
        ie = (entry.get("ie_key") or "").lower()
        if ie.startswith("youtube"):
            return f"https://www.youtube.com/watch?v={url}"
        return None
    return url


# ---------------------------------------------------------------- audio fetching
_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def lock_for(tid: str) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(tid, threading.Lock())


def find_audio(tid: str) -> Optional[Path]:
    for p in AUDIO_DIR.glob(f"{tid}.*"):
        if p.suffix.lower() in AUDIO_TYPES and not p.name.endswith(".part"):
            return p
    return None


def _cover_path(tid: str) -> Optional[Path]:
    for p in COVER_DIR.glob(f"{tid}.*"):
        return p
    return None


def cache_cover(tid: str, url: Optional[str]):
    if not url or _cover_path(tid):
        return
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=15) as r:
            ctype = r.headers.get("Content-Type", "image/jpeg").split(";")[0]
            data = r.read(5_000_000)
        ext = mimetypes.guess_extension(ctype) or ".jpg"
        if ext == ".jpe":
            ext = ".jpg"
        (COVER_DIR / f"{tid}{ext}").write_bytes(data)
    except Exception:
        pass


def ensure_audio(tid: str) -> Path:
    """Download the audio for a track into the cache (once) and return its path."""
    with db() as con:
        t = con.execute("SELECT * FROM tracks WHERE id=?", (tid,)).fetchone()
    if not t:
        raise HTTPException(404, "Track not found")
    if t["file"] and os.path.isabs(t["file"]):          # a song that lives on the phone itself
        p = Path(t["file"])
        if p.exists():
            return p
        raise HTTPException(404, "This song is no longer on the phone")
    existing = find_audio(tid)
    if existing:
        return existing
    with lock_for(tid):
        existing = find_audio(tid)
        if existing:
            return existing
        source = t["source_url"]
        if source.startswith(MUSIC_SEARCH):          # a song shared from Spotify, Apple Music, …
            q = urllib.parse.parse_qs(source[len(MUSIC_SEARCH):])
            want = (q.get("d") or [""])[0]
            try:
                source = find_youtube((q.get("q") or [""])[0], float(want) if want else None)
            except HTTPException as e:
                with db() as con:
                    con.execute("UPDATE tracks SET status='error', error=? WHERE id=?", (e.detail, tid))
                raise
        opts = ydl_base_opts()
        opts.update({
            "format": "bestaudio[ext=m4a]/bestaudio[acodec^=mp4a]/bestaudio/best",
            "outtmpl": str(AUDIO_DIR / f"{tid}.%(ext)s"),
        })
        if HAS_FFMPEG:
            # keeps the original audio stream (no re-encode) and drops any video
            opts["postprocessors"] = [{"key": "FFmpegExtractAudio", "preferredcodec": "best"}]
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(source, download=True)
        except Exception as e:
            msg = clean_err(e)
            with db() as con:
                con.execute("UPDATE tracks SET status='error', error=? WHERE id=?", (msg, tid))
            raise HTTPException(502, msg)
        path = find_audio(tid)
        if not path:
            with db() as con:
                con.execute("UPDATE tracks SET status='error', error='No playable audio found' WHERE id=?", (tid,))
            raise HTTPException(502, "No playable audio found in that link")
        dur = (info or {}).get("duration") or t["duration"] or probe_duration(path)
        with db() as con:
            con.execute("UPDATE tracks SET status='ready', error=NULL, file=?, duration=? WHERE id=?",
                        (path.name, dur, tid))
        cache_cover(tid, t["thumbnail"] or best_thumb(info or {}))
        return path


def ffmpeg_info(path: Path) -> dict:
    """Duration and tags using only ffmpeg (Android ships ffmpeg without ffprobe)."""
    out = {"duration": None, "title": "", "artist": ""}
    if not HAS_FFMPEG:
        return out
    r = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(path)], capture_output=True, text=True, errors="replace")
    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", r.stderr)
    if m:
        out["duration"] = int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3])
    for key in ("title", "artist"):
        t = re.search(rf"^\s+{key}\s*:\s*(.+)$", r.stderr, re.M | re.I)
        if t:
            out[key] = t[1].strip()
    return out


def probe_duration(path: Path) -> Optional[float]:
    if not HAS_FFPROBE:
        return ffmpeg_info(path)["duration"]
    r = subprocess.run(["ffprobe", "-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                       capture_output=True, text=True)
    try:
        return float(r.stdout.strip())
    except ValueError:
        return None


MUSIC_SEARCH = "music-search:"
_SKIP_WORDS = ("live", "cover", "karaoke", "remix", "8d", "slowed", "reverb", "nightcore", "instrumental",
               "sped up", "lofi", "lo-fi", "reaction", "tutorial", "lesson", "mashup", "bass boosted")


def find_youtube(query: str, duration: Optional[float] = None) -> str:
    """Best YouTube match for a song from a music app: early result, right length, not a cover/live/remix."""
    opts = ydl_base_opts()
    opts.update({"extract_flat": "in_playlist", "skip_download": True, "noplaylist": False})
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(f"ytsearch8:{query}", download=False)
    except Exception as e:
        raise HTTPException(502, clean_err(e))
    entries = [e for e in (info or {}).get("entries") or [] if e and e.get("id")]
    if not entries:
        raise HTTPException(404, "Couldn't find this song on YouTube")
    q = query.lower()

    def score(item):
        i, e = item
        title = (e.get("title") or "").lower()
        s = i * 3.0
        s += sum(25 for w in _SKIP_WORDS if w in title and w not in q)
        if duration and e.get("duration"):
            s += min(abs(float(e["duration"]) - duration), 180) / 3
        if "official audio" in title or (e.get("channel") or e.get("uploader") or "").endswith(" - Topic"):
            s -= 4
        return s

    best = min(enumerate(entries), key=score)[1]
    return best.get("url") if str(best.get("url", "")).startswith("http") else f"https://www.youtube.com/watch?v={best['id']}"


def clean_err(e: Exception) -> str:
    msg = re.sub(r"\x1b\[[0-9;]*m", "", str(e))
    msg = msg.replace("ERROR: ", "").strip()
    low = msg.lower()
    if "unsupported url" in low:
        return "That link isn't supported. Paste a link to a song, video, reel or playlist page."
    if any(k in low for k in ("failed to establish", "unable to download webpage", "getaddrinfo",
                              "name or service not known", "timed out", "network is unreachable")):
        return "Couldn't reach that site. Check the link and your internet connection, then try again."
    if "private" in low and "video" in low:
        return "That video is private, so it can't be played."
    if "not available" in low or "unavailable" in low:
        return "That video isn't available (it may be removed, private or blocked in your country)."
    if "login" in low or "cookies" in low or "rate-limit" in low or "sign in" in low:
        return ("This post needs you to be signed in to the site. "
                + ("Sign in under Settings → Accounts, then try again." if ON_ANDROID
                   else "Set AK_COOKIES to a cookies.txt file (see README)."))
    return msg[:400]


def range_response(request: Request, path: Path, media_type: str, filename: Optional[str] = None):
    size = path.stat().st_size
    headers = {"Accept-Ranges": "bytes", "Cache-Control": "private, max-age=86400"}
    if filename:
        headers["Content-Disposition"] = content_disposition(filename)
    rng = request.headers.get("range")
    if not rng:
        headers["Content-Length"] = str(size)
        return StreamingResponse(_iter_file(path, 0, size - 1), media_type=media_type, headers=headers)
    m = re.match(r"bytes=(\d*)-(\d*)", rng)
    if not m:
        raise HTTPException(416, "Bad range")
    start_s, end_s = m.groups()
    if start_s == "":
        length = int(end_s)
        start, end = max(0, size - length), size - 1
    else:
        start = int(start_s)
        end = int(end_s) if end_s else size - 1
    end = min(end, size - 1)
    if start > end or start >= size:
        return JSONResponse({"detail": "Range not satisfiable"}, status_code=416,
                            headers={"Content-Range": f"bytes */{size}"})
    headers.update({"Content-Range": f"bytes {start}-{end}/{size}", "Content-Length": str(end - start + 1)})
    return StreamingResponse(_iter_file(path, start, end), status_code=206, media_type=media_type, headers=headers)


def _iter_file(path: Path, start: int, end: int, chunk: int = 256 * 1024):
    with open(path, "rb") as f:
        f.seek(start)
        remaining = end - start + 1
        while remaining > 0:
            data = f.read(min(chunk, remaining))
            if not data:
                break
            remaining -= len(data)
            yield data


def content_disposition(filename: str) -> str:
    ascii_name = re.sub(r'[^\x20-\x7e]', "_", filename).replace('"', "'")
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{urllib.parse.quote(filename)}"


def nice_filename(t, ext: str) -> str:
    base = f"{t['artist']} - {t['title']}" if t["artist"] else t["title"]
    base = re.sub(r'[\\/:*?"<>|]+', " ", base).strip()[:150] or t["id"]
    return f"{base}{ext}"


def build_export(t, fmt: str) -> tuple[Path, str]:
    """Return (path, media_type) for a downloadable file in the requested format."""
    src = ensure_audio(t["id"])
    if fmt == "original" or not HAS_FFMPEG:
        return src, AUDIO_TYPES.get(src.suffix.lower(), "application/octet-stream")
    ext = {"mp3": ".mp3", "m4a": ".m4a", "flac": ".flac", "wav": ".wav", "opus": ".opus"}.get(fmt)
    if not ext:
        raise HTTPException(400, "Unknown format")
    out = EXPORT_DIR / f"{t['id']}{ext}"
    if out.exists() and out.stat().st_mtime >= src.stat().st_mtime:
        return out, AUDIO_TYPES[ext]
    cover = _cover_path(t["id"])
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(src)]
    embed_cover = cover is not None and fmt in ("mp3", "m4a", "flac") and cover.suffix.lower() in (".jpg", ".jpeg", ".png")
    if embed_cover:
        cmd += ["-i", str(cover), "-map", "0:a", "-map", "1:v", "-disposition:v", "attached_pic"]
        cmd += ["-c:v", "mjpeg" if fmt != "flac" else "png"]
    else:
        cmd += ["-map", "0:a", "-vn"]
    if fmt == "mp3":
        cmd += ["-c:a", "libmp3lame", "-b:a", MP3_BITRATE, "-id3v2_version", "3"]
    elif fmt == "m4a":
        cmd += ["-c:a", "aac", "-b:a", "256k"]
    elif fmt == "flac":
        cmd += ["-c:a", "flac"]
    elif fmt == "wav":
        cmd += ["-c:a", "pcm_s16le"]
    elif fmt == "opus":
        cmd += ["-c:a", "libopus", "-b:a", "160k"]
    cmd += ["-metadata", f"title={t['title'] or ''}", "-metadata", f"artist={t['artist'] or ''}",
            "-metadata", f"album={t['album'] or ''}", "-metadata", "comment=Saved with AK Music Player", str(out)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0 and embed_cover:
        # retry without cover art (some thumbnails are webp/odd formats)
        cmd2 = [c for c in cmd]
        i = cmd2.index(str(cover))
        cmd2 = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-map", "0:a", "-vn"] + \
               cmd[cmd.index("-c:a", i):]
        r = subprocess.run(cmd2, capture_output=True, text=True)
    if r.returncode != 0:
        raise HTTPException(500, f"Conversion failed: {r.stderr[-300:]}")
    return out, AUDIO_TYPES[ext]


# ---------------------------------------------------------------- app
app = FastAPI(title="AK Music Player", version=APP_VERSION)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


class AddLink(BaseModel):
    url: str
    as_playlist: bool = True       # if the link is a playlist, save it as a playlist too
    playlist_id: Optional[str] = None  # add the resulting tracks to this playlist


class TrackPatch(BaseModel):
    title: Optional[str] = None
    artist: Optional[str] = None
    album: Optional[str] = None
    liked: Optional[bool] = None


class PlaylistIn(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    pinned: Optional[bool] = None


class TrackIds(BaseModel):
    track_ids: list[str]


@app.get("/api/health")
def health():
    return {"ok": True, "app": "ak-music-player", "version": APP_VERSION, "ffmpeg": HAS_FFMPEG,
            "android": ON_ANDROID, "formats": ["mp3", "m4a", "flac", "original"] if HAS_FFMPEG else ["original"],
            "editing": HAS_FFMPEG, "yt_dlp": yt_dlp.version.__version__, "js_runtime": next(iter(JS_RUNTIMES), None),
            "cookies": bool(COOKIES_BROWSER or (COOKIES_FILE and Path(COOKIES_FILE).exists()))}


# ---------- adding links
@app.post("/api/add")
def add_link(body: AddLink):
    url = body.url.strip()
    m = re.search(r"https?://\S+", url)
    if not m:
        raise HTTPException(400, "That doesn't look like a link. Paste a full URL starting with http.")
    url = m.group(0)
    if musiclinks.service_of(url):
        return _add_music_link(body, url)
    opts = ydl_base_opts()
    opts.update({"extract_flat": "in_playlist", "noplaylist": False, "skip_download": True})
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as e:
        raise HTTPException(422, clean_err(e))
    if not info:
        raise HTTPException(422, "Nothing playable found at that link")

    tracks, playlist = [], None
    with db() as con:
        if info.get("_type") in ("playlist", "multi_video") and info.get("entries") is not None:
            entries = [e for e in info["entries"] if e][:500]
            for e in entries:
                u = entry_url(e)
                if not u:
                    continue
                e.setdefault("ie_key", e.get("ie_key") or info.get("extractor_key"))
                tracks.append(upsert_track(con, e, u))
            if body.as_playlist and len(tracks) > 1 and not body.playlist_id:
                pid = uuid.uuid4().hex[:12]
                now = time.time()
                con.execute("INSERT INTO playlists (id,name,description,source_url,created_at,updated_at) VALUES (?,?,?,?,?,?)",
                            (pid, info.get("title") or "Imported playlist",
                             f"Imported from {platform_of(info.get('extractor_key') or '')}", url, now, now))
                for i, t in enumerate(tracks):
                    con.execute("INSERT OR IGNORE INTO playlist_tracks VALUES (?,?,?,?)", (pid, t["id"], i, now))
                playlist = playlist_summary(con, pid)
        else:
            tracks.append(upsert_track(con, info, info.get("webpage_url") or url))
        if body.playlist_id:
            _add_to_playlist(con, body.playlist_id, [t["id"] for t in tracks])
    if not tracks:
        raise HTTPException(422, "No playable items found at that link")
    for t in tracks[:1]:
        threading.Thread(target=cache_cover, args=(t["id"], t.get("thumbnail")), daemon=True).start()
    return {"tracks": tracks, "playlist": playlist}


def _add_music_link(body: AddLink, url: str) -> dict:
    """Spotify, Apple Music, Amazon Music, Deezer, Tidal, Gaana, Wynk… → library songs played from YouTube."""
    import hashlib
    try:
        res = musiclinks.resolve(url)
    except musiclinks.LinkError as e:
        raise HTTPException(422, str(e))
    service = res["service"]
    if res["kind"] == "youtube_playlist":        # the whole album exists on YouTube Music
        out = add_link(AddLink(url=res["url"], as_playlist=body.as_playlist, playlist_id=body.playlist_id))
        if out.get("playlist") and res.get("title"):
            with db() as con:
                con.execute("UPDATE playlists SET name=?, description=?, source_url=? WHERE id=?",
                            (res["title"], f"Imported from {service}", url, out["playlist"]["id"]))
                out["playlist"] = playlist_summary(con, out["playlist"]["id"])
        return out
    tracks, playlist = [], None
    now = time.time()
    with db() as con:
        for t in res["tracks"]:
            key = t.get("id") or hashlib.sha1(f"{t['artist']}|{t['title']}".lower().encode()).hexdigest()[:16]
            tid = safe_id(f"{service}-{key}".lower().replace(" ", ""))
            row_ = con.execute("SELECT * FROM tracks WHERE id=?", (tid,)).fetchone()
            if not row_:
                source = t.get("youtube") or MUSIC_SEARCH + urllib.parse.urlencode(
                    {"q": musiclinks.search_query(t), "d": round(t["duration"], 1) if t.get("duration") else ""})
                con.execute("""INSERT INTO tracks (id, source_url, platform, title, artist, album, duration, thumbnail, status, added_at)
                               VALUES (?,?,?,?,?,?,?,?, 'new', ?)""",
                            (tid, source, service, t["title"], t["artist"], t["album"], t["duration"], t["thumbnail"], now))
                row_ = con.execute("SELECT * FROM tracks WHERE id=?", (tid,)).fetchone()
            tracks.append(track_out(row_))
        if res["kind"] == "collection" and body.as_playlist and len(tracks) > 1 and not body.playlist_id:
            pid = uuid.uuid4().hex[:12]
            con.execute("INSERT INTO playlists (id,name,description,source_url,created_at,updated_at) VALUES (?,?,?,?,?,?)",
                        (pid, res.get("title") or f"{service} playlist", f"Imported from {service}", url, now, now))
            for i, t in enumerate(tracks):
                con.execute("INSERT OR IGNORE INTO playlist_tracks VALUES (?,?,?,?)", (pid, t["id"], i, now))
            playlist = playlist_summary(con, pid)
        if body.playlist_id:
            _add_to_playlist(con, body.playlist_id, [t["id"] for t in tracks])
    for t in tracks[:1]:
        threading.Thread(target=cache_cover, args=(t["id"], t.get("thumbnail")), daemon=True).start()
    return {"tracks": tracks, "playlist": playlist}


@app.post("/api/upload")
async def upload(file: UploadFile = File(...)):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in AUDIO_TYPES:
        raise HTTPException(400, f"Unsupported file type {ext}. Use mp3, m4a, flac, wav, ogg, opus or webm.")
    tid = "upload-" + uuid.uuid4().hex[:12]
    dest = AUDIO_DIR / f"{tid}{ext}"
    with open(dest, "wb") as f:
        while chunk := await file.read(1024 * 1024):
            f.write(chunk)
    duration, title, artist = None, Path(file.filename).stem, ""
    if not HAS_FFPROBE:
        info = ffmpeg_info(dest)
        duration, title, artist = info["duration"], info["title"] or title, info["artist"]
    else:
        r = subprocess.run(["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", str(dest)],
                           capture_output=True, text=True)
        try:
            fmt = json.loads(r.stdout).get("format", {})
            duration = float(fmt.get("duration")) if fmt.get("duration") else None
            tags = {k.lower(): v for k, v in (fmt.get("tags") or {}).items()}
            title = tags.get("title") or title
            artist = tags.get("artist") or ""
        except Exception:
            pass
    if not artist and " - " in title:
        artist, title = [s.strip() for s in title.split(" - ", 1)]
    with db() as con:
        con.execute("""INSERT INTO tracks (id, source_url, platform, title, artist, duration, status, file, added_at)
                       VALUES (?,?,?,?,?,?,'ready',?,?)""",
                    (tid, f"upload://{file.filename}", "Upload", title, artist, duration, dest.name, time.time()))
        t = track_out(con.execute("SELECT * FROM tracks WHERE id=?", (tid,)).fetchone())
    return {"tracks": [t], "playlist": None}


# ---------- tracks
SORTS = {
    "added": "added_at DESC", "title": "title COLLATE NOCASE", "artist": "artist COLLATE NOCASE, title COLLATE NOCASE",
    "plays": "play_count DESC, last_played DESC", "recent": "last_played DESC", "duration": "duration DESC",
    "liked": "liked_at DESC",
}


@app.get("/api/tracks")
def list_tracks(q: str = "", sort: str = "added", liked: bool = False, platform: str = ""):
    sql, args = "SELECT * FROM tracks WHERE 1=1", []
    if q:
        sql += " AND (title LIKE ? OR artist LIKE ? OR album LIKE ?)"
        args += [f"%{q}%"] * 3
    if liked:
        sql += " AND liked=1"
    if platform:
        sql += " AND platform=?"
        args.append(platform)
    sql += f" ORDER BY {SORTS.get(sort, SORTS['added'])}"
    with db() as con:
        return [track_out(r) for r in con.execute(sql, args)]


@app.get("/api/tracks/{tid}")
def get_track(tid: str):
    with db() as con:
        r = con.execute("SELECT * FROM tracks WHERE id=?", (tid,)).fetchone()
    if not r:
        raise HTTPException(404, "Track not found")
    return track_out(r)


@app.patch("/api/tracks/{tid}")
def patch_track(tid: str, body: TrackPatch):
    fields = {k: v for k, v in dump(body).items() if v is not None}
    if "liked" in fields:
        fields["liked"] = 1 if fields["liked"] else 0
        fields["liked_at"] = time.time() if fields["liked"] else None
    if fields:
        with db() as con:
            sets = ", ".join(f"{k}=?" for k in fields)
            con.execute(f"UPDATE tracks SET {sets} WHERE id=?", (*fields.values(), tid))
        for p in EXPORT_DIR.glob(f"{tid}.*"):   # tags changed → rebuild exports next time
            p.unlink(missing_ok=True)
    return get_track(tid)


@app.delete("/api/tracks/{tid}")
def delete_track(tid: str):
    with db() as con:
        con.execute("DELETE FROM tracks WHERE id=?", (tid,))
    for folder in (AUDIO_DIR, COVER_DIR, EXPORT_DIR):
        for p in folder.glob(f"{tid}.*"):
            p.unlink(missing_ok=True)       # only the app's own copies; songs on the phone are never touched here
    for p in (DATA / "waves").glob(f"{tid}-*.json"):
        p.unlink(missing_ok=True)
    return {"ok": True}


@app.post("/api/tracks/{tid}/prepare")
def prepare(tid: str):
    ensure_audio(tid)
    return get_track(tid)


@app.get("/api/tracks/{tid}/audio")
def audio(tid: str, request: Request):
    path = ensure_audio(tid)
    return range_response(request, path, AUDIO_TYPES.get(path.suffix.lower(), "application/octet-stream"))


@app.get("/api/tracks/{tid}/cover")
def cover(tid: str):
    p = _cover_path(tid)
    if not p:
        with db() as con:
            r = con.execute("SELECT thumbnail FROM tracks WHERE id=?", (tid,)).fetchone()
        if r and r["thumbnail"]:
            cache_cover(tid, r["thumbnail"])
            p = _cover_path(tid)
            if not p:
                return RedirectResponse(r["thumbnail"])
    if not p:
        raise HTTPException(404, "No cover")
    return FileResponse(p, headers={"Cache-Control": "public, max-age=604800"})


@app.get("/api/tracks/{tid}/download")
def download(tid: str, request: Request, format: str = "mp3"):
    with db() as con:
        t = con.execute("SELECT * FROM tracks WHERE id=?", (tid,)).fetchone()
    if not t:
        raise HTTPException(404, "Track not found")
    path, mtype = build_export(t, format)
    return range_response(request, path, mtype, filename=nice_filename(t, path.suffix))


@app.post("/api/tracks/{tid}/played")
def played(tid: str):
    now = time.time()
    with db() as con:
        con.execute("UPDATE tracks SET play_count=play_count+1, last_played=? WHERE id=?", (now, tid))
        con.execute("INSERT INTO history (track_id, played_at) VALUES (?,?)", (tid, now))
    return {"ok": True}


# ---------- lyrics (via the free LRCLIB service)
@app.get("/api/tracks/{tid}/lyrics")
def lyrics(tid: str):
    with db() as con:
        t = con.execute("SELECT * FROM tracks WHERE id=?", (tid,)).fetchone()
    if not t:
        raise HTTPException(404, "Track not found")
    params = {"track_name": t["title"] or "", "artist_name": t["artist"] or ""}
    attempts = []
    if t["duration"]:
        attempts.append(("https://lrclib.net/api/get", {**params, "duration": int(t["duration"])}))
    attempts.append(("https://lrclib.net/api/search", {"q": f"{t['artist'] or ''} {t['title'] or ''}".strip()}))
    for url, p in attempts:
        try:
            req = urllib.request.Request(f"{url}?{urllib.parse.urlencode(p)}",
                                         headers={"User-Agent": f"AKMusicPlayer/{APP_VERSION} (self-hosted music player)"})
            with urllib.request.urlopen(req, timeout=10) as r:
                data = json.loads(r.read())
            if isinstance(data, list):
                data = next((d for d in data if d.get("syncedLyrics")), data[0] if data else None)
            if data and (data.get("syncedLyrics") or data.get("plainLyrics")):
                return {"synced": data.get("syncedLyrics"), "plain": data.get("plainLyrics"),
                        "instrumental": data.get("instrumental", False)}
        except Exception:
            continue
    return {"synced": None, "plain": None, "instrumental": False}


# ---------- playlists
def playlist_summary(con, pid: str) -> Optional[dict]:
    p = con.execute("SELECT * FROM playlists WHERE id=?", (pid,)).fetchone()
    if not p:
        return None
    p = dict(p)
    agg = con.execute("""SELECT COUNT(*) n, COALESCE(SUM(t.duration),0) d FROM playlist_tracks pt
                         JOIN tracks t ON t.id=pt.track_id WHERE pt.playlist_id=?""", (pid,)).fetchone()
    covers = con.execute("""SELECT t.id FROM playlist_tracks pt JOIN tracks t ON t.id=pt.track_id
                            WHERE pt.playlist_id=? AND t.thumbnail IS NOT NULL ORDER BY pt.position LIMIT 4""", (pid,)).fetchall()
    p.update(track_count=agg["n"], duration=agg["d"], pinned=bool(p["pinned"]),
             covers=[f"/api/tracks/{c['id']}/cover" for c in covers])
    return p


def _add_to_playlist(con, pid: str, track_ids: list[str]) -> int:
    if not con.execute("SELECT 1 FROM playlists WHERE id=?", (pid,)).fetchone():
        raise HTTPException(404, "Playlist not found")
    pos = con.execute("SELECT COALESCE(MAX(position),-1)+1 FROM playlist_tracks WHERE playlist_id=?", (pid,)).fetchone()[0]
    added, now = 0, time.time()
    for tid in track_ids:
        cur = con.execute("INSERT OR IGNORE INTO playlist_tracks VALUES (?,?,?,?)", (pid, tid, pos, now))
        if cur.rowcount:
            pos += 1
            added += 1
    con.execute("UPDATE playlists SET updated_at=? WHERE id=?", (now, pid))
    return added


@app.get("/api/playlists")
def list_playlists():
    with db() as con:
        ids = [r["id"] for r in con.execute("SELECT id FROM playlists ORDER BY pinned DESC, updated_at DESC")]
        return [playlist_summary(con, i) for i in ids]


@app.post("/api/playlists")
def create_playlist(body: PlaylistIn):
    pid, now = uuid.uuid4().hex[:12], time.time()
    with db() as con:
        con.execute("INSERT INTO playlists (id,name,description,pinned,created_at,updated_at) VALUES (?,?,?,?,?,?)",
                    (pid, (body.name or "New playlist").strip()[:120], body.description or "", int(bool(body.pinned)), now, now))
        return playlist_summary(con, pid)


@app.get("/api/playlists/{pid}")
def get_playlist(pid: str):
    with db() as con:
        p = playlist_summary(con, pid)
        if not p:
            raise HTTPException(404, "Playlist not found")
        p["tracks"] = [track_out(r) for r in con.execute(
            """SELECT t.* FROM playlist_tracks pt JOIN tracks t ON t.id=pt.track_id
               WHERE pt.playlist_id=? ORDER BY pt.position""", (pid,))]
        return p


@app.patch("/api/playlists/{pid}")
def patch_playlist(pid: str, body: PlaylistIn):
    fields = {k: v for k, v in dump(body).items() if v is not None}
    if "pinned" in fields:
        fields["pinned"] = int(fields["pinned"])
    fields["updated_at"] = time.time()
    with db() as con:
        con.execute(f"UPDATE playlists SET {', '.join(f'{k}=?' for k in fields)} WHERE id=?", (*fields.values(), pid))
        return playlist_summary(con, pid)


@app.delete("/api/playlists/{pid}")
def delete_playlist(pid: str):
    with db() as con:
        con.execute("DELETE FROM playlists WHERE id=?", (pid,))
    return {"ok": True}


@app.post("/api/playlists/{pid}/tracks")
def add_tracks(pid: str, body: TrackIds):
    with db() as con:
        n = _add_to_playlist(con, pid, body.track_ids)
        return {"added": n, "playlist": playlist_summary(con, pid)}


@app.delete("/api/playlists/{pid}/tracks/{tid}")
def remove_track(pid: str, tid: str):
    with db() as con:
        con.execute("DELETE FROM playlist_tracks WHERE playlist_id=? AND track_id=?", (pid, tid))
        con.execute("UPDATE playlists SET updated_at=? WHERE id=?", (time.time(), pid))
    return {"ok": True}


@app.put("/api/playlists/{pid}/order")
def reorder(pid: str, body: TrackIds):
    with db() as con:
        for i, tid in enumerate(body.track_ids):
            con.execute("UPDATE playlist_tracks SET position=? WHERE playlist_id=? AND track_id=?", (i, pid, tid))
        con.execute("UPDATE playlists SET updated_at=? WHERE id=?", (time.time(), pid))
    return {"ok": True}


@app.post("/api/playlists/{pid}/duplicate")
def duplicate_playlist(pid: str):
    src = get_playlist(pid)
    new = create_playlist(PlaylistIn(name=f"{src['name']} (copy)", description=src["description"]))
    with db() as con:
        _add_to_playlist(con, new["id"], [t["id"] for t in src["tracks"]])
        return playlist_summary(con, new["id"])


@app.get("/api/playlists/{pid}/download")
def download_playlist(pid: str, format: str = "mp3"):
    p = get_playlist(pid)
    if not p["tracks"]:
        raise HTTPException(400, "This playlist is empty")
    zpath = EXPORT_DIR / f"playlist-{pid}-{format}.zip"
    failed = []
    with zipfile.ZipFile(zpath, "w", compression=zipfile.ZIP_STORED) as z:
        for i, t in enumerate(p["tracks"], 1):
            try:
                with db() as con:
                    full = con.execute("SELECT * FROM tracks WHERE id=?", (t["id"],)).fetchone()
                path, _ = build_export(full, format)
                z.write(path, f"{i:02d}. {nice_filename(full, path.suffix)}")
            except HTTPException as e:
                failed.append(f"{t['title']}: {e.detail}")
        if failed:
            z.writestr("_could_not_download.txt", "\n".join(failed))
    name = re.sub(r'[\\/:*?"<>|]+', " ", p["name"]).strip() or "playlist"
    return FileResponse(zpath, media_type="application/zip", filename=f"{name}.zip")


# ---------- version 2: song editor, combining songs, songs already on the phone
WAVE_DIR = DATA / "waves"
WAVE_DIR.mkdir(parents=True, exist_ok=True)
DEVICE_ROOTS = ("/storage/", "/sdcard/", "/mnt/sdcard/")


def _need_ffmpeg():
    if not HAS_FFMPEG:
        raise HTTPException(501, "Editing needs FFmpeg, which isn't available on this device.")


def _duration_of(t, path: Path) -> float:
    d = t["duration"] or probe_duration(path)
    if not d:
        raise HTTPException(422, "Couldn't read the length of this song")
    return float(d)


@app.get("/api/tracks/{tid}/waveform")
def waveform(tid: str, points: int = 800):
    """Peak levels (0–1) for drawing the song in the editor."""
    import array
    points = max(50, min(int(points), 3000))
    cache = WAVE_DIR / f"{tid}-{points}.json"
    if cache.exists():
        return JSONResponse(json.loads(cache.read_text()))
    _need_ffmpeg()
    with db() as con:
        t = con.execute("SELECT * FROM tracks WHERE id=?", (tid,)).fetchone()
    if not t:
        raise HTTPException(404, "Track not found")
    src = ensure_audio(tid)
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", str(src), "-ac", "1", "-ar", "4000", "-f", "s16le", "-"],
                       capture_output=True)
    if r.returncode != 0 or not r.stdout:
        raise HTTPException(500, "Couldn't read the audio for the waveform")
    samples = array.array("h")
    samples.frombytes(r.stdout[: len(r.stdout) // 2 * 2])
    if sys.byteorder == "big":
        samples.byteswap()
    n = len(samples)
    step = max(1, n // points)
    peaks = []
    for i in range(0, n, step):
        chunk = samples[i:i + step]
        peaks.append(round(max(max(chunk), -min(chunk)) / 32768, 3))
    top = max(peaks) or 1
    data = {"duration": n / 4000, "peaks": [round(p / top, 3) for p in peaks[:points]]}
    with db() as con:
        if not t["duration"]:
            con.execute("UPDATE tracks SET duration=? WHERE id=?", (data["duration"], tid))
    cache.write_text(json.dumps(data))
    return data


class TrimIn(BaseModel):
    track_id: str
    start: float = 0
    end: Optional[float] = None
    cuts: list[list[float]] = []       # parts to remove from the middle: [[from, to], ...]
    fade_in: float = 0
    fade_out: float = 0
    title: Optional[str] = None


def keep_segments(duration: float, start: float, end: Optional[float], cuts: list) -> list[tuple[float, float]]:
    """The parts of the song that stay, after trimming the ends and removing the cuts."""
    end = duration if end is None else end
    start, end = max(0.0, float(start)), min(float(duration), float(end))
    if end - start < 0.5:
        raise HTTPException(400, "The part you keep must be at least half a second long")
    ranges = sorted((max(start, min(a, b)), min(end, max(a, b))) for a, b in (c[:2] for c in cuts if len(c) >= 2))
    merged: list[list[float]] = []
    for a, b in ranges:
        if b - a < 0.05:
            continue
        if merged and a <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])
    keep, pos = [], start
    for a, b in merged:
        if a - pos > 0.02:
            keep.append((pos, a))
        pos = max(pos, b)
    if end - pos > 0.02:
        keep.append((pos, end))
    if sum(b - a for a, b in keep) < 0.5:
        raise HTTPException(400, "That would remove the whole song. Keep at least half a second.")
    return keep


def _save_new_track(tid: str, out: Path, title: str, artist: str, album: str, platform: str,
                    source: str, cover_from: Optional[str] = None) -> dict:
    duration = probe_duration(out)
    with db() as con:
        con.execute("""INSERT INTO tracks (id, source_url, platform, title, artist, album, duration, status, file, added_at)
                       VALUES (?,?,?,?,?,?,?,'ready',?,?)""",
                    (tid, source, platform, title, artist, album, duration, out.name, time.time()))
        if cover_from:   # reuse the original artwork
            src = _cover_path(cover_from)
            if src:
                shutil.copy(src, COVER_DIR / f"{tid}{src.suffix}")
        return track_out(con.execute("SELECT * FROM tracks WHERE id=?", (tid,)).fetchone())


def _run_ffmpeg(cmd: list[str]):
    r = subprocess.run(cmd, capture_output=True, text=True, errors="replace")
    if r.returncode != 0:
        raise HTTPException(500, "Editing failed: " + (r.stderr.strip().splitlines() or ["unknown error"])[-1][:300])


@app.post("/api/edit/trim")
def edit_trim(body: TrimIn):
    """Trim the start/end and cut parts out of the middle. Saves a NEW song; the original is untouched."""
    _need_ffmpeg()
    with db() as con:
        t = con.execute("SELECT * FROM tracks WHERE id=?", (body.track_id,)).fetchone()
    if not t:
        raise HTTPException(404, "Track not found")
    src = ensure_audio(t["id"])
    dur = _duration_of(t, src)
    keep = keep_segments(dur, body.start, body.end, body.cuts)
    total = sum(b - a for a, b in keep)
    fi = max(0.0, min(float(body.fade_in), total / 2))
    fo = max(0.0, min(float(body.fade_out), total / 2))

    n = len(keep)
    parts, labels = [f"[0:a]asplit={n}" + "".join(f"[s{i}]" for i in range(n))], []
    for i, (a, b) in enumerate(keep):
        f = f"[s{i}]atrim=start={a:.3f}:end={b:.3f},asetpts=PTS-STARTPTS"
        if n > 1:   # tiny fades at the joins so the cuts don't click
            seg = b - a
            d = min(0.008, seg / 4)
            if i > 0:
                f += f",afade=t=in:d={d:.4f}"
            if i < n - 1:
                f += f",afade=t=out:st={seg - d:.4f}:d={d:.4f}"
        parts.append(f + f"[k{i}]")
        labels.append(f"[k{i}]")
    chain = "".join(labels) + (f"concat=n={n}:v=0:a=1" if n > 1 else "anull")
    if fi > 0:
        chain += f",afade=t=in:st=0:d={fi:.3f}"
    if fo > 0:
        chain += f",afade=t=out:st={total - fo:.3f}:d={fo:.3f}"
    parts.append(chain + "[out]")

    title = (body.title or f"{t['title']} (edit)").strip()[:200]
    tid = f"edit-{uuid.uuid4().hex[:12]}"
    out = AUDIO_DIR / f"{tid}.m4a"
    _run_ffmpeg(["ffmpeg", "-y", "-v", "error", "-i", str(src), "-filter_complex", ";".join(parts),
                 "-map", "[out]", "-vn", "-c:a", "aac", "-b:a", "256k",
                 "-metadata", f"title={title}", "-metadata", f"artist={t['artist'] or ''}", str(out)])
    return _save_new_track(tid, out, title, t["artist"] or "", t["album"] or "", "Edited",
                           f"edit://{t['id']}", cover_from=t["id"])


class MergeIn(BaseModel):
    track_ids: list[str]
    crossfade: float = 0      # seconds of overlap between songs
    gap: float = 0            # seconds of silence between songs (when not crossfading)
    title: Optional[str] = None


@app.post("/api/edit/merge")
def edit_merge(body: MergeIn):
    """Join songs one after another into a NEW song."""
    _need_ffmpeg()
    if len(body.track_ids) < 2:
        raise HTTPException(400, "Choose at least two songs to combine")
    if len(body.track_ids) > 30:
        raise HTTPException(400, "You can combine up to 30 songs at a time")
    rows, paths, durs = [], [], []
    for tid in body.track_ids:
        with db() as con:
            t = con.execute("SELECT * FROM tracks WHERE id=?", (tid,)).fetchone()
        if not t:
            raise HTTPException(404, "One of the songs is no longer in your library")
        p = ensure_audio(tid)
        rows.append(t)
        paths.append(p)
        durs.append(_duration_of(t, p))
    n = len(paths)
    xf = max(0.0, min(float(body.crossfade), 10.0, min(durs) / 2 - 0.1))
    gap = 0.0 if xf > 0 else max(0.0, min(float(body.gap), 10.0))

    cmd = ["ffmpeg", "-y", "-v", "error"]
    for p in paths:
        cmd += ["-i", str(p)]
    f = []
    for i in range(n):
        pad = f",apad=pad_dur={gap:.3f}" if gap > 0 and i < n - 1 else ""
        f.append(f"[{i}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo{pad}[a{i}]")
    if xf > 0:
        prev = "a0"
        for i in range(1, n):
            nxt = "out" if i == n - 1 else f"x{i}"
            f.append(f"[{prev}][a{i}]acrossfade=d={xf:.3f}:c1=tri:c2=tri[{nxt}]")
            prev = nxt
    else:
        f.append("".join(f"[a{i}]" for i in range(n)) + f"concat=n={n}:v=0:a=1[out]")

    artists = []
    for t in rows:
        if t["artist"] and t["artist"] not in artists:
            artists.append(t["artist"])
    title = (body.title or " + ".join(t["title"] for t in rows[:3]) + (" …" if n > 3 else "")).strip()[:200]
    artist = ", ".join(artists[:3]) + (" & more" if len(artists) > 3 else "")
    tid = f"mix-{uuid.uuid4().hex[:12]}"
    out = AUDIO_DIR / f"{tid}.m4a"
    _run_ffmpeg(cmd + ["-filter_complex", ";".join(f), "-map", "[out]", "-vn", "-c:a", "aac", "-b:a", "256k",
                       "-metadata", f"title={title}", "-metadata", f"artist={artist}", str(out)])
    return _save_new_track(tid, out, title, artist, "Combined songs", "Mix",
                           "mix://" + ",".join(body.track_ids), cover_from=rows[0]["id"])


class DeviceItem(BaseModel):
    path: str
    title: Optional[str] = None
    artist: Optional[str] = None
    album: Optional[str] = None
    duration: Optional[float] = None


class DeviceLink(BaseModel):
    items: list[DeviceItem]


class DevicePaths(BaseModel):
    paths: list[str]


def _device_id(path: str) -> str:
    import hashlib
    return "phone-" + hashlib.sha1(path.encode("utf-8", "replace")).hexdigest()[:16]


def _check_device_path(path: str) -> Path:
    if not ON_ANDROID and not os.environ.get("AK_ALLOW_DEVICE"):
        raise HTTPException(403, "Songs on the phone are only available in the Android app")
    p = Path(path)
    if not p.is_absolute() or not any(str(p).startswith(r) for r in DEVICE_ROOTS) or ".." in p.parts:
        raise HTTPException(400, "That file isn't in the phone's shared storage")
    return p


@app.post("/api/device/link")
def device_link(body: DeviceLink):
    """Make songs that are already on the phone playable in AK Music Player — without copying them."""
    out = []
    with db() as con:
        for it in body.items[:2000]:
            p = _check_device_path(it.path)
            tid = _device_id(str(p))
            title = (it.title or p.stem).strip() or p.stem
            existing = con.execute("SELECT * FROM tracks WHERE id=?", (tid,)).fetchone()
            if existing:
                con.execute("UPDATE tracks SET file=?, status='ready' WHERE id=?", (str(p), tid))
            else:
                con.execute("""INSERT INTO tracks (id, source_url, platform, title, artist, album, duration, status, file, added_at)
                               VALUES (?,?,?,?,?,?,?,'ready',?,?)""",
                            (tid, "file://" + str(p), "Phone", title, (it.artist or "").replace("<unknown>", ""),
                             (it.album or ""), it.duration, str(p), time.time()))
            out.append(track_out(con.execute("SELECT * FROM tracks WHERE id=?", (tid,)).fetchone()))
    return out


@app.post("/api/device/forget")
def device_forget(body: DevicePaths):
    """After a phone file is deleted, remove it from the library too."""
    ids = [_device_id(str(Path(p))) for p in body.paths]
    with db() as con:
        for tid in ids:
            con.execute("DELETE FROM tracks WHERE id=?", (tid,))
    for tid in ids:
        for folder in (COVER_DIR, EXPORT_DIR, WAVE_DIR):
            for f in folder.glob(f"{tid}*"):
                f.unlink(missing_ok=True)
    return {"ok": True, "removed": len(ids), "ids": ids}


# ---------- home / history / stats
@app.get("/api/home")
def home():
    with db() as con:
        recent = [track_out(r) for r in con.execute(
            """SELECT t.* FROM tracks t JOIN (SELECT track_id, MAX(played_at) m FROM history GROUP BY track_id) h
               ON h.track_id=t.id ORDER BY h.m DESC LIMIT 12""")]
        added = [track_out(r) for r in con.execute("SELECT * FROM tracks ORDER BY added_at DESC LIMIT 12")]
        top = [track_out(r) for r in con.execute(
            "SELECT * FROM tracks WHERE play_count>0 ORDER BY play_count DESC, last_played DESC LIMIT 12")]
        stats = con.execute("""SELECT COUNT(*) tracks, COALESCE(SUM(liked),0) liked,
                               COALESCE(SUM(play_count),0) plays FROM tracks""").fetchone()
        listened = con.execute("""SELECT COALESCE(SUM(t.duration),0) FROM history h JOIN tracks t ON t.id=h.track_id""").fetchone()[0]
        artists = [dict(r) for r in con.execute(
            """SELECT artist, SUM(play_count) plays, COUNT(*) tracks FROM tracks WHERE artist<>''
               GROUP BY artist ORDER BY plays DESC, tracks DESC LIMIT 8""")]
    return {"recent": recent, "added": added, "top": top, "artists": artists,
            "stats": {**dict(stats), "minutes": round((listened or 0) / 60)}}


@app.get("/api/history")
def history(limit: int = 200):
    with db() as con:
        out = []
        for r in con.execute("""SELECT t.*, h.played_at h_played FROM history h JOIN tracks t ON t.id=h.track_id
                                ORDER BY h.played_at DESC LIMIT ?""", (limit,)):
            d = track_out(r)
            d["played_at"] = d.pop("h_played")
            out.append(d)
        return out


@app.delete("/api/history")
def clear_history():
    with db() as con:
        con.execute("DELETE FROM history")
    return {"ok": True}


@app.get("/api/storage")
def storage():
    def size(folder):
        return sum(p.stat().st_size for p in folder.glob("*") if p.is_file())
    return {"audio": size(AUDIO_DIR), "covers": size(COVER_DIR), "exports": size(EXPORT_DIR)}


@app.delete("/api/storage/exports")
def clear_exports():
    for p in EXPORT_DIR.glob("*"):
        p.unlink(missing_ok=True)
    return {"ok": True}


# ---------- backup / restore
@app.get("/api/backup")
def backup():
    with db() as con:
        data = {
            "app": "ak-music-player", "version": 1, "exported_at": time.time(),
            "tracks": [dict(r) for r in con.execute("SELECT * FROM tracks")],
            "playlists": [dict(r) for r in con.execute("SELECT * FROM playlists")],
            "playlist_tracks": [dict(r) for r in con.execute("SELECT * FROM playlist_tracks")],
        }
    for t in data["tracks"]:
        t["file"], t["status"] = None, "new"
    buf = io.BytesIO(json.dumps(data, indent=1).encode())
    return StreamingResponse(buf, media_type="application/json",
                             headers={"Content-Disposition": 'attachment; filename="ak-music-backup.json"'})


@app.post("/api/restore")
async def restore(file: UploadFile = File(...)):
    try:
        data = json.loads(await file.read())
        assert data.get("app") == "ak-music-player"
    except Exception:
        raise HTTPException(400, "That file isn't an AK Music Player backup")
    with db() as con:
        for t in data["tracks"]:
            if t["id"].startswith(("upload-", "edit-", "mix-", "phone-")):
                continue  # these songs' audio files aren't in the backup
            cols = [c for c in t if c in ("id", "source_url", "platform", "title", "artist", "album", "duration",
                                          "thumbnail", "liked", "liked_at", "play_count", "added_at", "last_played")]
            con.execute(f"INSERT OR IGNORE INTO tracks ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})",
                        [t[c] for c in cols])
        for p in data["playlists"]:
            cols = list(p.keys())
            con.execute(f"INSERT OR IGNORE INTO playlists ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})",
                        [p[c] for c in cols])
        for pt in data["playlist_tracks"]:
            con.execute("INSERT OR IGNORE INTO playlist_tracks SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM tracks WHERE id=?)",
                        (pt["playlist_id"], pt["track_id"], pt["position"], pt["added_at"], pt["track_id"]))
    return {"ok": True, "tracks": len(data["tracks"]), "playlists": len(data["playlists"])}


# ---------- frontend
@app.exception_handler(HTTPException)
async def http_error(request: Request, exc: HTTPException):
    return JSONResponse({"detail": exc.detail}, status_code=exc.status_code, headers=getattr(exc, "headers", None))


app.mount("/", StaticFiles(directory=FRONTEND, html=True), name="frontend")
