package app.folio.offline;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.provider.DocumentsContract;
import android.view.View;
import android.webkit.JsResult;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.TextView;
import android.widget.FrameLayout;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;

public final class MainActivity extends Activity {
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private static final String START = ORIGIN + "/";
    private static final int PICK_INPUT = 31, PICK_OUTPUT = 32;
    private final ExportState export = new ExportState();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private WebView web, printWeb;
    private WebViewAssetLoader assets;
    private ValueCallback<Uri[]> inputCallback;
    private JavaScriptReplyProxy exportReply;
    private Uri outputUri;
    private OutputStream output;
    private boolean outputPickerPending;
    private final Runnable timeout = () -> failExport("保存超时，已取消并尝试清理未完成文件", true);

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        WebView.setWebContentsDebuggingEnabled(false);
        assets = new WebViewAssetLoader.Builder().addPathHandler("/", path -> {
            String relative = path.isEmpty() ? "index.html" : path;
            // Android's MimeTypeMap does not consistently recognize ES module/wasm extensions.
            if (relative.endsWith(".mjs") || relative.endsWith(".wasm") || relative.endsWith(".bcmap")) {
                if (relative.contains("..") || relative.contains("\\")) return blocked();
                String mime = relative.endsWith(".mjs") ? "text/javascript" : relative.endsWith(".wasm") ? "application/wasm" : "application/octet-stream";
                try { return new WebResourceResponse(mime, null, getAssets().open("www/" + relative)); }
                catch (java.io.IOException e) { return blocked(); }
            }
            return new WebViewAssetLoader.AssetsPathHandler(this).handle("www/" + relative);
        }).build();
        web = new WebView(this);
        FrameLayout container = new FrameLayout(this);
        container.addView(web, new FrameLayout.LayoutParams(-1, -1));
        setContentView(container);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        // Keep Android 15 edge-to-edge content above bars/keyboard.
        container.setOnApplyWindowInsetsListener((v, insets) -> {
            if (android.os.Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets safe = insets.getInsets(android.view.WindowInsets.Type.systemBars()
                        | android.view.WindowInsets.Type.displayCutout() | android.view.WindowInsets.Type.ime());
                v.setPadding(safe.left, safe.top, safe.right, safe.bottom);
            } else v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets;
        });
        container.requestApplyInsets();
        configure(web, true);
        android.content.pm.PackageInfo provider = WebView.getCurrentWebViewPackage();
        int major = 0;
        try { major = Integer.parseInt(provider.versionName.split("\\.")[0]); } catch (Exception ignored) {}
        if (major < 120 || !WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            TextView message = new TextView(this);
            message.setText("此 Android System WebView 版本过旧。请通过系统应用商店更新 Android System WebView / Chrome 后重新打开墨页。");
            message.setPadding(32, 64, 32, 32); setContentView(message); return;
        }
        WebViewCompat.addWebMessageListener(web, "FolioAndroid", Collections.singleton(ORIGIN),
                (view, message, source, mainFrame, reply) -> {
                    if (!ExportState.trusted(source.getScheme(), source.getHost(), source.getPort(), mainFrame)) return;
                    String data = message.getData();
                    if (data != null) receive(data, reply);
                });
        web.setWebViewClient(new LocalClient());
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (inputCallback != null) inputCallback.onReceiveValue(null);
                inputCallback = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                String[] accepted = params.getAcceptTypes();
                ArrayList<String> mimes = new ArrayList<>();
                for (String mime : accepted) if (mime.matches("[a-zA-Z0-9!#$&^_.+*-]+/[a-zA-Z0-9!#$&^_.+*-]+")) mimes.add(mime);
                if (!mimes.isEmpty()) intent.putExtra(Intent.EXTRA_MIME_TYPES, mimes.toArray(new String[0]));
                try { startActivityForResult(intent, PICK_INPUT); }
                catch (RuntimeException e) { inputCallback.onReceiveValue(null); inputCallback = null; }
                return true;
            }
            @Override public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setMessage(message).setPositiveButton("确定", (d,w) -> result.confirm())
                        .setOnCancelListener(d -> result.cancel()).show(); return true;
            }
            @Override public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setMessage(message).setPositiveButton("确定", (d,w) -> result.confirm())
                        .setNegativeButton("取消", (d,w) -> result.cancel()).setOnCancelListener(d -> result.cancel()).show(); return true;
            }
        });
        web.loadUrl(START);
    }

    @SuppressWarnings("deprecation") private void configure(WebView view, boolean scripts) {
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(scripts); settings.setDomStorageEnabled(scripts);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false); settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false); settings.setSupportMultipleWindows(false);
        settings.setGeolocationEnabled(false); settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setBlockNetworkLoads(true);
        settings.setTextZoom(100);
    }
    private static boolean local(Uri uri) { return ExportState.trusted(uri.getScheme(), uri.getHost(), uri.getPort(), true); }
    private static WebResourceResponse blocked() {
        return new WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
    }
    private class LocalClient extends WebViewClient {
        @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            if ("data".equals(request.getUrl().getScheme())) return null;
            if (!local(request.getUrl()) || !"GET".equals(request.getMethod())) return blocked();
            WebResourceResponse response = assets.shouldInterceptRequest(request.getUrl());
            if (response != null && ("/".equals(request.getUrl().getPath()) || "/index.html".equals(request.getUrl().getPath()))) {
                HashMap<String, String> headers = new HashMap<>();
                headers.put("Content-Security-Policy", "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self'; frame-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'");
                headers.put("X-Content-Type-Options", "nosniff");
                response.setResponseHeaders(headers);
            }
            return response == null ? blocked() : response;
        }
        @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            // Main frame can only remain in the packaged workbench. Preview subframes may use blob/srcdoc.
            if (request.isForMainFrame()) return !local(uri) || !("/".equals(uri.getPath()) || "/index.html".equals(uri.getPath()));
            return !(local(uri) || "blob".equals(uri.getScheme()) || "about".equals(uri.getScheme()));
        }
    }
    private void reply(JavaScriptReplyProxy proxy, String id, String error, boolean cancelled) {
        try {
            JSONObject response = new JSONObject().put("id", id);
            if (error == null) response.put("ok", true); else response.put("error", error);
            if (cancelled) response.put("cancelled", true);
            proxy.postMessage(response.toString());
        } catch (Exception ignored) { /* Page may already have closed. */ }
    }
    private void receive(String text, JavaScriptReplyProxy proxy) {
        String id = "";
        try {
            if (text.length() > 9 * 1024 * 1024) throw new IllegalArgumentException("消息过大");
            JSONObject message = new JSONObject(text);
            id = message.getString("id");
            if (!id.matches("[A-Za-z0-9_-]{1,80}")) throw new IllegalArgumentException("无效任务编号");
            String op = message.getString("op");
            if ("print".equals(op)) {
                if (export.active()) throw new IllegalStateException("请先完成保存任务");
                printDocument(id, message.getString("html"), proxy); return;
            }
            if ("begin".equals(op)) {
                if (outputPickerPending) throw new IllegalStateException("请先关闭当前保存位置选择器");
                export.begin(id, message.getString("name"), message.getString("mime"), message.getLong("size"));
                exportReply = proxy;
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                        .setType(message.getString("mime").split(";", 2)[0].trim()).putExtra(Intent.EXTRA_TITLE, message.getString("name"));
                startActivityForResult(intent, PICK_OUTPUT); outputPickerPending = true; armTimeout(); return;
            }
            export.require(id);
            if ("chunk".equals(op)) {
                byte[] data = export.chunk(id, message.getString("data"));
                output.write(data); armTimeout(); reply(proxy, id, null, false);
            } else if ("finish".equals(op)) {
                // Validate completeness before closing; retain URI until close succeeds for error cleanup.
                export.finish(id); output.close(); output = null; outputUri = null;
                handler.removeCallbacks(timeout); exportReply = null; reply(proxy, id, null, false);
            } else if ("abort".equals(op)) {
                cleanup(); reply(proxy, id, null, false);
            } else throw new IllegalArgumentException("不支持的操作");
        } catch (Exception e) {
            // Never let a conflicting caller cancel the current valid task.
            if (id.equals(export.id()) || (outputUri != null && !export.active())) cleanup();
            reply(proxy, id, e.getMessage() == null ? "保存失败" : e.getMessage(), false);
        }
    }
    private void armTimeout() { handler.removeCallbacks(timeout); handler.postDelayed(timeout, 5 * 60 * 1000L); }
    private void failExport(String message, boolean cancelled) {
        String id = export.id(); JavaScriptReplyProxy proxy = exportReply;
        cleanup(); if (id != null && proxy != null) reply(proxy, id, message, cancelled);
    }
    private void cleanup() {
        handler.removeCallbacks(timeout);
        if (output != null) { try { output.close(); } catch (Exception ignored) {} output = null; }
        if (outputUri != null) {
            try { DocumentsContract.deleteDocument(getContentResolver(), outputUri); } catch (Exception ignored) {}
            outputUri = null;
        }
        export.reset(); exportReply = null;
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == PICK_INPUT && inputCallback != null) {
            ArrayList<Uri> uris = new ArrayList<>();
            if (result == RESULT_OK && data != null) {
                ClipData clips = data.getClipData();
                if (clips != null) for (int i=0; i<Math.min(clips.getItemCount(), 500); i++) {
                    Uri uri = clips.getItemAt(i).getUri(); if (uri != null && "content".equals(uri.getScheme())) uris.add(uri);
                }
                else if (data.getData() != null && "content".equals(data.getData().getScheme())) uris.add(data.getData());
            }
            inputCallback.onReceiveValue(uris.isEmpty() ? null : uris.toArray(new Uri[0])); inputCallback = null;
        }
        if (request == PICK_OUTPUT) {
            outputPickerPending = false;
            Uri selected = result == RESULT_OK && data != null ? data.getData() : null;
            if (!export.active()) { // Picker returned after timeout/abort: discard its newly created document.
                if (selected != null) try { DocumentsContract.deleteDocument(getContentResolver(), selected); } catch (Exception ignored) {}
                return;
            }
            if (selected == null) { failExport("已取消保存", true); return; }
            try {
                if (!"content".equals(selected.getScheme())) throw new IllegalArgumentException("保存位置必须由系统文档提供器授权");
                outputUri = selected;
                output = getContentResolver().openOutputStream(outputUri, "wt");
                if (output == null) throw new IllegalStateException("无法打开所选保存位置");
                export.open(export.id()); armTimeout(); reply(exportReply, export.id(), null, false);
            } catch (Exception e) { failExport("无法创建文件：" + e.getMessage(), false); }
        }
    }
    private void printDocument(String id, String html, JavaScriptReplyProxy proxy) {
        if (printWeb != null) throw new IllegalStateException("已有打印预览");
        if (html.getBytes(StandardCharsets.UTF_8).length > 8 * 1024 * 1024) throw new IllegalArgumentException("打印 HTML 超过 8 MiB，请导出 HTML 后打印");
        printWeb = new WebView(this); configure(printWeb, false);
        final boolean[] launched = { false };
        WebView printing = printWeb;
        printing.setWebViewClient(new LocalClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) { return true; }
            @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                // Export HTML is self-contained. It gets neither bridge, scripts nor packaged resources.
                if ("data".equals(r.getUrl().getScheme())) return null;
                return blocked();
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (launched[0]) return;
                launched[0] = true;
                try {
                    PrintManager manager = (PrintManager) getSystemService(PRINT_SERVICE);
                    manager.print("Folio", view.createPrintDocumentAdapter("Folio"), new PrintAttributes.Builder().build());
                    reply(proxy, id, null, false);
                } catch (Exception e) { reply(proxy, id, "无法启动系统打印服务", false); printing.destroy(); printWeb = null; }
            }
        });
        printing.loadDataWithBaseURL("https://print.invalid/", html, "text/html", "UTF-8", null);
        // Android printing needs this WebView alive until the system print UI returns.
    }
    @Override protected void onResume() {
        super.onResume();
        if (printWeb != null) { printWeb.destroy(); printWeb = null; }
    }
    @Override public void onBackPressed() {
        if (web == null) { super.onBackPressed(); return; }
        web.evaluateJavascript("Boolean(window.FolioAndroidBack && window.FolioAndroidBack())", handled -> {
            if ("true".equals(handled)) return;
            new AlertDialog.Builder(this).setTitle("退出墨页？")
                    .setMessage(export.active() ? "当前保存尚未完成，退出将取消保存。请先保存需要保留的项目。" : "请确认需要保留的内容已保存为项目或导出。")
                    .setPositiveButton("退出", (d,w) -> finish()).setNegativeButton("继续编辑", null).show();
        });
    }
    @Override protected void onDestroy() {
        cleanup(); if (inputCallback != null) inputCallback.onReceiveValue(null);
        if (printWeb != null) printWeb.destroy();
        if (web != null) web.destroy(); super.onDestroy();
    }
}
