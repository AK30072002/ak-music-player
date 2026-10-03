"""
Starts the AK Music Player server inside the Android app (called from Java via Chaquopy).

The server, the web player and its tools all live in the APK:
  - backend/app.py and frontend/* are bundled next to this file (see app/build.gradle)
  - ffmpeg and qjs (QuickJS, used by yt-dlp for YouTube) are packaged as native
    libraries and symlinked into <files>/bin by ServerManager.java
"""
import json
import os
import shutil
import stat
import socket
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import urllib.request
import zipfile

_server = None
_thread = None
_port = 0
_error = ""


def _works(cmd):
    """(ok, reason) for running a bundled tool once."""
    try:
        r = subprocess.run(cmd, capture_output=True, timeout=20)
    except Exception as e:
        return False, str(e)[:200]
    if r.returncode == 0:
        return True, ""
    if r.returncode < 0:
        return False, f"stopped by Android (signal {-r.returncode})"
    err = (r.stderr or b"").decode("utf-8", "replace").strip().splitlines()
    return False, f"exit code {r.returncode}" + (f": {err[-1][:160]}" if err else "")


def _check_tools(bin_dir):
    """Remove any bundled tool that can't run on this phone, so the server falls back gracefully."""
    status = {}
    for name, test in (("ffmpeg", ["-hide_banner", "-version"]), ("ffprobe", ["-hide_banner", "-version"]), ("qjs", ["-e", "1"])):
        path = os.path.join(bin_dir, name)
        if not os.path.exists(path):
            ok, why = False, "not included in this app build"
        else:
            ok, why = _works([path] + test)
        if not ok and os.path.lexists(path):
            os.remove(path)
        status[name] = {"ok": ok, "error": why}
    return status


# ---------------------------------------------------------------- yt-dlp self-update
# Sites like YouTube change often, so the app keeps yt-dlp current by itself: once a day it
# checks yt-dlp's official GitHub releases and downloads the newer pure-Python build, which
# is used from the next app start. (This is the same file yt-dlp's own updater uses.)
YTDLP_LATEST = "https://github.com/yt-dlp/yt-dlp/releases/latest"
YTDLP_ZIP_URL = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp"


def _vtuple(v):
    try:
        return tuple(int(x) for x in str(v).strip().split("."))
    except ValueError:
        return (0,)


def _zip_version(path):
    with zipfile.ZipFile(path) as z:
        if "yt_dlp/__init__.py" not in z.namelist():
            raise ValueError("not a yt-dlp build")
        src = z.read("yt_dlp/version.py").decode()
    for line in src.splitlines():
        if line.startswith("__version__"):
            return line.split("=", 1)[1].strip().strip("'\"")
    raise ValueError("no version")


def _use_updated_ytdlp(files_dir, bundled_version):
    """Put a downloaded, newer yt-dlp in front of the bundled one."""
    path = os.path.join(files_dir, "yt-dlp.zip")
    if not os.path.exists(path):
        return None
    try:
        v = _zip_version(path)
        if _vtuple(v) > _vtuple(bundled_version):
            sys.path.insert(0, path)
            return v
        os.remove(path)          # the app itself now ships something as new or newer
    except Exception:
        os.remove(path)
    return None


def _update_ytdlp(files_dir, current_version):
    stamp = os.path.join(files_dir, "yt-dlp.checked")
    try:
        if os.path.exists(stamp) and time.time() - os.path.getmtime(stamp) < 20 * 3600:
            return
        open(stamp, "w").close()
        req = urllib.request.Request(YTDLP_LATEST, method="HEAD", headers={"User-Agent": "AKMusicPlayer"})
        with urllib.request.urlopen(req, timeout=20) as r:
            latest = r.url.rstrip("/").rsplit("/", 1)[-1]
        if _vtuple(latest) <= _vtuple(current_version):
            return
        tmp = os.path.join(files_dir, "yt-dlp.zip.part")
        req = urllib.request.Request(YTDLP_ZIP_URL, headers={"User-Agent": "AKMusicPlayer"})
        with urllib.request.urlopen(req, timeout=120) as r, open(tmp, "wb") as f:
            while chunk := r.read(256 * 1024):
                f.write(chunk)
        if _zip_version(tmp) != latest:
            raise ValueError("unexpected yt-dlp build")
        os.replace(tmp, os.path.join(files_dir, "yt-dlp.zip"))
        print(f"AK Music Player: yt-dlp {latest} downloaded, used from next start", file=sys.stderr)
    except Exception as e:
        print(f"AK Music Player: yt-dlp update check failed: {e}", file=sys.stderr)


