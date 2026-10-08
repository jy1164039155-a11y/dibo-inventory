package cn.hunanmuseum.inventory;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.ClipData;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import android.webkit.WebView;
import androidx.core.content.FileProvider;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.*;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONObject;

/** HTTPS download in the app; Android retains control of permission and installation. */
final class AppUpdater {
    private final Activity activity;
    private final WebView web;
    private final SharedPreferences preferences;
    private final AtomicBoolean checking=new AtomicBoolean(),downloading=new AtomicBoolean(),installing=new AtomicBoolean(),cancelled=new AtomicBoolean();
    private volatile HttpURLConnection downloadConnection;
    private volatile boolean closed;
    private AlertDialog dialog;
    AppUpdater(Activity activity,WebView web){this.activity=activity;this.web=web;preferences=activity.getSharedPreferences("app-update",0);}
    private void ui(Runnable action){activity.runOnUiThread(()->{if(!closed&&!activity.isFinishing()&&!activity.isDestroyed())action.run();});}
    private void message(String text){ui(()->Toast.makeText(activity,text,Toast.LENGTH_LONG).show());}
    private File readyFile(){return new File(activity.getCacheDir(),"updates/update.apk");}
    private static HttpURLConnection connect(String address) throws IOException {
        URL url=UpdateFiles.httpsUrl(address);
        for(int redirects=0;redirects<6;redirects++){
            HttpURLConnection connection=(HttpURLConnection)url.openConnection();
            connection.setConnectTimeout(10000);connection.setReadTimeout(15000);connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("User-Agent","DiboInventory-Android");connection.setRequestProperty("Accept-Encoding","identity");
            try{
                int status=connection.getResponseCode();
                if(status>=300&&status<400){
                    String next=connection.getHeaderField("Location");
                    if(next==null)throw new IOException("更新地址跳转失败");
                    url=UpdateFiles.httpsUrl(new URL(url,next).toString());connection.disconnect();
                }else if(status==200)return connection;
                else throw new IOException("更新服务暂不可用，请稍后重试");
            }catch(IOException error){connection.disconnect();throw error;}
        }
        throw new IOException("更新地址跳转过多");
    }
    void check(String address, boolean silent){
        if(downloading.get()){if(!silent)message("正在下载更新");return;}
        if(!checking.compareAndSet(false,true))return;
        new Thread(()->{
            try{
                HttpURLConnection connection=connect(address);String body;
                try(InputStream input=connection.getInputStream();ByteArrayOutputStream output=new ByteArrayOutputStream()){
                    byte[] buffer=new byte[4096];int count;
                    while((count=input.read(buffer))!=-1){output.write(buffer,0,count);if(output.size()>65536)throw new IOException("版本信息无效");}
                    body=output.toString("UTF-8");
                }finally{connection.disconnect();}
                JSONObject manifest=new JSONObject(body);
                if(!activity.getPackageName().equals(manifest.getString("applicationId")))throw new IOException("更新版本不匹配");
                int code=manifest.getInt("versionCode");
                if(code<=installedCode()){if(!silent)message("已是最新版本");return;}
                String addressApk=manifest.getString("apkUrl"),hash=manifest.getString("sha256"),name=manifest.getString("versionName");
                UpdateFiles.httpsUrl(addressApk);if(!hash.matches("[a-fA-F0-9]{64}"))throw new IOException("版本校验信息无效");
                ui(()->{if(dialog!=null&&dialog.isShowing())return;dialog=new AlertDialog.Builder(activity)
                    .setTitle("更新至 "+name).setMessage("请先导出备份，再下载并安装更新。")
                    .setNegativeButton("稍后",null).setPositiveButton("立即更新",(d,w)->{
                        // Do not start installation while a registration is still unsaved.
                        web.evaluateJavascript("Boolean(state.dirty || state.saving || state.processing)",value->{
                            if("true".equals(value))message("请先保存当前登记，再更新应用");else download(addressApk,hash,code);
                        });
                    }).create();dialog.show();});
            }catch(Exception error){if(!silent)message("检查更新失败，请检查网络后重试");}
            finally{checking.set(false);}
        },"inventory-update-check").start();
    }
    private void download(String address,String hash,int code){
        if(!downloading.compareAndSet(false,true))return;
        if(readyFile().isFile()&&hash.equalsIgnoreCase(preferences.getString("hash",""))&&code==preferences.getInt("code",0)){
            downloading.set(false);installReady();return;
        }
        cancelled.set(false);
        LinearLayout content=new LinearLayout(activity);content.setOrientation(LinearLayout.VERTICAL);
        int padding=(int)(24*activity.getResources().getDisplayMetrics().density);content.setPadding(padding,padding,padding,padding);
        TextView text=new TextView(activity);text.setText("正在连接…");content.addView(text);
        ProgressBar progress=new ProgressBar(activity,null,android.R.attr.progressBarStyleHorizontal);progress.setMax(100);progress.setIndeterminate(true);content.addView(progress);
        dialog=new AlertDialog.Builder(activity).setTitle("下载更新").setView(content).setCancelable(false)
            .setNegativeButton("取消",(d,w)->{cancelled.set(true);HttpURLConnection connection=downloadConnection;if(connection!=null)connection.disconnect();}).create();
        final AlertDialog progressDialog=dialog;progressDialog.show();
        new Thread(()->{
            File part=new File(activity.getCacheDir(),"updates/update.part");
            try{
                if(!part.getParentFile().isDirectory()&&!part.getParentFile().mkdirs())throw new IOException("无法保存更新文件");
                downloadConnection=connect(address);long size=downloadConnection.getContentLengthLong();final long[] last={0};
                try(InputStream input=downloadConnection.getInputStream()){
                    UpdateFiles.copyVerified(input,part,size,hash,cancelled::get,bytes->{
                        long time=android.os.SystemClock.elapsedRealtime();if(time-last[0]<250)return;last[0]=time;
                        ui(()->{progress.setIndeterminate(size<=0);if(size>0)progress.setProgress((int)(bytes*100/size));text.setText(size>0?"已下载 "+(bytes*100/size)+"%":"已下载 "+(bytes/1024)+" KB");});
                    });
                }
                if(cancelled.get())throw new InterruptedIOException("已取消更新");
                if(readyFile().exists()&&!readyFile().delete())throw new IOException("无法替换更新文件");
                if(!part.renameTo(readyFile()))throw new IOException("无法保存更新文件");
                validatePackage(code,hash);
                preferences.edit().putInt("code",code).putString("hash",hash).apply();
                ui(()->{progressDialog.dismiss();if(!cancelled.get())installReady();});
            }catch(Exception error){
                part.delete();ui(progressDialog::dismiss);if(!cancelled.get())message(error instanceof IOException?error.getMessage():"更新下载失败，请重试");
            }finally{HttpURLConnection connection=downloadConnection;if(connection!=null)connection.disconnect();downloadConnection=null;downloading.set(false);}
        },"inventory-update-download").start();
    }
    @SuppressWarnings("deprecation")
    private int installedCode() throws PackageManager.NameNotFoundException {return activity.getPackageManager().getPackageInfo(activity.getPackageName(),0).versionCode;}
    @SuppressWarnings("deprecation")
    private void validatePackage(int expectedCode,String hash) throws Exception {
        File file=readyFile();
        if(!file.isFile()||file.length()>UpdateFiles.MAX_BYTES||!UpdateFiles.hash(file).equalsIgnoreCase(hash))throw new IOException("更新校验失败，请重新下载");
        PackageManager manager=activity.getPackageManager();int flags=Build.VERSION.SDK_INT>=28?PackageManager.GET_SIGNING_CERTIFICATES:PackageManager.GET_SIGNATURES;
        PackageInfo incoming=manager.getPackageArchiveInfo(file.getAbsolutePath(),flags),current=manager.getPackageInfo(activity.getPackageName(),flags);
        if(incoming==null||!activity.getPackageName().equals(incoming.packageName)||incoming.versionCode!=expectedCode||incoming.versionCode<=current.versionCode)throw new IOException("安装包版本不匹配");
        Signature[] fresh=Build.VERSION.SDK_INT>=28&&incoming.signingInfo!=null?incoming.signingInfo.getApkContentsSigners():incoming.signatures;
        Signature[] installed=Build.VERSION.SDK_INT>=28&&current.signingInfo!=null?current.signingInfo.getApkContentsSigners():current.signatures;
        if(fresh==null||installed==null||fresh.length==0||!new HashSet<>(Arrays.asList(fresh)).equals(new HashSet<>(Arrays.asList(installed))))throw new IOException("安装包签名不匹配");
    }
    private void installReady(){
        if(closed||!installing.compareAndSet(false,true))return;
        new Thread(()->{
            try{
                validatePackage(preferences.getInt("code",0),preferences.getString("hash",""));
                ui(()->{
                    installing.set(false);
                    if(!activity.getPackageManager().canRequestPackageInstalls()){
                        dialog=new AlertDialog.Builder(activity).setTitle("允许安装更新").setMessage("开启安装权限后，返回应用继续安装。")
                            .setNegativeButton("稍后",null).setPositiveButton("去设置",(d,w)->{
                                try{preferences.edit().putBoolean("awaiting-permission",true).apply();activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+activity.getPackageName())));}
                                catch(Exception error){preferences.edit().putBoolean("awaiting-permission",false).apply();message("无法打开安装设置");}
                            }).create();dialog.show();return;
                    }
                    try{
                        Uri uri=FileProvider.getUriForFile(activity,activity.getPackageName()+".files",readyFile());
                        Intent intent=new Intent(Intent.ACTION_VIEW).setDataAndType(uri,"application/vnd.android.package-archive");
                        intent.setClipData(ClipData.newRawUri("update",uri));
                        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);activity.startActivity(intent);
                    }catch(Exception error){message("无法打开安装界面，请稍后重试");}
                });
            }catch(Exception error){installing.set(false);readyFile().delete();preferences.edit().clear().apply();message("更新文件无效，请重新下载");}
        },"inventory-update-install").start();
    }
    void resume(){
        if(preferences.getBoolean("awaiting-permission",false)){
            preferences.edit().putBoolean("awaiting-permission",false).apply();
            if(activity.getPackageManager().canRequestPackageInstalls())installReady();else message("未允许安装更新，可稍后重试");
        }
    }
    void close(){closed=true;cancelled.set(true);if(downloadConnection!=null)downloadConnection.disconnect();if(dialog!=null)dialog.dismiss();}
}
