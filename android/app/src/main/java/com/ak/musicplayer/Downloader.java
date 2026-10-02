package com.ak.musicplayer;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLDecoder;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Saves a song, playlist zip or backup from the built-in engine into Downloads/AK Music Player. */
final class Downloader {

    static final String FOLDER = "AK Music Player";
    private static final Pattern CD_UTF8 = Pattern.compile("filename\\*=UTF-8''([^;]+)", Pattern.CASE_INSENSITIVE);
    private static final Pattern CD_PLAIN = Pattern.compile("filename=\"([^\"]+)\"", Pattern.CASE_INSENSITIVE);

    private Downloader() {
    }

    static void save(final Activity activity, final String url, final String suggestedName) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                HttpURLConnection c = null;
                try {
                    c = (HttpURLConnection) new URL(url).openConnection();
                    c.setConnectTimeout(15000);
                    c.setReadTimeout(30 * 60 * 1000);   // converting a long playlist can take a while
                    int code = c.getResponseCode();
                    if (code >= 400) throw new IOException(errorText(c));
                    String name = clean(fileName(c.getHeaderField("Content-Disposition"), suggestedName));
                    String mime = c.getContentType();
                    if (mime == null) mime = "application/octet-stream";
                    int semi = mime.indexOf(';');
                    if (semi > 0) mime = mime.substring(0, semi).trim();

                    InputStream in = c.getInputStream();
                    try {
                        if (Build.VERSION.SDK_INT >= 29) saveMediaStore(activity, in, name, mime);
                        else saveLegacy(activity, in, name);
                    } finally {
                        in.close();
                    }
                    toast(activity, "Saved to Downloads/" + FOLDER + ": " + name);
                } catch (Exception e) {
                    toast(activity, "Download failed: " + e.getMessage());
                } finally {
                    if (c != null) c.disconnect();
                }
            }
        }, "ak-download").start();
    }

    private static void saveMediaStore(Activity a, InputStream in, String name, String mime) throws IOException {
        ContentResolver r = a.getContentResolver();
        ContentValues v = new ContentValues();
        v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
        v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
        v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/" + FOLDER);
        v.put(MediaStore.MediaColumns.IS_PENDING, 1);
        Uri uri = r.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
        if (uri == null) throw new IOException("couldn't create the file");
        try {
            OutputStream out = r.openOutputStream(uri);
            if (out == null) throw new IOException("couldn't write the file");
            try {
                copy(in, out);
            } finally {
                out.close();
            }
            v.clear();
            v.put(MediaStore.MediaColumns.IS_PENDING, 0);
            r.update(uri, v, null, null);
        } catch (IOException e) {
            r.delete(uri, null, null);
            throw e;
        }
    }

    @SuppressWarnings("deprecation")
    private static void saveLegacy(Activity a, InputStream in, String name) throws IOException {
        File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), FOLDER);
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("can't create " + dir);
        File f = new File(dir, name);
        int dot = name.lastIndexOf('.');
        for (int i = 2; f.exists(); i++) {
            f = new File(dir, dot > 0 ? name.substring(0, dot) + " (" + i + ")" + name.substring(dot) : name + " (" + i + ")");
        }
        OutputStream out = new FileOutputStream(f);
        try {
            copy(in, out);
        } finally {
            out.close();
        }
        MediaScannerConnection.scanFile(a, new String[]{f.getAbsolutePath()}, null, null);
    }

    private static void copy(InputStream in, OutputStream out) throws IOException {
        byte[] buf = new byte[256 * 1024];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
    }

    private static String fileName(String cd, String fallback) {
        if (cd != null) {
            Matcher m = CD_UTF8.matcher(cd);
            if (m.find()) {
                try {
                    return URLDecoder.decode(m.group(1), "UTF-8");
                } catch (Exception ignored) {
                }
            }
            m = CD_PLAIN.matcher(cd);
            if (m.find()) return m.group(1);
        }
        return (fallback == null || fallback.trim().isEmpty()) ? "AK Music Player download" : fallback;
    }

    private static String clean(String name) {
        String s = name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]+", " ").trim();
        if (s.length() > 150) s = s.substring(0, 150);
        return s.isEmpty() ? "download" : s;
    }

    private static String errorText(HttpURLConnection c) {
        try {
            InputStream es = c.getErrorStream();
            if (es == null) return "error " + c.getResponseCode();
            ByteArrayOutputStream b = new ByteArrayOutputStream();
            copy(es, b);
            es.close();
            return new JSONObject(b.toString("UTF-8")).optString("detail", "error " + c.getResponseCode());
        } catch (Exception e) {
            return "the download didn't work";
        }
    }

    private static void toast(final Activity a, final String msg) {
        a.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                Toast.makeText(a, msg, Toast.LENGTH_LONG).show();
            }
        });
    }
}
