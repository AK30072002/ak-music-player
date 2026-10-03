"""
Completes the Android FFmpeg bundle at build time.

youtubedl-android's FFmpeg (libffmpeg.zip.so) relies on a few libraries that live in its
Python bundle (libpython.zip.so): libc++_shared, libcrypto, libexpat, libandroid-support, ...
This script follows FFmpeg's whole dependency chain and copies exactly the libraries it needs
from the Python bundle into the FFmpeg bundle. It fails the build if anything is still missing.

usage: python add_ffmpeg_deps.py <libffmpeg.zip.so> <libpython.zip.so> <libffmpeg.so> <libffprobe.so>
"""
import os
import stat
import subprocess
import sys
import tempfile
import zipfile

# libraries every Android phone provides
ANDROID_SYSTEM = {
    "libc.so", "libm.so", "libdl.so", "liblog.so", "libz.so", "libandroid.so", "libmediandk.so",
    "libOpenSLES.so", "libEGL.so", "libGLESv1_CM.so", "libGLESv2.so", "libGLESv3.so", "libvulkan.so",
    "libjnigraphics.so", "libnativewindow.so", "libaaudio.so", "libcamera2ndk.so", "libOpenMAXAL.so",
    "libstdc++.so", "libsync.so", "libbinder_ndk.so",
}


def needed(data: bytes) -> list[str]:
    with tempfile.NamedTemporaryFile(suffix=".so", delete=False) as f:
        f.write(data)
        path = f.name
    try:
        out = subprocess.run(["readelf", "-d", path], capture_output=True, text=True, check=True).stdout
    finally:
        os.unlink(path)
    return [line.split("[", 1)[1].split("]", 1)[0] for line in out.splitlines() if "(NEEDED)" in line]


def is_link(info: zipfile.ZipInfo) -> bool:
    return stat.S_ISLNK(info.external_attr >> 16)


def index(z: zipfile.ZipFile) -> dict:
    return {os.path.basename(i.filename): i for i in z.infolist()
            if i.filename.startswith("usr/lib/") and not i.is_dir()}


def resolve(z, idx, name, chain=None):
    """The real file behind a library name (following symlinks), plus every name on the way."""
    chain = chain or []
    info = idx.get(name)
    if info is None or len(chain) > 10:
        return None, chain
    chain.append(name)
    if is_link(info):
        return resolve(z, idx, z.read(info).decode().strip(), chain)
    return info, chain


def main():
    ff_path, py_path, *programs = sys.argv[1:]
    with zipfile.ZipFile(ff_path) as ff, zipfile.ZipFile(py_path) as py:
        ff_idx, py_idx = index(ff), index(py)
        to_add, seen, missing = [], set(), []
        queue = [open(p, "rb").read() for p in programs]
        while queue:
            for name in needed(queue.pop()):
                if name in seen:
                    continue
                seen.add(name)
                real, _ = resolve(ff, ff_idx, name)
                if real is not None:
                    queue.append(ff.read(real))
                    continue
                real, chain = resolve(py, py_idx, name)
                if real is not None:
                    to_add.extend(n for n in chain + [os.path.basename(real.filename)] if n not in to_add)
                    queue.append(py.read(real))
                elif name not in ANDROID_SYSTEM:
                    missing.append(name)
        if missing:
            sys.exit(f"::error::FFmpeg needs libraries that aren't available: {', '.join(sorted(missing))}")
        payload = [(py_idx[n], py.read(py_idx[n])) for n in to_add]

    with zipfile.ZipFile(ff_path, "a") as ff:
        existing = set(ff.namelist())
        for info, data in payload:
            if info.filename in existing:
                continue
            new = zipfile.ZipInfo(info.filename, date_time=info.date_time)
            new.external_attr = info.external_attr
            new.create_system = 3                               # unix, so symlinks stay symlinks
            new.compress_type = zipfile.ZIP_STORED if is_link(info) else zipfile.ZIP_DEFLATED
            ff.writestr(new, data)
    print(f"FFmpeg loads {len(seen)} libraries; added {len(to_add)} from the Python bundle: {', '.join(to_add)}")


if __name__ == "__main__":
    main()
