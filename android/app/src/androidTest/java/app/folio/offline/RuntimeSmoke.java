package app.folio.offline;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.View;
import android.view.ViewGroup;
import android.view.accessibility.AccessibilityNodeInfo;
import android.webkit.WebView;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/** Separate signed instrumentation APK; never bundled in the deliverable application. */
public final class RuntimeSmoke extends Instrumentation {
    private static final String PLATFORM = "https://appassets.androidplatform.net/modules/platform.js";
    private WebView web;
    private boolean importPdf;
    private String phase = "startup";
    private final StringBuilder evidence = new StringBuilder();

    private String eval(String expression) throws Exception {
        CountDownLatch latch = new CountDownLatch(1);
        String[] result = { "" };
        web.post(() -> web.evaluateJavascript(expression, value -> { result[0] = value; latch.countDown(); }));
        if (!latch.await(15, TimeUnit.SECONDS)) throw new AssertionError("JS evaluation timed out: " + expression);
        return result[0];
    }
    private void until(String expression) throws Exception {
        long end = SystemClock.uptimeMillis() + 30000;
        do {
            if ("true".equals(eval(expression))) return;
            failOnJsError();
            SystemClock.sleep(100);
        } while (SystemClock.uptimeMillis() < end);
        throw new AssertionError("Condition failed: " + expression + " -> " + eval(expression));
    }
    private void failOnJsError() throws Exception {
        if ("true".equals(eval("window.smokeResult?.state === 'error'")))
            throw new AssertionError("JavaScript operation failed: " + eval("window.smokeResult"));
    }
    private WebView find(View view) {
        if (view instanceof WebView) return (WebView) view;
        if (view instanceof ViewGroup) for (int i = 0; i < ((ViewGroup) view).getChildCount(); i++) {
            WebView found = find(((ViewGroup) view).getChildAt(i));
            if (found != null) return found;
        }
        return null;
    }
    private boolean isDocuments(AccessibilityNodeInfo node) {
        if (node == null) return false;
        String pkg = String.valueOf(node.getPackageName());
        return pkg.equals("com.google.android.documentsui") || pkg.equals("com.android.documentsui");
    }
    private void exactNodes(AccessibilityNodeInfo node, String text, List<AccessibilityNodeInfo> out) {
        if (node == null) return;
        if (text.equalsIgnoreCase(String.valueOf(node.getText())) || text.equalsIgnoreCase(String.valueOf(node.getContentDescription()))) out.add(node);
        for (int n = 0; n < node.getChildCount(); n++) exactNodes(node.getChild(n), text, out);
    }
    private boolean hasFilename(AccessibilityNodeInfo root, String filename) {
        List<AccessibilityNodeInfo> nodes = new ArrayList<>();
        exactNodes(root, filename, nodes);
        // DocumentsUI can hide the extension in the editable filename.
        exactNodes(root, filename.substring(0, filename.lastIndexOf('.')), nodes);
        return !nodes.isEmpty();
    }
    private void waitNativeSave(String filename) throws Exception {
        long end = SystemClock.uptimeMillis() + 20000;
        do {
            AccessibilityNodeInfo root = getUiAutomation().getRootInActiveWindow();
            if (isDocuments(root) && hasFilename(root, filename)) return;
            if (!isDocuments(root)) failOnJsError();
            SystemClock.sleep(100);
        } while (SystemClock.uptimeMillis() < end);
        throw new AssertionError("DocumentsUI did not open for " + filename);
    }
    private void clickSave(String filename) throws Exception {
        long end = SystemClock.uptimeMillis() + 15000;
        do {
            AccessibilityNodeInfo root = getUiAutomation().getRootInActiveWindow();
            if (isDocuments(root) && hasFilename(root, filename)) {
                List<AccessibilityNodeInfo> nodes = new ArrayList<>();
                exactNodes(root, "Save", nodes);
                exactNodes(root, "保存", nodes);
                for (AccessibilityNodeInfo node : nodes) {
                    if (!node.isEnabled() || !node.isVisibleToUser()) continue;
                    tap(node);
                    return;
                }
            }
            SystemClock.sleep(100);
        } while (SystemClock.uptimeMillis() < end);
        throw new AssertionError("Cannot click Save for " + filename);
    }
    private void cancelNativeSave(String filename) throws Exception {
        waitNativeSave(filename);
        long end = SystemClock.uptimeMillis() + 15000;
        long nextBack = 0;
        do {
            AccessibilityNodeInfo root = getUiAutomation().getRootInActiveWindow();
            if (!isDocuments(root)) { until("window.smokeResult?.state === 'cancelled'"); return; }
            // First Back can dismiss the keyboard. Retry only while the current picker remains active.
            if (isDocuments(root) && hasFilename(root, filename) && SystemClock.uptimeMillis() >= nextBack) {
                getUiAutomation().performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK);
                nextBack = SystemClock.uptimeMillis() + 750;
            }
            SystemClock.sleep(100);
        } while (SystemClock.uptimeMillis() < end);
        throw new AssertionError("Picker cancellation did not settle for " + filename);
    }
    private void save(String filename, boolean cancel) throws Exception {
        phase = (cancel ? "cancel " : "save ") + filename;
        Bundle progress = new Bundle(); progress.putString("stream", "STEP: " + phase + "\n"); sendStatus(0, progress);
        eval("window.smokeResult={state:'pending',filename:'" + filename + "'}; import('" + PLATFORM + "')"
            + ".then(m=>m.saveFile(new Blob(['Folio SAF 测试'],{type:'text/html;charset=utf-8'}),'" + filename + "'))"
            + ".then(()=>window.smokeResult={state:'saved'})"
            + ".catch(e=>window.smokeResult={state:e.name==='AbortError'?'cancelled':'error',name:e.name,message:e.message,stack:e.stack})");
        waitNativeSave(filename);
        if (cancel) cancelNativeSave(filename);
        else clickSave(filename);
        until("window.smokeResult?.state === '" + (cancel ? "cancelled" : "saved") + "'");
        evidence.append(cancel ? "SAF_CANCEL PASS " : "SAF_SAVE PASS ").append(filename).append('\n');
    }
    private void tap(AccessibilityNodeInfo node) {
        android.graphics.Rect bounds = new android.graphics.Rect();
        node.getBoundsInScreen(bounds);
        if (bounds.isEmpty()) throw new AssertionError("Empty native target bounds");
        long now = SystemClock.uptimeMillis();
        android.view.MotionEvent down = android.view.MotionEvent.obtain(now, now, android.view.MotionEvent.ACTION_DOWN, bounds.centerX(), bounds.centerY(), 0);
        android.view.MotionEvent up = android.view.MotionEvent.obtain(now, now + 80, android.view.MotionEvent.ACTION_UP, bounds.centerX(), bounds.centerY(), 0);
        down.setSource(android.view.InputDevice.SOURCE_TOUCHSCREEN);
        up.setSource(android.view.InputDevice.SOURCE_TOUCHSCREEN);
        try {
            if (!getUiAutomation().injectInputEvent(down, true) || !getUiAutomation().injectInputEvent(up, true))
                throw new AssertionError("Native tap injection failed");
        } finally { down.recycle(); up.recycle(); }
    }
    private void clickNative(String text, boolean documentsOnly) {
        long end = SystemClock.uptimeMillis() + 15000;
        do {
            AccessibilityNodeInfo root = getUiAutomation().getRootInActiveWindow();
            if (root != null && (!documentsOnly || isDocuments(root))) {
                List<AccessibilityNodeInfo> nodes = new ArrayList<>();
                exactNodes(root, text, nodes);
                                for (AccessibilityNodeInfo node : nodes) if (node.isEnabled() && node.isVisibleToUser()) {
                    AccessibilityNodeInfo target = node;
                    if (documentsOnly) for (AccessibilityNodeInfo parent = node; parent != null; parent = parent.getParent())
                        if (parent.isClickable()) { target = parent; break; }
                    tap(target);
                    return;
                }
            }
            SystemClock.sleep(100);
        } while (SystemClock.uptimeMillis() < end);
        throw new AssertionError("Cannot click native target: " + text);
    }
    private void importPdf() throws Exception {
        phase = "real PDF input picker";
        clickNative("打开文档", false);
        clickNative("folio-native-input.pdf", true);
        // Thumbnail loading can reflow the grid between accessibility lookup and injection.
        // Retry only while this exact input picker and fixture remain visible.
        long end = SystemClock.uptimeMillis() + 10000;
        while (isDocuments(getUiAutomation().getRootInActiveWindow())) {
            if (SystemClock.uptimeMillis() >= end) throw new AssertionError("PDF picker did not return after selection");
            SystemClock.sleep(500);
            if (isDocuments(getUiAutomation().getRootInActiveWindow())) clickNative("folio-native-input.pdf", true);
        }
        until("document.querySelector('#source-name').textContent === 'folio-native-input.pdf' && !document.querySelector('#export').disabled && document.querySelector('#preview-loading').hidden && !!document.querySelector('#preview').contentDocument?.body?.textContent.trim()");
        evidence.append("SAF_PDF_IMPORT PASS folio-native-input.pdf\n");
    }
    private void dumpNode(AccessibilityNodeInfo node, StringBuilder out) {
        if (node == null) return;
        out.append(" [").append(node.getPackageName()).append('|').append(node.getText()).append('|').append(node.getContentDescription()).append(']');
        for (int i = 0; i < node.getChildCount(); i++) dumpNode(node.getChild(i), out);
    }
    @Override public void onCreate(Bundle arguments) { importPdf = arguments != null && "1".equals(arguments.getString("importPdf")); super.onCreate(arguments); start(); }
    @Override public void onStart() {
        Bundle output = new Bundle();
        try {
            Activity activity = startActivitySync(new Intent(getTargetContext(), MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
            runOnMainSync(() -> web = find(activity.getWindow().getDecorView()));
            if (web == null) throw new AssertionError("Main WebView missing");
            until("document.readyState === 'complete' && !!window.FolioAndroid && !!document.querySelector('.workspace') && !document.querySelector('.workspace').inert");
            until("!!document.querySelector('#example') && !document.querySelector('#example').disabled");
            // Dedicated test AVD only: settle the app's real recovery UI before driving the workbench.
            eval("if (document.querySelector('#recovery')?.open) document.querySelector('#discard-draft').click()");
            until("!document.querySelector('#recovery')?.open");
            eval("document.querySelector('#example').click()");
            until("!document.querySelector('#export').disabled");
            String run = Long.toString(System.currentTimeMillis());
            // Repeat a save after cancellation to check that the native queue remains usable.
            save("folio-smoke-" + run + ".html", false);
            save("folio-cancel-" + run + ".html", true);
            save("folio-retry-" + run + ".html", false);
            if (importPdf) importPdf();
            output.putString("stream", evidence + "PASS: Folio RuntimeSmoke\n");
            finish(Activity.RESULT_OK, output);
        } catch (Throwable error) {
            evidence.append("FAIL: ").append(phase).append(": ").append(error).append('\n');
            try { evidence.append("JS: ").append(eval("({url:location.href,result:window.smokeResult})")).append('\n'); } catch (Throwable diagnostic) { evidence.append("JS diagnostics: ").append(diagnostic).append('\n'); }
            dumpNode(getUiAutomation().getRootInActiveWindow(), evidence);
            output.putString("stream", evidence.toString());
            finish(Activity.RESULT_CANCELED, output);
        }
    }
}
