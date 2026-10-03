package com.ak.musicplayer;

import android.Manifest;
import android.content.ContentUris;
import android.content.Context;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;

/** The songs and other audio files already stored on the phone (Android's media library). */
final class DeviceAudio {

    private DeviceAudio() {
    }

    static String permission() {
        return Build.VERSION.SDK_INT >= 33 ? "android.permission.READ_MEDIA_AUDIO" : Manifest.permission.READ_EXTERNAL_STORAGE;
    }

    static boolean hasPermission(Context c) {
        return c.checkSelfPermission(permission()) == PackageManager.PERMISSION_GRANTED;
    }

    static Uri collection() {
        return Build.VERSION.SDK_INT >= 29
                ? MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)
                : MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;
    }

    static Uri uriFor(long id) {
        return ContentUris.withAppendedId(collection(), id);
    }

    /** JSON array: [{id,title,artist,album,duration,size,path,mime,added,folder}] newest first. */
    @SuppressWarnings("deprecation")
    static String list(Context c) {
        JSONArray out = new JSONArray();
        String[] proj = {
                MediaStore.Audio.Media._ID,
                MediaStore.Audio.Media.TITLE,
                MediaStore.Audio.Media.ARTIST,
                MediaStore.Audio.Media.ALBUM,
                MediaStore.Audio.Media.DURATION,
                MediaStore.Audio.Media.SIZE,
                MediaStore.Audio.Media.DATA,
                MediaStore.Audio.Media.MIME_TYPE,
                MediaStore.Audio.Media.DATE_ADDED,
                MediaStore.Audio.Media.DISPLAY_NAME,
        };
        Cursor cur = null;
        try {
            cur = c.getContentResolver().query(collection(), proj, null, null,
                    MediaStore.Audio.Media.DATE_ADDED + " DESC");
            if (cur == null) return out.toString();
            while (cur.moveToNext()) {
                String path = cur.getString(6);
                if (path == null || path.isEmpty()) continue;
                long size = cur.getLong(5);
                if (size <= 0) continue;
                JSONObject o = new JSONObject();
                o.put("id", cur.getLong(0));
                String title = cur.getString(1);
                String name = cur.getString(9);
                o.put("title", title != null && !title.isEmpty() ? title : (name != null ? name : new File(path).getName()));
                String artist = cur.getString(2);
                o.put("artist", artist == null || "<unknown>".equals(artist) ? "" : artist);
                String album = cur.getString(3);
                o.put("album", album == null || "<unknown>".equals(album) ? "" : album);
                o.put("duration", cur.getLong(4) / 1000.0);
                o.put("size", size);
                o.put("path", path);
                o.put("mime", cur.getString(7));
                o.put("added", cur.getLong(8));
                File parent = new File(path).getParentFile();
                o.put("folder", parent != null ? parent.getName() : "");
                out.put(o);
            }
        } catch (Exception ignored) {
            // permission missing or media library unavailable: return what we have
        } finally {
            if (cur != null) cur.close();
        }
        return out.toString();
    }
}
