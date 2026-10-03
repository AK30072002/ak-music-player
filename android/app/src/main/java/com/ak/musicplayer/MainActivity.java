package com.ak.musicplayer;

import android.Manifest;
import android.app.Activity;
import android.app.PendingIntent;
import android.app.RecoverableSecurityException;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.provider.Settings;
import android.view.View;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.lang.ref.WeakReference;
import java.net.URLEncoder;
import java.io.File;
import java.util.ArrayList;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * AK Music Player for Android.
 * Everything runs on the phone: a built-in music engine (Python + yt-dlp + FFmpeg + QuickJS,
 * see ServerManager) serves the player at 127.0.0.1, shown full-screen in a WebView, with
 * native extras: notification / lock-screen controls, background playback, downloads to the
 * Downloads folder, file picking, sign-in for Instagram/Facebook/X, and "Share to AK Music Player".
 */
public class MainActivity extends Activity {

    public static final String VERSION = "2.2.0";
    static final String LOADING_URL = "file:///android_asset/loading.html";

    private static final int REQ_FILE = 11;
    private static final int REQ_NOTIFY = 12;
    private static final int REQ_STORAGE = 14;
    private static final int REQ_LOGIN = 15;
    private static final int REQ_AUDIO = 16;
    private static final int REQ_DELETE = 17;
    private static final int REQ_STORAGE_DELETE = 18;
    private static final Pattern URL_RE = Pattern.compile("https?://\\S+");

    static WeakReference<MainActivity> current = new WeakReference<>(null);

    WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private String pendingShare;
    private boolean askedNotify;
    private volatile String base;          // http://127.0.0.1:<port> once the engine is up
    private volatile boolean starting;
    private volatile String engineError = "";
    private String pendingDownloadUrl, pendingDownloadName;
    private JSONArray pendingDelete;       // phone files waiting for the user's delete confirmation
    private int deleteIndex;                // Android 10: files are confirmed one at a time

    // ------------------------------------------------------------------ lifecycle
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        current = new WeakReference<>(this);

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#14201A"));
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setUserAgentString(s.getUserAgentString() + " AKMusicPlayerApp/" + VERSION);
        CookieManager.getInstance().setAcceptCookie(true);

