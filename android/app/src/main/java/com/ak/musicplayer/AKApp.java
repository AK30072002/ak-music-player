package com.ak.musicplayer;

import android.app.Application;
import android.os.Build;

import java.io.File;
import java.io.FileOutputStream;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;
import java.util.Scanner;

/**
 * Records why the app closed if it ever crashes, so the next start can show it under
 * Settings \u2192 Recent problems (that's what gets screenshotted and reported), then lets
 * Android handle the crash as usual.
 */
public class AKApp extends Application {

    static final String CRASH_FILE = "last_crash.txt";

    @Override
    public void onCreate() {
        super.onCreate();
        final Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler(new Thread.UncaughtExceptionHandler() {
            @Override
            public void uncaughtException(Thread t, Throwable e) {
                try {
                    StringWriter sw = new StringWriter();
                    e.printStackTrace(new PrintWriter(sw));
                    String text = "Version " + MainActivity.VERSION + " on Android " + Build.VERSION.RELEASE + " ("
                            + Build.MANUFACTURER + " " + Build.MODEL + "), thread " + t.getName() + ":\n" + sw;
                    record(AKApp.this, text);
                } catch (Throwable ignored) {
                }
                if (previous != null) previous.uncaughtException(t, e);
            }
        });
    }

    static void record(android.content.Context ctx, String text) {
        try {
            if (text.length() > 2500) text = text.substring(0, 2500);
            FileOutputStream out = new FileOutputStream(new File(ctx.getFilesDir(), CRASH_FILE));
            out.write(text.getBytes(StandardCharsets.UTF_8));
            out.close();
        } catch (Throwable ignored) {
        }
    }

    /** The crash report from last time (once), or "". */
    static String takeLastCrash(android.content.Context ctx) {
        File f = new File(ctx.getFilesDir(), CRASH_FILE);
        if (!f.exists()) return "";
        String text = "";
        try (Scanner s = new Scanner(f, "UTF-8")) {
            s.useDelimiter("\\A");
            text = s.hasNext() ? s.next() : "";
        } catch (Throwable ignored) {
        }
        //noinspection ResultOfMethodCallIgnored
        f.delete();
        return text;
    }
}
