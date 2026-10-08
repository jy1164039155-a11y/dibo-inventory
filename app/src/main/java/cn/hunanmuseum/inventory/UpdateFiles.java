package cn.hunanmuseum.inventory;

import java.io.*;
import java.net.URL;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.function.BooleanSupplier;
import java.util.function.LongConsumer;

/** Bounded, cancellable APK transfer. A partial or unverified file is never retained. */
final class UpdateFiles {
    static final long MAX_BYTES=64L*1024*1024;
    static URL httpsUrl(String address) throws IOException {
        URL url=new URL(address);
        if(!"https".equalsIgnoreCase(url.getProtocol())||url.getHost().isEmpty()||url.getUserInfo()!=null)
            throw new IOException("更新地址无效");
        return url;
    }
    static void copyVerified(InputStream input, File file, long expectedSize, String expectedHash,
                             BooleanSupplier cancelled, LongConsumer progress) throws IOException {
        try {
            if(expectedHash==null||!expectedHash.matches("[a-fA-F0-9]{64}"))throw new IOException("缺少更新校验信息");
            if(expectedSize>MAX_BYTES)throw new IOException("更新文件过大");
            MessageDigest digest=MessageDigest.getInstance("SHA-256");
            long total=0;byte[] buffer=new byte[32768];int count;
            try(OutputStream output=new FileOutputStream(file)){
                while((count=input.read(buffer))!=-1){
                    if(cancelled.getAsBoolean())throw new InterruptedIOException("已取消更新");
                    total+=count;if(total>MAX_BYTES)throw new IOException("更新文件过大");
                    output.write(buffer,0,count);digest.update(buffer,0,count);progress.accept(total);
                }
            }
            if(cancelled.getAsBoolean())throw new InterruptedIOException("已取消更新");
            if(total==0||(expectedSize>=0&&total!=expectedSize))throw new IOException("下载不完整，请重试");
            StringBuilder hash=new StringBuilder();for(byte b:digest.digest())hash.append(String.format("%02x",b&255));
            if(!hash.toString().equalsIgnoreCase(expectedHash))throw new IOException("更新校验失败，请重试");
        } catch(IOException|NoSuchAlgorithmException error){
            file.delete();if(error instanceof IOException)throw (IOException)error;throw new IOException(error);
        }
    }
    static String hash(File file) throws IOException {
        try(InputStream input=new FileInputStream(file)){
            MessageDigest digest=MessageDigest.getInstance("SHA-256");byte[] buffer=new byte[32768];int count;
            while((count=input.read(buffer))!=-1)digest.update(buffer,0,count);
            StringBuilder value=new StringBuilder();for(byte b:digest.digest())value.append(String.format("%02x",b&255));return value.toString();
        } catch(NoSuchAlgorithmException error){throw new IOException(error);}
    }
}
