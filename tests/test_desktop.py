import http.client
import json
from pathlib import Path
import socket
import subprocess
import sys
import time
import unittest

from pdf_fixtures import make_pdf


ROOT = Path(__file__).resolve().parent.parent


class DesktopTests(unittest.TestCase):
    def setUp(self):
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            self.port = sock.getsockname()[1]
        self.processes = []

    def tearDown(self):
        for process in self.processes:
            if process.poll() is None:
                process.terminate()
            process.wait(timeout=10)

    def launch(self, *args):
        process = subprocess.Popen(
            [sys.executable, str(ROOT / 'desktop.py'), '--port', str(self.port),
             '--no-browser', *args], cwd=ROOT, stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0)
        self.processes.append(process)
        return process

    def request(self, path, method='GET', data=None, headers=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=15)
        try:
            defaults = {'Content-Type':'application/pdf','X-Folio-Request':'1'} if path.startswith('/api/pdf') else {}
            connection.request(method, path, body=data, headers={**defaults, **(headers or {})})
            response = connection.getresponse()
            return response.status, response.read()
        finally:
            connection.close()

    def wait_ready(self, process):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline and process.poll() is None:
            try:
                if self.request('/api/health')[0] == 200:
                    return
            except OSError:
                pass
            time.sleep(0.05)
        self.fail(f'Hidden service did not become ready; exit={process.poll()}')

    def test_background_lifecycle_reuses_service_and_converts_pdf(self):
        service = self.launch()
        self.wait_ready(service)
        self.assertIn('墨页'.encode(), self.request('/')[1])
        duplicate = self.launch()
        self.assertEqual(duplicate.wait(timeout=10), 0)
        self.assertIsNone(service.poll(), 'Opening a second time must preserve the service')
        status, body = self.request('/api/pdf?dpi=96', 'POST', make_pdf())
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)['pageCount'], 1)
        self.assertEqual(self.request('/api/shutdown', 'POST')[0], 403)
        self.assertEqual(self.request('/api/shutdown', 'POST', headers={
            'X-Folio-Control': 'incorrect'})[0], 403)
        self.assertEqual(self.request('/api/health')[0], 200)
        stop = self.launch('--stop')
        self.assertEqual(stop.wait(timeout=10), 0)
        self.assertEqual(service.wait(timeout=10), 0)
        self.assertFalse((ROOT / 'artifacts' / f'desktop-{self.port}.json').exists())
        again = self.launch('--stop')
        self.assertEqual(again.wait(timeout=10), 0, 'Stopping an already stopped service is harmless')

    def test_foreign_port_is_not_reused_or_terminated(self):
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
        import threading

        class ForeignHandler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_GET(self):
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{"status":"ok","name":"another application"}')

        server = ThreadingHTTPServer(('127.0.0.1', self.port), ForeignHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            self.assertEqual(self.launch().wait(timeout=10), 1)
            self.assertEqual(self.launch('--stop').wait(timeout=10), 1)
            self.assertEqual(self.request('/api/health')[0], 200)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    @unittest.skipUnless(sys.platform == 'win32', 'Windows desktop entry points')
    def test_windows_entry_exits_while_hidden_service_remains_available(self):
        entries = [
            ['wscript.exe', '//B', str(ROOT / '打开墨页.vbs')],
            ['cmd.exe', '/c', str(ROOT / '启动.cmd')],
        ]
        for entry in entries:
            with self.subTest(entry=entry[0]):
                try:
                    opener = subprocess.run(
                        [*entry, '--port', str(self.port), '--no-browser'], cwd=ROOT,
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                        creationflags=subprocess.CREATE_NO_WINDOW, timeout=10)
                    self.assertEqual(opener.returncode, 0)
                    deadline = time.monotonic() + 10
                    ready = False
                    while time.monotonic() < deadline:
                        try:
                            ready = self.request('/api/health')[0] == 200
                        except OSError:
                            pass
                        if ready:
                            break
                        time.sleep(0.1)
                    self.assertTrue(ready, 'Service must survive the launcher exiting')
                    status, body = self.request('/api/pdf?dpi=96', 'POST', make_pdf())
                    self.assertEqual(status, 200, body[:300])
                    self.assertEqual(json.loads(body)['pageCount'], 1)
                finally:
                    self.assertEqual(self.launch('--stop').wait(timeout=15), 0)
