package com.ak.musicplayer;

import android.app.Activity;
import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.util.HashSet;
import java.util.Set;

/**
 * Lets you sign in to Instagram, Facebook or X inside the app. Many posts on these sites
 * only play for signed-in users; the login cookies are handed to yt-dlp and never leave the phone.
 */
public class LoginActivity extends Activity {

    static final String EXTRA_SITE = "site";

    // site key, display name, login page, cookie that proves you're signed in, cookie URL
    private static final String[][] SITES = {
            {"instagram", "Instagram", "https://www.instagram.com/accounts/login/", "sessionid", "https://www.instagram.com"},
            {"facebook", "Facebook", "https://m.facebook.com/login/", "c_user", "https://www.facebook.com"},
            {"x", "X", "https://x.com/i/flow/login", "auth_token", "https://x.com"},
    };
    // cookie domains written to cookies.txt for yt-dlp
    private static final String[][] COOKIE_DOMAINS = {
            {"instagram.com", "https://www.instagram.com"},
            {"facebook.com", "https://www.facebook.com"},
            {"facebook.com", "https://m.facebook.com"},
            {"x.com", "https://x.com"},
            {"twitter.com", "https://twitter.com"},
    };

    private WebView web;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        String key = getIntent().getStringExtra(EXTRA_SITE);
        String[] site = SITES[0];
        for (String[] s : SITES) if (s[0].equals(key)) site = s;

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.parseColor("#14201A"));

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(18), dp(8), dp(8), dp(8));

        TextView title = new TextView(this);
        title.setText("Sign in to " + site[1]);
        title.setTextColor(Color.WHITE);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        bar.addView(title, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));

        Button done = new Button(this);
        done.setText("Done");
        done.setAllCaps(false);
        done.setOnClickListener(new android.view.View.OnClickListener() {
            @Override
            public void onClick(android.view.View v) {
                finishLogin();
            }
        });
        bar.addView(done);

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(web, true);
        web.setWebViewClient(new WebViewClient());

        root.addView(bar, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        root.addView(web, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(root);
        web.loadUrl(site[2]);
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private void finishLogin() {
        exportCookies(this);
        setResult(RESULT_OK);
        finish();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else finishLogin();
    }

    @Override
    protected void onDestroy() {
        if (web != null) web.destroy();
        super.onDestroy();
    }

    // ------------------------------------------------------------------ cookies for yt-dlp

    /** Writes the signed-in sites' cookies to files/cookies.txt (Netscape format, read by yt-dlp). */
    static void exportCookies(Context ctx) {
        try {
            CookieManager cm = CookieManager.getInstance();
            cm.flush();
            StringBuilder sb = new StringBuilder("# Netscape HTTP Cookie File\n");
            long expires = System.currentTimeMillis() / 1000 + 365L * 24 * 3600;
            Set<String> seen = new HashSet<>();
            for (String[] d : COOKIE_DOMAINS) {
                String all = cm.getCookie(d[1]);
                if (all == null) continue;
                for (String part : all.split(";")) {
                    int eq = part.indexOf('=');
                    if (eq <= 0) continue;
                    String name = part.substring(0, eq).trim();
                    String value = part.substring(eq + 1).trim();
                    if (!seen.add(d[0] + "|" + name)) continue;
                    sb.append('.').append(d[0]).append("\tTRUE\t/\tTRUE\t").append(expires)
                            .append('\t').append(name).append('\t').append(value).append('\n');
                }
            }
            FileOutputStream out = new FileOutputStream(new File(ctx.getFilesDir(), "cookies.txt"));
            try {
                out.write(sb.toString().getBytes("UTF-8"));
            } finally {
                out.close();
            }
        } catch (Throwable ignored) {
            // no WebView available yet, or nothing to save
        }
    }

    /** {"instagram":true,"facebook":false,"x":false} */
    static String status() {
        JSONObject o = new JSONObject();
        try {
            CookieManager cm = CookieManager.getInstance();
            for (String[] s : SITES) {
                String c = cm.getCookie(s[4]);
                o.put(s[0], c != null && (c.startsWith(s[3] + "=") || c.contains(" " + s[3] + "=") || c.contains(";" + s[3] + "=")));
            }
        } catch (Throwable ignored) {
        }
        return o.toString();
    }

    static void signOut(Context ctx) {
        CookieManager cm = CookieManager.getInstance();
        cm.removeAllCookies(null);
        cm.flush();
        //noinspection ResultOfMethodCallIgnored
        new File(ctx.getFilesDir(), "cookies.txt").delete();
    }
}
