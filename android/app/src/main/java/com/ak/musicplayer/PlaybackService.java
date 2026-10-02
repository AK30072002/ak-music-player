package com.ak.musicplayer;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.drawable.Icon;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Keeps AK Music Player alive while music plays in the background and shows the
 * "now playing" notification with play/pause, next and previous. The same controls
 * work from the lock screen, Bluetooth headphones and car stereos (MediaSession).
 */
public class PlaybackService extends Service {

    static volatile boolean running = false;

    static final String CHANNEL = "playback";
    static final int NOTIFICATION_ID = 7;
    static final String ACTION_UPDATE = "com.ak.musicplayer.UPDATE";
    static final String ACTION_TOGGLE = "com.ak.musicplayer.TOGGLE";
    static final String ACTION_NEXT = "com.ak.musicplayer.NEXT";
    static final String ACTION_PREV = "com.ak.musicplayer.PREV";
    static final String ACTION_STOP = "com.ak.musicplayer.STOP";

    private MediaSession session;
    private WifiManager.WifiLock wifiLock;
    private final Handler main = new Handler(Looper.getMainLooper());

    private String title = "";
    private String artist = "";
    private String coverUrl = "";
    private boolean playing = false;
    private Bitmap art;

    @Override
    public void onCreate() {
        super.onCreate();
        running = true;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        NotificationChannel ch = new NotificationChannel(CHANNEL, getString(R.string.channel_name), NotificationManager.IMPORTANCE_LOW);
        ch.setDescription(getString(R.string.channel_desc));
        ch.setShowBadge(false);
        nm.createNotificationChannel(ch);

        session = new MediaSession(this, "AKMusicPlayer");
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { send("play"); }
            @Override public void onPause() { send("pause"); }
            @Override public void onSkipToNext() { send("next"); }
            @Override public void onSkipToPrevious() { send("prev"); }
            @Override public void onStop() { send("pause"); }
        });
        session.setActive(true);

        WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (wm != null) {
            wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "akmusic:stream");
            wifiLock.setReferenceCounted(false);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_STOP.equals(action)) {
            send("pause");
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }
        if (ACTION_TOGGLE.equals(action)) send("toggle");
        else if (ACTION_NEXT.equals(action)) send("next");
        else if (ACTION_PREV.equals(action)) send("prev");
        else if (ACTION_UPDATE.equals(action) && intent != null) {
            title = nz(intent.getStringExtra("title"));
            artist = nz(intent.getStringExtra("artist"));
            playing = intent.getBooleanExtra("playing", false);
            String cover = nz(intent.getStringExtra("cover"));
            if (!cover.equals(coverUrl)) {
                coverUrl = cover;
                art = null;
                loadArt(cover);
            }
        }
        if (wifiLock != null) {
            if (playing) wifiLock.acquire();
            else if (wifiLock.isHeld()) wifiLock.release();
        }
        Notification n = build();
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, n);
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // the app was swiped away from recents: stop like other music players do
        stopForeground(true);
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        running = false;
        if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
        if (session != null) session.release();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // ------------------------------------------------------------------
    private static String nz(String s) {
        return s == null ? "" : s;
    }

    private void send(String cmd) {
        MainActivity.runJs("window.akCommand && window.akCommand('" + cmd + "')");
    }

    private PendingIntent servicePI(String action, int code) {
        Intent i = new Intent(this, PlaybackService.class);
        i.setAction(action);
        return PendingIntent.getService(this, code, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private Notification.Action action(int icon, String label, String act, int code) {
        return new Notification.Action.Builder(Icon.createWithResource(this, icon), label, servicePI(act, code)).build();
    }

    private Notification build() {
        MediaMetadata.Builder meta = new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, title)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
                .putString(MediaMetadata.METADATA_KEY_ALBUM, "AK Music Player");
        if (art != null) meta.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, art);
        session.setMetadata(meta.build());
        session.setPlaybackState(new PlaybackState.Builder()
                .setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE
                        | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_STOP)
                .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
                        PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1f)
                .build());

        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        PendingIntent contentPI = PendingIntent.getActivity(this, 0, open,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        Notification.Builder b = new Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_ak)
                .setContentTitle(title.isEmpty() ? "AK Music Player" : title)
                .setContentText(artist)
                .setContentIntent(contentPI)
                .setDeleteIntent(servicePI(ACTION_STOP, 5))
                .setOngoing(playing)
                .setShowWhen(false)
                .setColor(0xFFF44336)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .addAction(action(R.drawable.ic_prev, "Previous", ACTION_PREV, 1))
                .addAction(action(playing ? R.drawable.ic_pause : R.drawable.ic_play, playing ? "Pause" : "Play", ACTION_TOGGLE, 2))
                .addAction(action(R.drawable.ic_next, "Next", ACTION_NEXT, 3))
                .addAction(action(R.drawable.ic_close, "Close", ACTION_STOP, 4))
                .setStyle(new Notification.MediaStyle()
                        .setMediaSession(session.getSessionToken())
                        .setShowActionsInCompactView(0, 1, 2));
        if (art != null) b.setLargeIcon(art);
        return b.build();
    }

    private void refresh() {
        if (!running) return;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        nm.notify(NOTIFICATION_ID, build());
    }

    private void loadArt(final String url) {
        if (url.isEmpty()) return;
        new Thread(new Runnable() {
            @Override
            public void run() {
                Bitmap bmp = null;
                HttpURLConnection c = null;
                try {
                    c = (HttpURLConnection) new URL(url).openConnection();
                    c.setConnectTimeout(8000);
                    c.setReadTimeout(8000);
                    InputStream in = c.getInputStream();
                    Bitmap raw = BitmapFactory.decodeStream(in);
                    in.close();
                    if (raw != null) {
                        int side = Math.min(raw.getWidth(), raw.getHeight());
                        Bitmap sq = Bitmap.createBitmap(raw, (raw.getWidth() - side) / 2, (raw.getHeight() - side) / 2, side, side);
                        bmp = Bitmap.createScaledBitmap(sq, 512, 512, true);
                    }
                } catch (Exception ignored) {
                } finally {
                    if (c != null) c.disconnect();
                }
                final Bitmap result = bmp;
                main.post(new Runnable() {
                    @Override
                    public void run() {
                        if (url.equals(coverUrl)) {
                            art = result;
                            refresh();
                        }
                    }
                });
            }
        }).start();
    }
}
