package com.game101.app;

import android.app.Activity;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

/** Shows the game page bundled in assets/index.html full screen. */
public class MainActivity extends Activity {
    private static final String SITE = "https://khabar6233-jpg.github.io/game-101/";
    private static final String BUNDLED = "file:///android_asset/index.html";
    private WebView web;
    private android.webkit.PermissionRequest pendingMic;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        // the room host runs the game, so the screen must not go to sleep
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        int felt = Color.rgb(11, 63, 37);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(felt);
        // keep the page clear of the status bar, navigation bar and keyboard
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets b = insets.getInsets(
                        WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                v.setPadding(b.left, b.top, b.right, b.bottom);
            } else {
                v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                        insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });

        web = new WebView(this);
        web.setBackgroundColor(felt);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);     // the voices of other players start by themselves
        // Load the newest game from the site; without internet fall back to the copy inside the APK.
        web.setWebViewClient(new WebViewClient() {
            private boolean usedBundled;

            private void useBundled(WebView v) {
                if (usedBundled) return;
                usedBundled = true;
                v.loadUrl(BUNDLED);
            }

            @Override
            public void onReceivedError(WebView v, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) useBundled(v);
            }

            @Override
            public void onReceivedHttpError(WebView v, WebResourceRequest req, WebResourceResponse resp) {
                if (req.isForMainFrame()) useBundled(v);
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            // the voice chat asks for the microphone: pass the question on to Android
            @Override
            public void onPermissionRequest(final android.webkit.PermissionRequest request) {
                boolean audio = false;
                for (String r : request.getResources()) {
                    if (android.webkit.PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) audio = true;
                }
                if (!audio) { request.deny(); return; }
                if (checkSelfPermission(android.Manifest.permission.RECORD_AUDIO)
                        == android.content.pm.PackageManager.PERMISSION_GRANTED) {
                    request.grant(new String[] { android.webkit.PermissionRequest.RESOURCE_AUDIO_CAPTURE });
                } else {
                    pendingMic = request;
                    requestPermissions(new String[] { android.Manifest.permission.RECORD_AUDIO }, 1);
                }
            }
        });
        web.addJavascriptInterface(new Bridge(), "App101");
        root.addView(web, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        web.loadUrl(SITE);
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        if (code != 1 || pendingMic == null) return;
        if (results.length > 0 && results[0] == android.content.pm.PackageManager.PERMISSION_GRANTED) {
            pendingMic.grant(new String[] { android.webkit.PermissionRequest.RESOURCE_AUDIO_CAPTURE });
        } else {
            pendingMic.deny();
        }
        pendingMic = null;
    }

    /** Lets the page buzz the phone: "your move". */
    public class Bridge {
        /** A friend is online or calls to play while the game is not on the screen. */
        @android.webkit.JavascriptInterface
        public void note(String title, String text) {
            try {
                android.app.NotificationManager nm =
                        (android.app.NotificationManager) getSystemService(NOTIFICATION_SERVICE);
                if (nm == null) return;
                android.app.Notification.Builder b;
                if (Build.VERSION.SDK_INT >= 26) {
                    nm.createNotificationChannel(new android.app.NotificationChannel(
                            "game", "101", android.app.NotificationManager.IMPORTANCE_HIGH));
                    b = new android.app.Notification.Builder(MainActivity.this, "game");
                } else {
                    b = new android.app.Notification.Builder(MainActivity.this);
                }
                android.content.Intent open = new android.content.Intent(MainActivity.this, MainActivity.class);
                open.setFlags(android.content.Intent.FLAG_ACTIVITY_SINGLE_TOP | android.content.Intent.FLAG_ACTIVITY_CLEAR_TOP);
                android.app.PendingIntent pi = android.app.PendingIntent.getActivity(MainActivity.this, 0, open,
                        android.app.PendingIntent.FLAG_IMMUTABLE | android.app.PendingIntent.FLAG_UPDATE_CURRENT);
                b.setSmallIcon(getApplicationInfo().icon).setContentTitle(title).setContentText(text)
                        .setAutoCancel(true).setContentIntent(pi);
                nm.notify(1, b.build());
            } catch (Exception e) {
                // notifications are switched off
            }
        }

        /** Android 13+ asks the user once whether the game may show notifications. */
        @android.webkit.JavascriptInterface
        public void askNotify() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        if (Build.VERSION.SDK_INT >= 33
                                && checkSelfPermission("android.permission.POST_NOTIFICATIONS")
                                != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                            requestPermissions(new String[] { "android.permission.POST_NOTIFICATIONS" }, 2);
                        }
                    } catch (Exception e) {
                        // not available
                    }
                }
            });
        }

        @android.webkit.JavascriptInterface
        public void vibrate(int ms) {
            try {
                android.os.Vibrator v = (android.os.Vibrator) getSystemService(VIBRATOR_SERVICE);
                if (v == null) return;
                ms = Math.max(20, Math.min(ms, 1000));
                if (Build.VERSION.SDK_INT >= 26) {
                    v.vibrate(android.os.VibrationEffect.createOneShot(ms, android.os.VibrationEffect.DEFAULT_AMPLITUDE));
                } else {
                    v.vibrate(ms);
                }
            } catch (Exception e) {
                // no vibration motor or it is switched off
            }
        }
    }

    @Override
    protected void onDestroy() {
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
