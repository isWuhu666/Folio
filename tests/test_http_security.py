import http.client
import socket
import threading
import time
import unittest
from folio.http_server import create_server


class HttpSecurityTests(unittest.TestCase):
    def setUp(self):
        self.server = create_server(0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.server.server_port

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def request(self, method='GET', path='/', headers=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=5)
        try:
            connection.request(method, path, body=b'' if method=='POST' else None, headers=headers or {})
            response = connection.getresponse()
            response.read()
            return response.status, dict(response.getheaders())
        finally:
            connection.close()

    def test_browser_security_headers_and_no_permissive_cors(self):
        status, headers = self.request()
        self.assertEqual(status, 200)
        self.assertIn("script-src 'self'", headers.get('Content-Security-Policy', ''))
        self.assertEqual(headers.get('X-Frame-Options'), 'SAMEORIGIN')
        self.assertEqual(headers.get('Cross-Origin-Resource-Policy'), 'same-origin')
        self.assertNotIn('Access-Control-Allow-Origin', headers)

    def test_pdf_capacity_is_same_origin_and_never_cacheable(self):
        status,headers=self.request(path='/api/pdf/capacity',headers={'If-None-Match':'*'})
        self.assertEqual(status,200)
        self.assertEqual(headers['Cache-Control'],'no-store')
        self.assertNotIn('ETag',headers)
        self.assertEqual(headers['Cross-Origin-Resource-Policy'],'same-origin')
        self.assertEqual(headers['X-Content-Type-Options'],'nosniff')
        for untrusted in ({'Host':'evil.test'},{'Origin':'https://evil.test'},{'Sec-Fetch-Site':'cross-site'}):
            self.assertEqual(self.request(path='/api/pdf/capacity',headers=untrusted)[0],403)

    def test_pdf_rejects_form_posts_and_missing_custom_header(self):
        self.assertEqual(self.request('POST','/api/pdf',{'Content-Type':'text/plain'})[0],403)
        self.assertEqual(self.request('POST','/api/pdf',{'Content-Type':'application/pdf'})[0],403)
        self.assertEqual(self.request('POST','/api/pdf',{'Content-Type':'text/plain','X-Folio-Request':'1'})[0],415)
        self.assertEqual(self.request('OPTIONS','/api/pdf',{'Origin':'https://evil.example'})[0],403)

    def test_static_revalidation_retains_security_and_api_never_caches(self):
        status,headers=self.request(path='/app.js')
        self.assertEqual(status,200)
        self.assertEqual(headers.get('Cache-Control'),'private, no-cache')
        etag=headers['ETag']
        status,cached=self.request(path='/app.js',headers={'If-None-Match':etag})
        self.assertEqual(status,304)
        self.assertEqual(cached['ETag'],etag)
        self.assertEqual(cached['X-Content-Type-Options'],'nosniff')
        self.assertEqual(self.request(path='/app.js',headers={'Origin':'https://evil.example','If-None-Match':etag})[0],403)
        status,health=self.request(path='/api/health',headers={'If-None-Match':'*'})
        self.assertEqual(status,200)
        self.assertEqual(health['Cache-Control'],'no-store')
        self.assertNotIn('ETag',health)

    def test_static_etag_changes_when_same_size_content_changes(self):
        import tempfile
        from pathlib import Path
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as folder, patch('folio.http_server.WEB',Path(folder)):
            asset=Path(folder)/'test.js';asset.write_bytes(b'first')
            status,headers=self.request(path='/test.js');self.assertEqual(status,200)
            asset.write_bytes(b'other')
            status,changed=self.request(path='/test.js',headers={'If-None-Match':headers['ETag']})
            self.assertEqual(status,200)
            self.assertNotEqual(changed['ETag'],headers['ETag'])

    def test_ambiguous_request_framing_is_rejected(self):
        with socket.create_connection(('127.0.0.1',self.port),timeout=5) as client:
            client.sendall((f'POST /api/pdf HTTP/1.1\r\nHost: 127.0.0.1:{self.port}\r\n'
                            'X-Folio-Request: 1\r\nContent-Type: application/pdf\r\n'
                            'Content-Length: 0\r\nContent-Length: 1\r\n\r\nx').encode())
            self.assertIn(b' 400 ',client.recv(4096).split(b'\r\n')[0])

    def test_incomplete_upload_times_out_and_service_recovers(self):
        self.server.upload_timeout = 0.15
        with socket.create_connection(('127.0.0.1',self.port),timeout=5) as client:
            client.sendall((f'POST /api/pdf HTTP/1.1\r\nHost: 127.0.0.1:{self.port}\r\n'
                            'X-Folio-Request: 1\r\nContent-Type: application/pdf\r\n'
                            'Content-Length: 100\r\n\r\n%PDF-').encode())
            self.assertIn(b' 408 ',client.recv(4096).split(b'\r\n')[0])
        self.assertEqual(self.request(path='/api/health')[0],200)
        self.assertTrue(self.server.pdf_lock.acquire(blocking=False))
        self.server.pdf_lock.release()

    def test_idle_connections_are_bounded_and_slots_recover(self):
        clients=[]
        try:
            for _ in range(18):
                clients.append(socket.create_connection(('127.0.0.1',self.port),timeout=5))
            time.sleep(0.15)
            self.assertLessEqual(self.server.active_requests,16)
        finally:
            for client in clients:client.close()
        deadline=time.monotonic()+3
        while self.server.active_requests and time.monotonic()<deadline:time.sleep(0.02)
        self.assertEqual(self.request(path='/api/health')[0],200)

    def test_trickled_headers_cannot_extend_the_total_header_deadline(self):
        self.server.header_timeout = 0.2
        clients=[]
        try:
            for _ in range(16):
                client=socket.create_connection(('127.0.0.1',self.port),timeout=5)
                client.sendall(f'GET / HTTP/1.1\r\nHost: 127.0.0.1:{self.port}\r\nX-Slow: '.encode())
                clients.append(client)
            for _ in range(6):
                time.sleep(0.06)
                for client in clients:
                    try:client.sendall(b'x')
                    except OSError:pass
            self.assertEqual(self.server.active_requests,0)
            self.assertEqual(self.request(path='/api/health')[0],200)
        finally:
            for client in clients:client.close()
