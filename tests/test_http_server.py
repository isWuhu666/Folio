import http.client
import json
import threading
import unittest

from folio.http_server import create_server


class ServerTests(unittest.TestCase):
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