        clearCacheAfterUpdate();
        web.addJavascriptInterface(new Bridge(), "AKAndroid");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        web.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition,
                                        String mimeType, long contentLength) {
                download(url, URLUtil.guessFileName(url, contentDisposition, mimeType));
            }
        });

        handleShare(getIntent(), true);
        web.loadUrl(LOADING_URL);
        startEngine();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleShare(intent, false);
    }

    @Override
    protected void onDestroy() {
        stopService(new Intent(this, PlaybackService.class));
        if (web != null) {
            web.destroy();
        }
        super.onDestroy();
    }

    // Note: we deliberately do NOT call web.onPause() so music keeps playing in the background.

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        web.evaluateJavascript("(window.akBack && window.akBack()) ? '1' : '0'", new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String value) {
                if ("\"1\"".equals(value)) return;
                if (web.canGoBack()) web.goBack();
                else moveTaskToBack(true);   // keep playing, like other music apps
            }
        });
    }

    /** A newly installed version must never show the previous version's player screens. */
    @SuppressWarnings("deprecation")
    private void clearCacheAfterUpdate() {
        try {
            long installed = getPackageManager().getPackageInfo(getPackageName(), 0).lastUpdateTime;
            android.content.SharedPreferences sp = getSharedPreferences("ak_app", MODE_PRIVATE);
            if (sp.getLong("web_cache_for", 0) != installed) {
                web.clearCache(true);
                sp.edit().putLong("web_cache_for", installed).apply();
            }
        } catch (Exception ignored) {
        }
    }

    // ------------------------------------------------------------------ engine & navigation
    void startEngine() {
        if (starting) return;
        starting = true;
        engineError = "";
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    int port = ServerManager.start(getApplicationContext());
                    String b = "http://127.0.0.1:" + port;
                    long deadline = System.currentTimeMillis() + 120000;
                    boolean ok = false;
                    while (System.currentTimeMillis() < deadline) {
                        if (ServerManager.healthy(b)) {
                            ok = true;
                            break;
                        }
                        String err = ServerManager.error();
                        if (!err.isEmpty()) throw new RuntimeException(err);
                        Thread.sleep(300);
                    }
                    if (!ok) throw new RuntimeException("The music engine took too long to start.");
                    base = b;
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            loadApp();
                        }
                    });
                } catch (Throwable e) {
                    String msg = e.getMessage();
                    engineError = (msg == null || msg.isEmpty()) ? e.toString() : msg;
                } finally {
                    starting = false;
                }
            }
        }, "ak-engine-start").start();
    }

    void loadApp() {
        if (base == null) return;
        String url = base + "/";
        if (pendingShare != null) {
            url += "?url=" + enc(pendingShare);
            pendingShare = null;
        }
        web.loadUrl(url);
    }

    private boolean onAppPage() {
        String u = web.getUrl();
        return u != null && base != null && u.startsWith(base);
    }

    private void handleShare(Intent intent, boolean initial) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        if (text == null) return;
        Matcher m = URL_RE.matcher(text);
        if (!m.find()) {
            Toast.makeText(this, "No link found in what you shared", Toast.LENGTH_SHORT).show();
            return;
        }
        String link = m.group();
        if (!initial && onAppPage()) {
            runJs("window.akShared && window.akShared(" + JSONObject.quote(link) + ")");
        } else {
            pendingShare = link;
            if (!initial && base != null) loadApp();
        }
    }

    static void runJs(final String js) {
        final MainActivity a = current.get();
        if (a == null || a.web == null) return;
        a.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                a.web.evaluateJavascript(js, null);
            }
        });
    }

    static String enc(String s) {
        try {
            return URLEncoder.encode(s, "UTF-8");
        } catch (Exception e) {
            return s;
        }
    }

    // ------------------------------------------------------------------ downloads
    void download(String url, String name) {
        if (Build.VERSION.SDK_INT < 29
                && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            pendingDownloadUrl = url;
            pendingDownloadName = name;
            requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_STORAGE);
            return;
        }
        Toast.makeText(this, "Downloading... you'll get a message when it's saved", Toast.LENGTH_SHORT).show();
        Downloader.save(this, url, name);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        boolean granted = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
        if (requestCode == REQ_AUDIO) {
            boolean canAskAgain = shouldShowRequestPermissionRationale(DeviceAudio.permission());
            runJs("window.akAudioPermission && window.akAudioPermission(" + granted + "," + canAskAgain + ")");
            return;
        }
        if (requestCode == REQ_STORAGE_DELETE) {
            if (granted && pendingDelete != null) deleteDirect();
            else finishDelete(false, "Allow storage access to delete files");
            return;
        }
        if (requestCode == REQ_STORAGE) {
            if (granted && pendingDownloadUrl != null) download(pendingDownloadUrl, pendingDownloadName);
            else if (!granted) Toast.makeText(this, "Allow storage access to save downloads", Toast.LENGTH_LONG).show();
            pendingDownloadUrl = null;
        }
    }

    // ------------------------------------------------------------------ deleting songs from the phone
    /** items: JSON array of {id, path}. The user always confirms; deleted files are gone for good. */
    void deleteDeviceAudio(String json) {
        try {
            pendingDelete = new JSONArray(json);
            deleteIndex = 0;
            if (pendingDelete.length() == 0) {
                finishDelete(false, "nothing selected");
                return;
            }
            if (Build.VERSION.SDK_INT >= 30) {
                ArrayList<Uri> uris = new ArrayList<>();
                for (int i = 0; i < pendingDelete.length(); i++) {
                    uris.add(DeviceAudio.uriFor(pendingDelete.getJSONObject(i).getLong("id")));
                }
                PendingIntent pi = MediaStore.createDeleteRequest(getContentResolver(), uris);
                startIntentSenderForResult(pi.getIntentSender(), REQ_DELETE, null, 0, 0, 0);
                return;
            }
            if (Build.VERSION.SDK_INT < 29
                    && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_STORAGE_DELETE);
                return;
            }
            deleteDirect();
        } catch (Exception e) {
            finishDelete(false, e.getMessage());
        }
    }

    /** Android 10 and older: delete through the media library, one file at a time. */
    private void deleteDirect() {
        try {
            while (pendingDelete != null && deleteIndex < pendingDelete.length()) {
                JSONObject item = pendingDelete.getJSONObject(deleteIndex);
                Uri uri = DeviceAudio.uriFor(item.getLong("id"));
                try {
                    getContentResolver().delete(uri, null, null);
                } catch (SecurityException se) {
                    if (Build.VERSION.SDK_INT == 29 && se instanceof RecoverableSecurityException) {
                        startIntentSenderForResult(((RecoverableSecurityException) se).getUserAction()
                                .getActionIntent().getIntentSender(), REQ_DELETE, null, 0, 0, 0);
                        return;    // continues in onActivityResult
                    }
                    throw se;
                }
                File f = new File(item.optString("path", ""));
                if (Build.VERSION.SDK_INT < 29 && f.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    f.delete();
                }
                deleteIndex++;
            }
            finishDelete(true, "");
        } catch (Exception e) {
            finishDelete(deleteIndex > 0, e.getMessage());
        }
    }

    private void finishDelete(boolean ok, String message) {
        pendingDelete = null;
        runJs("window.akDeviceDeleted && window.akDeviceDeleted(" + ok + "," + JSONObject.quote(message == null ? "" : message) + ")");
    }

    // ------------------------------------------------------------------ file picker (upload songs, restore backup)
    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_DELETE) {
            if (resultCode != RESULT_OK) finishDelete(false, "cancelled");
            else if (Build.VERSION.SDK_INT >= 30) finishDelete(true, "");
            else deleteDirect();                       // Android 10: permission granted for this file, continue
            return;
        }
        if (requestCode == REQ_LOGIN) {
            runJs("window.akAccountsChanged && window.akAccountsChanged()");
            return;
        }
        if (requestCode != REQ_FILE || fileCallback == null) {
            super.onActivityResult(requestCode, resultCode, data);
            return;
        }
        Uri[] result = null;
        if (resultCode == RESULT_OK && data != null) {
            ClipData clip = data.getClipData();
            if (clip != null && clip.getItemCount() > 0) {
                result = new Uri[clip.getItemCount()];
                for (int i = 0; i < clip.getItemCount(); i++) result[i] = clip.getItemAt(i).getUri();
            } else if (data.getData() != null) {
                result = new Uri[]{data.getData()};
            }
        }
        fileCallback.onReceiveValue(result);
        fileCallback = null;
    }

    private class Chrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            boolean wantsJson = false;
            for (String t : params.getAcceptTypes()) if (t != null && t.contains("json")) wantsJson = true;
            Intent i = new Intent(Intent.ACTION_GET_CONTENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType(wantsJson ? "*/*" : "audio/*");
            if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            try {
                startActivityForResult(Intent.createChooser(i, wantsJson ? "Choose backup file" : "Choose songs"), REQ_FILE);
                return true;
            } catch (ActivityNotFoundException e) {
                fileCallback = null;
                return false;
            }
        }
    }

    // ------------------------------------------------------------------ page loading
    private class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            String url = request.getUrl().toString();
            if (url.startsWith("file:///android_asset/")) return false;
            if (base != null && url.startsWith(base)) return false;
            openExternal(url);
            return true;
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (!request.isForMainFrame()) return;
            String url = request.getUrl().toString();
            if (url.startsWith("file:")) return;
            engineError = "The music engine stopped (" + error.getDescription() + ").";
            view.loadUrl(LOADING_URL);
        }
    }

    void openExternal(String url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (Exception e) {
            Toast.makeText(this, "No app can open this link", Toast.LENGTH_SHORT).show();
        }
    }

    // ------------------------------------------------------------------ JavaScript bridge (window.AKAndroid)
    private class Bridge {
        @JavascriptInterface
        public String version() {
            return VERSION;
        }

        /** For the loading screen: {"state":"starting"|"ready"|"error","error":"..."} */
        @JavascriptInterface
        public String engineState() {
            try {
                JSONObject o = new JSONObject();
                if (!engineError.isEmpty()) {
                    o.put("state", "error");
                    o.put("error", engineError);
                } else {
                    o.put("state", base != null ? "ready" : "starting");
                }
                return o.toString();
            } catch (Exception e) {
                return "{\"state\":\"starting\"}";
            }
        }

        @JavascriptInterface
        public void retry() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (base != null && ServerManager.healthy(base) && engineError.isEmpty()) {
                        loadApp();
                        return;
                    }
                    base = null;
                    engineError = "";
                    web.loadUrl(LOADING_URL);
                    startEngine();
                }
            });
        }

        @JavascriptInterface
        public void openApp() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    loadApp();
                }
            });
        }

        @JavascriptInterface
        public void signIn(final String site) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Intent i = new Intent(MainActivity.this, LoginActivity.class);
                    i.putExtra(LoginActivity.EXTRA_SITE, site);
                    startActivityForResult(i, REQ_LOGIN);
                }
            });
        }

        /** The built-in editor (Android's own decoders/encoders), used when FFmpeg can't run. */
        @JavascriptInterface
        public void editAudio(final String jobId, String json) {
            AudioEditor.run(json, new AudioEditor.Callback() {
                @Override
                public void done(boolean ok, String payload) {
                    runJs("window.akEditDone && window.akEditDone(" + JSONObject.quote(jobId) + "," + ok + ","
                            + JSONObject.quote(payload) + ")");
                }
            });
        }

        @JavascriptInterface
        public boolean hasAudioPermission() {
            return DeviceAudio.hasPermission(MainActivity.this);
        }

        @JavascriptInterface
        public void requestAudioPermission() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    requestPermissions(new String[]{DeviceAudio.permission()}, REQ_AUDIO);
                }
            });
        }

        @JavascriptInterface
        public String listDeviceAudio() {
            return DeviceAudio.hasPermission(MainActivity.this) ? DeviceAudio.list(MainActivity.this) : "[]";
        }

        @JavascriptInterface
        public void deleteDeviceAudio(final String json) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    MainActivity.this.deleteDeviceAudio(json);
                }
            });
        }

        @JavascriptInterface
        public void openAppSettings() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                            Uri.fromParts("package", getPackageName(), null));
                    startActivity(i);
                }
            });
        }

        @JavascriptInterface
        public String accounts() {
            return LoginActivity.status();
        }

        @JavascriptInterface
        public void signOut() {
            LoginActivity.signOut(MainActivity.this);
        }

        @JavascriptInterface
        public void onState(String json) {
            try {
                JSONObject o = new JSONObject(json);
                boolean playing = o.optBoolean("playing");
                Intent i = new Intent(MainActivity.this, PlaybackService.class);
                i.setAction(PlaybackService.ACTION_UPDATE);
                i.putExtra("title", o.optString("title"));
                i.putExtra("artist", o.optString("artist"));
                i.putExtra("cover", o.optString("cover"));
                i.putExtra("playing", playing);
                if (PlaybackService.running) {
                    startService(i);
                } else if (playing) {
                    askNotificationPermission();
                    startForegroundService(i);
                }
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public void download(final String url, final String name) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    MainActivity.this.download(url, name);
                }
            });
        }

        @JavascriptInterface
        public void openExternal(final String url) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    MainActivity.this.openExternal(url);
                }
            });
        }

        @JavascriptInterface
        public void copy(String text) {
            ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
            cm.setPrimaryClip(ClipData.newPlainText("link", text));
        }

        @JavascriptInterface
        public String getClipboard() {
            ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
            ClipData clip = cm.getPrimaryClip();
            if (clip == null || clip.getItemCount() == 0) return "";
            CharSequence t = clip.getItemAt(0).coerceToText(MainActivity.this);
            return t == null ? "" : t.toString();
        }

        @JavascriptInterface
        public void setTheme(final String color, final boolean light) {
            runOnUiThread(new Runnable() {
                @Override
                @SuppressWarnings("deprecation")
                public void run() {
                    try {
                        int c = Color.parseColor(color);
                        Window w = getWindow();
                        w.setStatusBarColor(c);
                        w.setNavigationBarColor(c);
                        View d = w.getDecorView();
                        int flags = d.getSystemUiVisibility();
                        int lightFlags = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                        d.setSystemUiVisibility(light ? (flags | lightFlags) : (flags & ~lightFlags));
                    } catch (Exception ignored) {
                    }
                }
            });
        }

        @JavascriptInterface
        public void toast(String msg) {
            final String m = msg;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Toast.makeText(MainActivity.this, m, Toast.LENGTH_SHORT).show();
                }
            });
        }
    }

    private void askNotificationPermission() {
        if (askedNotify || Build.VERSION.SDK_INT < 33) return;
        askedNotify = true;
        if (checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, REQ_NOTIFY);
                }
            });
        }
    }
}