# ---------------------------------------------------------------- FFmpeg for Android
# The app ships the Android build of FFmpeg from the youtubedl-android project (the one Seal and
# YTDLnis use): libffmpeg.so / libffprobe.so are the programs, libffmpeg.zip.so bundles their
# libraries. The libraries are unpacked once per app version; FFmpeg finds them via LD_LIBRARY_PATH.
def _unpack_ffmpeg_libs(native_dir, files_dir):
    bundle = os.path.join(native_dir or "", "libffmpeg.zip.so")
    if not native_dir or not os.path.exists(bundle):
        return None
    target = os.path.join(files_dir, "ffmpeg-android")
    stamp = os.path.join(target, ".bundle")
    version = f"{os.path.getsize(bundle)}-{int(os.path.getmtime(bundle))}"
    try:
        with open(stamp) as f:
            ready = f.read() == version
    except OSError:
        ready = False
    if not ready:
        shutil.rmtree(target, ignore_errors=True)
        os.makedirs(target, exist_ok=True)
        root = os.path.realpath(target) + os.sep
        with zipfile.ZipFile(bundle) as z:
            for info in z.infolist():
                dest = os.path.realpath(os.path.join(target, info.filename))
                if not dest.startswith(root):
                    continue                              # never write outside the folder
                mode = info.external_attr >> 16
                if info.is_dir():
                    os.makedirs(dest, exist_ok=True)
                elif stat.S_ISLNK(mode):                  # e.g. libavcodec.so -> libavcodec.so.61.19.101
                    os.makedirs(os.path.dirname(dest), exist_ok=True)
                    if os.path.lexists(dest):
                        os.remove(dest)
                    os.symlink(z.read(info).decode(), dest)
                else:
                    os.makedirs(os.path.dirname(dest), exist_ok=True)
                    with z.open(info) as src, open(dest, "wb") as out:
                        shutil.copyfileobj(src, out, 1024 * 1024)
        with open(stamp, "w") as f:
            f.write(version)
    return os.path.join(target, "usr", "lib")


def _free_port(preferred):
    for port in [preferred] + list(range(preferred + 1, preferred + 30)):
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            s.bind(("127.0.0.1", port))
            return port
        except OSError:
            continue
        finally:
            s.close()
    raise RuntimeError("No free port for the music server")


def _run():
    global _error
    try:
        _server.run()
    except BaseException:
        _error = traceback.format_exc()


def start(files_dir, cache_dir, bin_dir, preferred_port=8765, native_dir=""):
    """Start the server in a background thread (once) and return its port."""
    global _server, _thread, _port, _error
    if _thread is not None and _thread.is_alive():
        return _port
    _error = ""

    here = os.path.dirname(os.path.abspath(__file__))
    os.makedirs(cache_dir, exist_ok=True)
    os.environ.update({
        "AK_PLATFORM": "android",
        "AK_DATA": os.path.join(files_dir, "library"),
        "AK_FRONTEND": here,                      # index.html, app.js … are bundled next to this module
        "AK_COOKIES": os.path.join(files_dir, "cookies.txt"),
        "TMPDIR": cache_dir,
        "XDG_CACHE_HOME": cache_dir,
        "HOME": files_dir,
        "PATH": bin_dir + os.pathsep + os.environ.get("PATH", "/system/bin"),
    })
    try:
        lib_dir = _unpack_ffmpeg_libs(native_dir, files_dir)
    except Exception as e:
        lib_dir = None
        print(f"AK Music Player: couldn't unpack FFmpeg libraries: {e}", file=sys.stderr)
    if lib_dir:
        old = os.environ.get("LD_LIBRARY_PATH", "")
        os.environ["LD_LIBRARY_PATH"] = lib_dir + (os.pathsep + old if old else "")
    tempfile.tempdir = cache_dir
    tools = _check_tools(bin_dir)
    os.environ["AK_TOOLS"] = json.dumps(tools)
    print("AK Music Player tools: " + ", ".join(f"{k}={'ok' if v['ok'] else v['error']}" for k, v in tools.items()),
          file=sys.stderr)

    try:
        from yt_dlp.version import __version__ as bundled
    except Exception:
        bundled = "0"
    # (yt_dlp.version only reads a constant; nothing else of yt-dlp is imported yet)
    for mod in [m for m in sys.modules if m == "yt_dlp" or m.startswith("yt_dlp.")]:
        del sys.modules[mod]
    updated = _use_updated_ytdlp(files_dir, bundled)

    import app      # backend/app.py
    import uvicorn
    import yt_dlp
    print(f"AK Music Player: yt-dlp {yt_dlp.version.__version__}" + (" (self-updated)" if updated else ""), file=sys.stderr)

    _port = _free_port(int(preferred_port))
    config = uvicorn.Config(app.app, host="127.0.0.1", port=_port, log_level="warning", access_log=False,
                            loop="asyncio", http="h11", ws="none", lifespan="off")
    _server = uvicorn.Server(config)
    _thread = threading.Thread(target=_run, name="ak-music-server", daemon=True)
    _thread.start()
    threading.Thread(target=lambda: (time.sleep(30), _update_ytdlp(files_dir, yt_dlp.version.__version__)),
                     name="ak-ytdlp-update", daemon=True).start()
    return _port


def error():
    return _error


def running():
    return _thread is not None and _thread.is_alive()
