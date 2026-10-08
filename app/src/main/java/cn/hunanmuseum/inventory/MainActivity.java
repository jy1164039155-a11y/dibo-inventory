package cn.hunanmuseum.inventory;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import android.webkit.*;
import android.widget.Toast;
import androidx.core.content.FileProvider;
import androidx.webkit.WebViewAssetLoader;
import java.io.*;
import java.util.Base64;

public class MainActivity extends Activity {
    private static final int PICK_FILE = 1001, SAVE_FILE = 1002;
    private static final String LOCAL = "https://appassets.androidplatform.net/assets/www/";
    private ValueCallback<Uri[]> uploadCallback;
    private WebView webView;
    private AppUpdater updater;
    private Uri cameraUri;
    private File cameraFile, exportFile;
    private volatile boolean exporting;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        setContentView(webView);
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            webView.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets bars = insets.getInsets(android.view.WindowInsets.Type.systemBars() | android.view.WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return insets;
            });
        }
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        webView.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                WebResourceResponse response = loader.shouldInterceptRequest(request.getUrl());
                return response != null ? response : new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", java.util.Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !request.getUrl().toString().startsWith(LOCAL);
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (uploadCallback != null) uploadCallback.onReceiveValue(null);
                uploadCallback = callback;
                boolean image = false;
                for (String type : params.getAcceptTypes()) if (type.startsWith("image/")) image = true;
                Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                picker.addCategory(Intent.CATEGORY_OPENABLE);
                picker.setType(image ? "image/*" : "*/*");
                Intent chooser = Intent.createChooser(picker, image ? "拍照或选择照片" : "选择扫描文件");
                cameraUri = null;
                cameraFile = null;
                if (image) {
                    try {
                        File folder = new File(getCacheDir(), "captures");
                        folder.mkdirs();
                        cameraFile = File.createTempFile("capture-", ".jpg", folder);
                        cameraUri = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".files", cameraFile);
                        Intent camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                        camera.putExtra(MediaStore.EXTRA_OUTPUT, cameraUri);
                        camera.setClipData(ClipData.newRawUri("photo", cameraUri));
                        camera.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{camera});
                    } catch (IOException e) { message("相机暂不可用，可选择已有照片"); }
                }
                try { startActivityForResult(chooser, PICK_FILE); }
                catch (Exception error) { uploadCallback.onReceiveValue(null); uploadCallback = null; message("无法打开文件选择器"); }
                return true;
            }
        });
        webView.addJavascriptInterface(new DownloadBridge(), "AndroidBridge");
        updater = new AppUpdater(this, webView);
        webView.loadUrl(LOCAL + "index.html");
    }

    private void message(String text) { runOnUiThread(() -> Toast.makeText(this, text, Toast.LENGTH_LONG).show()); }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == PICK_FILE && uploadCallback != null) {
            Uri selected = resultCode != RESULT_OK ? null : data != null && data.getData() != null ? data.getData() : cameraFile != null && cameraFile.length() > 0 ? cameraUri : null;
            uploadCallback.onReceiveValue(selected == null ? null : new Uri[]{selected});
            uploadCallback = null;
        }
        if (requestCode == SAVE_FILE) {
            final File pending = exportFile;
            if (resultCode != RESULT_OK || data == null || data.getData() == null) {
                if (pending != null) pending.delete(); exporting = false; message("已取消导出，清查记录仍保存在本机"); return;
            }
            final Uri destination = data.getData();
            new Thread(() -> {
                try (InputStream in = new FileInputStream(pending); OutputStream out = getContentResolver().openOutputStream(destination, "w")) {
                    if (out == null) throw new IOException("无法写入所选位置");
                    byte[] buffer = new byte[65536]; int count;
                    while ((count = in.read(buffer)) != -1) out.write(buffer, 0, count);
                    out.flush(); message("清查包已保存到所选位置");
                } catch (Exception error) { message("导出失败：" + error.getMessage()); }
                finally { if (pending != null) pending.delete(); exporting = false; }
            }).start();
        }
    }

    public class DownloadBridge {
        @JavascriptInterface public void checkUpdates(String address, boolean silent) {
            updater.check(address, silent);
        }

        @JavascriptInterface public synchronized void saveBase64(String fileName, String base64, String mimeType) {
            if (exporting) { message("请先完成当前导出"); return; }
            exporting = true;
            try {
                exportFile = File.createTempFile("inventory-", ".zip", getCacheDir());
                try (OutputStream out = new FileOutputStream(exportFile)) { out.write(Base64.getDecoder().decode(base64)); }
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("application/zip");
                intent.putExtra(Intent.EXTRA_TITLE, new File(fileName).getName());
                runOnUiThread(() -> { try { startActivityForResult(intent, SAVE_FILE); } catch (Exception error) { exporting = false; message("无法打开保存对话框"); } });
            } catch (Exception error) { exporting = false; message("导出失败：" + error.getMessage()); }
        }
    }

    @Override protected void onResume() { super.onResume(); if (updater != null) updater.resume(); }
    @Override protected void onDestroy() { if (updater != null) updater.close(); super.onDestroy(); }

    @Override public void onBackPressed() {
        webView.evaluateJavascript("document.querySelector('[data-screen=home]').classList.contains('active')", value -> {
            if ("true".equals(value)) finish(); else webView.evaluateJavascript("showScreen('home')", null);
        });
    }
}
