package com.ak.musicplayer;

import android.content.Context;
import android.system.Os;

import com.chaquo.python.PyObject;
import com.chaquo.python.Python;
import com.chaquo.python.android.AndroidPlatform;

import java.io.File;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Starts the built-in music engine: Python (via Chaquopy) running the AK Music Player
 * server on 127.0.0.1, with yt-dlp, FFmpeg and QuickJS bundled inside the APK.
 */
final class ServerManager {

    private ServerManager() {
    }

    static synchronized int start(Context ctx) throws Exception {
        // FFmpeg and QuickJS are packaged as native libraries so Android installs them as
        // executables. Link them under their real names so yt-dlp can find them on the PATH.
        File bin = new File(ctx.getFilesDir(), "bin");
        if (!bin.isDirectory() && !bin.mkdirs()) throw new IOException("Can't create " + bin);
        String libDir = ctx.getApplicationInfo().nativeLibraryDir;
        link(new File(libDir, "libffmpeg.so"), new File(bin, "ffmpeg"));
        link(new File(libDir, "libqjs.so"), new File(bin, "qjs"));

        LoginActivity.exportCookies(ctx);

        if (!Python.isStarted()) Python.start(new AndroidPlatform(ctx));
        PyObject server = Python.getInstance().getModule("akserver");
        File cache = new File(ctx.getCacheDir(), "engine");
        return server.callAttr("start",
                ctx.getFilesDir().getAbsolutePath(),
                cache.getAbsolutePath(),
                bin.getAbsolutePath(),
                8765).toInt();
    }

    /** Error text if the engine thread crashed, otherwise "". */
    static String error() {
        try {
            if (!Python.isStarted()) return "";
            return Python.getInstance().getModule("akserver").callAttr("error").toString();
        } catch (Throwable t) {
            return "";
        }
    }

    static boolean healthy(String base) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(base + "/api/health").openConnection();
            c.setConnectTimeout(1500);
            c.setReadTimeout(3000);
            return c.getResponseCode() == 200;
        } catch (Exception e) {
            return false;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private static void link(File target, File link) {
        // the native library folder changes on every app update, so always recreate the link
        //noinspection ResultOfMethodCallIgnored
        link.delete();
        if (!target.exists()) return;
        try {
            Os.symlink(target.getAbsolutePath(), link.getAbsolutePath());
        } catch (Exception ignored) {
            // the tool just won't be available; the engine falls back gracefully
        }
    }
}
