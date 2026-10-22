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
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/** Separate signed instrumentation APK; never bundled in the deliverable application. */
public final class RuntimeSmoke extends Instrumentation {
    private WebView web;
    private String eval(String expression) throws Exception {
        CountDownLatch latch = new CountDownLatch(1); String[] result = { "" };
        runOnMainSync(() -> web.evaluateJavascript(expression, value -> { result[0] = value; latch.countDown(); }));
        if (!latch.await(15, TimeUnit.SECONDS)) throw new AssertionError("JS evaluation timed out");
        return result[0];
    }
    private void until(String expression) throws Exception {
        long end = SystemClock.uptimeMillis() + 30000;
        do { if ("true".equals(eval(expression))) return; SystemClock.sleep(200); } while (SystemClock.uptimeMillis() < end);
        throw new AssertionError("Condition failed: " + expression + " -> " + eval(expression));
    }
    private WebView find(View view) {
        if (view instanceof WebView) return (WebView) view;
        if (view instanceof ViewGroup) for (int i=0;i<((ViewGroup)view).getChildCount();i++) {
            WebView found = find(((ViewGroup)view).getChildAt(i)); if (found != null) return found;
        }
        return null;
    }
    private void clickText(String text) {
        long end = SystemClock.uptimeMillis() + 15000;
        do {
            AccessibilityNodeInfo root = getUiAutomation().getRootInActiveWindow();
            if (root != null) {
                List<AccessibilityNodeInfo> nodes = root.findAccessibilityNodeInfosByText(text);
                for (AccessibilityNodeInfo node : nodes) {
                    if (!text.equalsIgnoreCase(String.valueOf(node.getText())) && !text.equalsIgnoreCase(String.valueOf(node.getContentDescription()))) continue;
                    for (AccessibilityNodeInfo current=node;current!=null;current=current.getParent()) {
                        if (current.isClickable() && current.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return;
                    }
                }
            }
            SystemClock.sleep(200);
        } while (SystemClock.uptimeMillis() < end);
        throw new AssertionError("Cannot click native UI: " + text);
    }
    @Override public void onCreate(Bundle arguments) { super.onCreate(arguments); start(); }
    @Override public void onStart() {
        Bundle output = new Bundle();
        try {
            Activity activity = startActivitySync(new Intent(getTargetContext(), MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            runOnMainSync(() -> web = find(activity.getWindow().getDecorView()));
            if (web == null) throw new AssertionError("Main WebView missing");
            until("document.readyState === 'complete' && !!window.FolioAndroid && !document.querySelector('.workspace').inert");
            until("!!document.querySelector('#example') && !document.querySelector('#example').disabled");
            eval("document.querySelector('#example').click()");
            until("!document.querySelector('#export').disabled");
            // Native system picker and byte-for-byte export via the production JS module.
            eval("window.smokeResult='pending'; import('/modules/platform.js').then(m=>m.saveFile(new Blob(['Folio SAF 测试'],{type:'text/html;charset=utf-8'}),'folio-smoke.html')).then(()=>window.smokeResult='saved').catch(e=>window.smokeResult=e.message)");
            clickText("Save");
            until("window.smokeResult === 'saved'");
            eval("window.smokeResult='pending'; import('/modules/platform.js').then(m=>m.saveFile(new Blob(['cancel'],{type:'text/html'}),'folio-cancel.html')).then(()=>window.smokeResult='unexpected').catch(e=>window.smokeResult=e.name)");
            getUiAutomation().performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK);
            until("window.smokeResult === 'AbortError'");
            output.putString("stream", "PASS: workbench, example, real SAF export with charset MIME, real picker cancellation.\n");
            finish(Activity.RESULT_OK, output);
        } catch (Throwable error) {
            output.putString("stream", "FAIL: " + error + "\n"); finish(Activity.RESULT_CANCELED, output);
        }
    }
}
