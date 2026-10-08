package cn.hunanmuseum.inventory;

import java.io.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.concurrent.atomic.AtomicBoolean;

public final class UpdateFilesTest {
    private static int checks;
    private static String sha(byte[] bytes) throws Exception {
        StringBuilder result=new StringBuilder();
        for(byte b:MessageDigest.getInstance("SHA-256").digest(bytes))result.append(String.format("%02x",b&255));
        return result.toString();
    }
    private static void rejects(File file, byte[] bytes, long size, String digest, boolean cancel) throws Exception {
        try {
            UpdateFiles.copyVerified(new ByteArrayInputStream(bytes),file,size,digest,()->cancel,n->{});
            throw new AssertionError("Invalid update accepted");
        } catch(IOException expected) { if(file.exists())throw new AssertionError("Partial APK retained"); }
        checks++;
    }
    public static void main(String[] args) throws Exception {
        Path directory=Files.createTempDirectory("dibo-update-test");File file=directory.resolve("update.apk").toFile();
        byte[] bytes="synthetic-update-package".getBytes("UTF-8");
        try {
            final long[] progress={0};
            UpdateFiles.copyVerified(new ByteArrayInputStream(bytes),file,bytes.length,sha(bytes),()->false,n->progress[0]=n);
            if(!java.util.Arrays.equals(bytes,Files.readAllBytes(file.toPath()))||progress[0]!=bytes.length)throw new AssertionError("Download corrupted");checks++;file.delete();
            UpdateFiles.copyVerified(new ByteArrayInputStream(bytes),file,-1,sha(bytes),()->false,n->{});checks++;file.delete();
            try {
                UpdateFiles.copyVerified(new InputStream(){
                    private long remaining=UpdateFiles.MAX_BYTES+1;
                    public int read(){throw new AssertionError("Use buffered reads");}
                    public int read(byte[] buffer,int offset,int length){if(remaining==0)return -1;int count=(int)Math.min(length,remaining);remaining-=count;return count;}
                },file,-1,sha(bytes),()->false,n->{});
                throw new AssertionError("Unknown-length oversized APK accepted");
            }catch(IOException expected){if(file.exists())throw new AssertionError("Oversized APK retained");checks++;}
            try {
                UpdateFiles.copyVerified(new InputStream(){
                    private boolean first=true;
                    public int read(){throw new AssertionError("Use buffered reads");}
                    public int read(byte[] buffer,int offset,int length)throws IOException{if(!first)throw new IOException("connection lost");first=false;buffer[offset]=1;return 1;}
                },file,-1,sha(bytes),()->false,n->{});
                throw new AssertionError("Broken connection accepted");
            }catch(IOException expected){if(file.exists())throw new AssertionError("Interrupted APK retained");checks++;}
            rejects(file,bytes,bytes.length,"0".repeat(64),false);
            rejects(file,bytes,bytes.length+1,sha(bytes),false);
            rejects(file,bytes,UpdateFiles.MAX_BYTES+1,sha(bytes),false);
            rejects(file,bytes,bytes.length,"not-a-hash",false);
            rejects(file,bytes,bytes.length,sha(bytes),true);
            AtomicBoolean cancelled=new AtomicBoolean();
            try {UpdateFiles.copyVerified(new ByteArrayInputStream(bytes),file,-1,sha(bytes),cancelled::get,n->cancelled.set(true));throw new AssertionError("Late cancel ignored");}
            catch(InterruptedIOException expected){if(file.exists())throw new AssertionError("Cancelled APK retained");checks++;}
            for(String address:new String[]{"http://example.com/a.apk","https://user:password@example.com/a.apk","https://"}){
                try {UpdateFiles.httpsUrl(address);throw new AssertionError("Unsafe URL accepted");}catch(IOException expected){checks++;}
            }
            UpdateFiles.httpsUrl("https://github.com/example/releases/update.apk");checks++;
            System.out.println("PASS: "+checks+" update transfer checks");
        } finally {file.delete();Files.delete(directory);}
    }
}
