import http.client
import json
import threading
import unittest
from folio.http_server import create_server
from pdf_fixtures import make_pdf


class PdfApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server=create_server(0)
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown();cls.server.server_close();cls.thread.join()

    def post(self,data=b'',query='',headers=None):
        c=http.client.HTTPConnection('127.0.0.1',self.server.server_port,timeout=10)
        c.request('POST','/api/pdf'+query,body=data,headers={'Content-Type':'application/pdf','X-Folio-Request':'1',**(headers or {})})
        r=c.getresponse();result=(r.status,json.loads(r.read()));c.close();return result

    def test_actual_conversion_and_validation(self):
        status,r=self.post(make_pdf(),'?mode=faithful&dpi=96');self.assertEqual(status,200);self.assertEqual(r['pageCount'],1)
        self.assertEqual(self.post(b'notpdf')[0],400)
        self.assertEqual(self.post(make_pdf(),'?mode=evil')[0],400)
        self.assertEqual(self.post(make_pdf(),'?dpi=72')[0],400)
        self.assertEqual(self.post(b'',headers={'Content-Length':str(40*1024*1024+1)})[0],413)

    def test_busy_and_timeout_release_lock(self):
        self.server.pdf_lock.acquire()
        try:self.assertEqual(self.post(make_pdf())[0],503)
        finally:self.server.pdf_lock.release()
        previous=self.server.pdf_timeout;self.server.pdf_timeout=0.001
        try:self.assertEqual(self.post(make_pdf())[0],504)
        finally:self.server.pdf_timeout=previous
        self.assertEqual(self.post(make_pdf())[0],200)

    def test_busy_response_survives_an_uploaded_body(self):
        self.server.pdf_lock.acquire()
        try:self.assertEqual(self.post(b'%PDF-'+b'\0'*262144)[0],503)
        finally:self.server.pdf_lock.release()


if __name__=='__main__':unittest.main()
