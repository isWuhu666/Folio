package app.folio.offline;

public final class ExportStateTest {
    private static int checks;
    private static void check(boolean value) { checks++; if (!value) throw new AssertionError(); }
    private static void rejects(Runnable action) {
        checks++; try { action.run(); } catch (IllegalArgumentException | IllegalStateException expected) { return; }
        throw new AssertionError("Expected rejection");
    }
    public static void main(String[] args) {
        ExportState s = new ExportState();
        rejects(() -> s.begin("a", "../x.html", "text/html", 1));
        rejects(() -> s.begin("a", "x.apk", "application/vnd.android.package-archive", 1));
        rejects(() -> s.begin("a", "x.html", "application/zip", 1));
        rejects(() -> s.begin("a", "x.html", "text/html", ExportState.MAX_SIZE + 1));
        s.begin("a", "文档.html", "text/html", 3);
        rejects(() -> s.begin("b", "b.html", "text/html", 1));
        rejects(() -> s.chunk("a", "YWJj")); // picker not yet accepted
        s.open("a");
        rejects(() -> s.chunk("b", "YWJj"));
        rejects(() -> s.chunk("a", "@@@="));
        rejects(() -> s.chunk("a", "YQ==\n"));
        check(s.chunk("a", "YWI=").length == 2);
        rejects(() -> s.finish("a")); // incomplete
        rejects(() -> s.chunk("a", "YWI=")); // exceeds declared size
        check(s.chunk("a", "Yw==")[0] == 99);
        s.finish("a");
        check(!s.active());
        s.begin("d", "项目.folio", "application/zip", 0); s.open("d"); s.finish("d");
        s.begin("project", "项目.folio", "application/octet-stream", 0); s.open("project"); s.finish("project"); check(!s.active());
        rejects(() -> s.begin("wrong", "x.html", "application/octet-stream", 0));
        s.begin("e", "export.html", "text/html;charset=utf-8", 0); s.open("e"); s.finish("e");
        s.begin("f", "source.markdown", "application/octet-stream", 0); s.open("f"); s.finish("f");
        rejects(() -> s.begin("g", "source.exe", "application/octet-stream", 0));
        s.begin("b", "b.zip", "application/zip", ExportState.MAX_SIZE);
        s.open("b");
        rejects(() -> s.chunk("b", "A".repeat(200 * 1024 + 4)));
        rejects(() -> s.chunk("b", java.util.Base64.getEncoder().encodeToString(new byte[128 * 1024 + 1])));
        s.reset(); check(!s.active());
        s.begin("c", "c.folio.json", "application/json", 0); s.open("c"); s.finish("c");
        check(!s.active());
        check(ExportState.trusted("https", "appassets.androidplatform.net", -1, true));
        check(!ExportState.trusted("https", "appassets.androidplatform.net", -1, false));
        check(!ExportState.trusted("http", "appassets.androidplatform.net", -1, true));
        check(!ExportState.trusted("https", "evil.test", -1, true));
        check(!ExportState.trusted("https", "appassets.androidplatform.net", 444, true));
        System.out.println("Export state: " + checks + " checks passed");
    }
}
