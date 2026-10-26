import http.client
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import socket
import threading
import unittest

from folio.http_server import create_server


class ServerTests(unittest.TestCase):
    def test_pdf_worker_capacity_can_be_lowered_but_not_raised_unbounded(self):
        server=create_server(0,pdf_workers=1)
        try:
            self.assertTrue(server.pdf_lock.acquire_job())
            self.assertFalse(server.pdf_lock.acquire_job())
            server.pdf_lock.release_job()
        finally:server.server_close()
        for invalid in (0,3,True,'2'):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                create_server(0,pdf_workers=invalid)

    def test_browser_connection_burst_can_queue_before_accepting(self):
        server=create_server(0)
        clients=[]
        try:
            # A browser can start several asset connections while accept is briefly busy.
            for _ in range(12):
                client=socket.socket();clients.append(client);client.settimeout(.5)
                client.connect(server.server_address)
        finally:
            for client in clients:client.close()
            server.server_close()

    @classmethod
    def setUpClass(cls):
        cls.server = create_server(0)
        cls.port = cls.server.server_port
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def request(self, path, headers=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=5)
        connection.request('GET', path, headers=headers or {})
        response = connection.getresponse()
        body = response.read()
        connection.close()
        return response.status, body

    def test_health_is_local_only(self):
        self.assertEqual(self.server.server_address[0], '127.0.0.1')
        status, body = self.request('/api/health')
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)['status'], 'ok')

    def test_cli_starts_with_a_western_console_encoding(self):
        env = {**os.environ, 'PYTHONIOENCODING': 'cp1252:strict'}
        process = subprocess.Popen(
            [sys.executable, 'server.py', '--port', '0', '--no-browser'],
            cwd=Path(__file__).resolve().parent.parent, env=env,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        try:
            line = process.stdout.readline()
            match = re.search(rb'http://127\.0\.0\.1:(\d+)', line)
            self.assertIsNotNone(match, 'CLI terminated before announcing a usable local URL')
            connection = http.client.HTTPConnection('127.0.0.1', int(match[1]), timeout=5)
            try:
                connection.request('GET', '/api/health')
                response = connection.getresponse()
                self.assertEqual(response.status, 200)
                self.assertEqual(json.loads(response.read())['status'], 'ok')
            finally:
                connection.close()
        finally:
            if process.poll() is None:
                process.terminate()
            process.communicate(timeout=10)

    def test_rejects_foreign_host_or_origin(self):
        self.assertEqual(self.request('/', {'Host': 'evil.example'})[0], 403)
        self.assertEqual(self.request('/', {'Origin': 'https://evil.example'})[0], 403)
        self.assertEqual(self.request('/', {'Sec-Fetch-Site': 'cross-site'})[0], 403)

    def test_static_paths_cannot_escape_public_root(self):
        for path in ['/%2e%2e/server.py', '/.git/config', '/server.py', '/vendor/../../server.py']:
            with self.subTest(path=path):
                status, body = self.request(path)
                self.assertIn(status, (403, 404))
                self.assertNotIn(b'create_server', body)

    def test_index_is_utf8(self):
        status, body = self.request('/')
        self.assertEqual(status, 200)
        self.assertIn('墨页', body.decode('utf-8'))

    def test_second_server_cannot_claim_same_port(self):
        second=None
        try:
            with self.assertRaises(OSError):
                second=create_server(self.port)
        finally:
            if second:second.server_close()

    def test_shutdown_waits_for_pdf_and_rejects_foreign_origin(self):
        self.server.control_token = 'local-control-test'
        self.server.pdf_lock.acquire()
        try:
            for origin, expected in [(None, 409), ('https://evil.example', 403)]:
                headers = {'X-Folio-Control': 'local-control-test'}
                if origin:
                    headers['Origin'] = origin
                connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=5)
                try:
                    connection.request('POST', '/api/shutdown', body=b'', headers=headers)
                    response = connection.getresponse()
                    response.read()
                    self.assertEqual(response.status, expected)
                finally:
                    connection.close()
            self.assertEqual(self.request('/api/health')[0], 200)
        finally:
            self.server.pdf_lock.release()
            self.server.control_token = None


if __name__ == '__main__':
    unittest.main()
