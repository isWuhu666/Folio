package app.folio.offline;

import java.util.Base64;
import java.util.Locale;

/** Pure state/limits: no URI or path supplied by JavaScript is ever accepted. */
final class ExportState {
    static final long MAX_SIZE = 130L * 1024 * 1024;
    static final int MAX_CHUNK = 128 * 1024;
    static final int MAX_BASE64 = 200 * 1024;
    private String id;
    private long size, written;
    private boolean opened;
    static boolean trusted(String scheme, String host, int port, boolean mainFrame) {
        return mainFrame && "https".equals(scheme) && "appassets.androidplatform.net".equals(host)
                && (port == -1 || port == 443);
    }
    void begin(String nextId, String name, String mime, long bytes) {
        if (active()) throw new IllegalStateException("已有保存任务，请等待或取消");
        if (nextId == null || !nextId.matches("[A-Za-z0-9_-]{1,80}")) throw new IllegalArgumentException("无效任务编号");
        if (name == null || name.length() > 160 || name.startsWith(".") || name.endsWith(".")
                || name.matches(".*[\\\\/:*?\"<>|\\p{Cntrl}].*") || name.trim().isEmpty())
            throw new IllegalArgumentException("无效文件名");
        String lower = name.toLowerCase(Locale.ROOT);
        String type = mime == null ? "" : mime.split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
        boolean markdown = lower.endsWith(".md") || lower.endsWith(".markdown");
        boolean allowed = ("text/html".equals(type) && lower.endsWith(".html"))
                || ("application/zip".equals(type) && (lower.endsWith(".zip") || lower.endsWith(".folio")))
                || ("application/json".equals(type) && (lower.endsWith(".json") || lower.endsWith(".folio")))
                || ("text/markdown".equals(type) && markdown)
                || ("text/plain".equals(type) && (lower.endsWith(".txt") || markdown))
                || ("application/pdf".equals(type) && lower.endsWith(".pdf"))
                || ("application/octet-stream".equals(type) && (markdown || lower.endsWith(".pdf") || lower.endsWith(".folio") || lower.endsWith(".zip")));
        if (!allowed) throw new IllegalArgumentException("不支持的导出文件类型");
        if (bytes < 0 || bytes > MAX_SIZE) throw new IllegalArgumentException("导出不得超过 130 MiB");
        id = nextId; size = bytes; written = 0; opened = false;
    }
    void require(String task) {
        if (id == null || !id.equals(task)) throw new IllegalStateException("保存任务不存在或编号不匹配");
    }
    void open(String task) { require(task); if (opened) throw new IllegalStateException("文件已打开"); opened = true; }
    byte[] chunk(String task, String encoded) {
        require(task);
        if (!opened) throw new IllegalStateException("尚未选择保存位置");
        if (encoded == null || encoded.isEmpty() || encoded.length() > MAX_BASE64
                || encoded.length() % 4 != 0 || !encoded.matches("[A-Za-z0-9+/]*={0,2}"))
            throw new IllegalArgumentException("无效或过大的数据块");
        byte[] data = Base64.getDecoder().decode(encoded);
        if (data.length > MAX_CHUNK || written + data.length > size) throw new IllegalArgumentException("数据超出声明大小或块限额");
        written += data.length;
        return data;
    }
    void finish(String task) {
        require(task);
        if (!opened || written != size) throw new IllegalStateException("文件未完整接收");
        reset();
    }
    boolean active() { return id != null; }
    String id() { return id; }
    void reset() { id = null; size = 0; written = 0; opened = false; }
}
