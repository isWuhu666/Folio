import http.client
import json
import threading
import time
import unittest
from unittest.mock import patch
from folio.http_server import create_server
from pdf_fixtures import make_pdf

class PdfJobsTests(unittest.TestCase):
    def setUp(self):
        self.server=create_server(0)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join()
    def request(self,method,path,data=None,headers=None):
        c=http.client.HTTPConnection('127.0.0.1',self.server.server_port,timeout=10)
        c.request(method,path,body=data,headers=headers or {})
        r=c.getresponse();status=r.status;payload=json.loads(r.read());c.close();return status,payload
    def submit(self,query=''):
        return self.request('POST','/api/pdf/jobs'+query,make_pdf(pages=3),{'Content-Type':'application/pdf','X-Folio-Request':'1'})
    def test_job_progress_token_and_result(self):
        status,job=self.submit('?dpi=96&pages=2-3');self.assertEqual(status,202)
        path='/api/pdf/jobs/'+job['id'];headers={'X-Folio-Job':job['token']}
        self.assertEqual(self.request('GET',path)[0],403)
        deadline=time.monotonic()+10
        while time.monotonic()<deadline:
            status,result=self.request('GET',path,headers=headers)
            if result['state'] in ('completed','failed'):break
            time.sleep(.02)
        self.assertEqual(result['state'],'completed',result)
        self.assertEqual((result['completed'],result['total']),(2,2))
        self.assertEqual([p['number'] for p in result['result']['pages']],[2,3])
    def test_busy_and_same_origin_validation(self):
        self.server.pdf_lock.acquire()
        try:self.assertEqual(self.submit()[0],503)
        finally:self.server.pdf_lock.release()
        self.assertEqual(self.request('POST','/api/pdf/jobs',b'',{'Origin':'https://evil.test'})[0],403)
        self.assertEqual(self.request('POST','/api/pdf/jobs',b'',{'Content-Type':'application/pdf'})[0],403)

    def wait_for(self, predicate):
        deadline=time.monotonic()+10
        while time.monotonic()<deadline:
            value=predicate()
            if value:return value
            time.sleep(.02)
        self.fail('job did not reach expected state')

    def test_cancel_kills_real_worker_and_releases_conversion_lock(self):
        import sys
        with patch('folio.pdf_jobs.worker_command',return_value=[sys.executable,'-c','import time; time.sleep(60)']):
            status,job=self.submit();self.assertEqual(status,202)
            record=self.server.pdf_jobs.jobs[job['id']]
            process=self.wait_for(lambda:record['process'])
            path='/api/pdf/jobs/'+job['id']+'/cancel'
            self.assertEqual(self.request('POST',path,headers={'X-Folio-Job':'wrong'})[0],403)
            self.assertIsNone(process.poll())
            status,result=self.request('POST',path,headers={'X-Folio-Job':job['token']})
            self.assertEqual((status,result['state']),(200,'cancelled'))
            self.wait_for(lambda:process.poll() is not None)
            self.wait_for(lambda:record.get('finished'))
        self.assertTrue(self.server.pdf_lock.acquire(blocking=False));self.server.pdf_lock.release()
        self.assertEqual(self.submit('?dpi=96')[0],202)

    def test_worker_timeout_failure_and_bounded_retention(self):
        import sys
        self.server.pdf_timeout=.05
        self.server.pdf_jobs.max_jobs=1
        with patch('folio.pdf_jobs.worker_command',return_value=[sys.executable,'-c','import time; time.sleep(60)']):
            status,first=self.submit();self.assertEqual(status,202)
            record=self.server.pdf_jobs.jobs[first['id']]
            self.wait_for(lambda:record.get('finished'))
            status,result=self.request('GET','/api/pdf/jobs/'+first['id'],headers={'X-Folio-Job':first['token']})
            self.assertEqual(result['state'],'failed')
            self.assertIn('时间',result['error'])
        self.server.pdf_timeout=10
        status,second=self.submit('?dpi=96');self.assertEqual(status,202)
        self.assertEqual(len(self.server.pdf_jobs.jobs),1)
        self.assertEqual(self.request('GET','/api/pdf/jobs/'+first['id'],headers={'X-Folio-Job':first['token']})[0],404)
        record=self.server.pdf_jobs.jobs[second['id']]
        self.wait_for(lambda:record.get('finished'))
        self.server.pdf_jobs.retention=-1
        self.assertEqual(self.request('GET','/api/pdf/jobs/'+second['id'],headers={'X-Folio-Job':second['token']})[0],404)
        self.assertFalse(self.server.pdf_jobs.jobs)

    def test_invalid_page_range_reports_failed_job(self):
        status,job=self.submit('?pages=0');self.assertEqual(status,202)
        record=self.server.pdf_jobs.jobs[job['id']]
        self.wait_for(lambda:record.get('finished'))
        status,result=self.request('GET','/api/pdf/jobs/'+job['id'],headers={'X-Folio-Job':job['token']})
        self.assertEqual(result['state'],'failed')
        self.assertNotIn('result',result)

    def test_oversized_worker_result_is_rejected_and_input_removed(self):
        import sys
        with patch('folio.pdf_jobs.MAX_RESULT_BYTES',128),patch('folio.pdf_jobs.worker_command',return_value=[sys.executable,'-c','print("x"*4096)']):
            status,job=self.submit();self.assertEqual(status,202)
            record=self.server.pdf_jobs.jobs[job['id']]
            self.wait_for(lambda:record.get('finished'))
        self.assertEqual(record['state'],'failed')
        self.assertIn('过大',record['error'])
        from pathlib import Path
        self.assertFalse((Path(record['directory'].name)/'input.pdf').exists())
        self.assertFalse((Path(record['directory'].name)/'result.json').exists())

    def test_frozen_worker_uses_dedicated_entry(self):
        from folio.pdf_jobs import worker_command
        import sys
        with patch.object(sys,'frozen',True,create=True):
            command=worker_command('reading',96,'1-3,8')
        self.assertEqual(command,[sys.executable,'--pdf-worker','reading','96','1-3,8'])

    def test_server_close_kills_worker_and_removes_private_files(self):
        import sys
        from pathlib import Path
        with patch('folio.pdf_jobs.worker_command',return_value=[sys.executable,'-c','import time; time.sleep(60)']):
            status,job=self.submit();self.assertEqual(status,202)
            record=self.server.pdf_jobs.jobs[job['id']]
            process=self.wait_for(lambda:record['process'])
            self.server.pdf_jobs.close()
            self.wait_for(lambda:record.get('finished'))
            self.assertIsNotNone(process.poll())
            self.assertFalse(Path(record['directory'].name).exists())

    def test_cancel_acknowledgement_waits_for_worker_cleanup_before_resubmit(self):
        import sys
        from types import SimpleNamespace
        worker_waiting=threading.Event()
        release_worker=threading.Event()
        cancel_returned=threading.Event()
        reply=[]
        real_sleep=time.sleep
        def hold_worker(seconds):
            worker_waiting.set()
            release_worker.wait(10)
            real_sleep(seconds)
        clock=SimpleNamespace(monotonic=time.monotonic,sleep=hold_worker)
        def cancel(job):
            reply.append(self.request('POST','/api/pdf/jobs/'+job['id']+'/cancel',headers={'X-Folio-Job':job['token']}))
            cancel_returned.set()
        with patch('folio.pdf_jobs.time',clock),patch('folio.pdf_jobs.worker_command',return_value=[sys.executable,'-c','import time; time.sleep(60)']):
            status,job=self.submit();self.assertEqual(status,202)
            self.assertTrue(worker_waiting.wait(5))
            record=self.server.pdf_jobs.jobs[job['id']]
            cancellation=threading.Thread(target=cancel,args=(job,));cancellation.start()
            try:
                acknowledged=cancel_returned.wait(.3)
                if acknowledged:
                    self.assertEqual(self.submit('?dpi=96')[0],202,'cancel response must allow immediate resubmission')
                self.assertFalse(acknowledged,'cancel acknowledged while worker still owns conversion lock')
            finally:
                release_worker.set()
                cancellation.join(10)
            self.assertFalse(cancellation.is_alive())
            self.assertEqual((reply[0][0],reply[0][1]['state']),(200,'cancelled'))
            self.assertTrue(record.get('finished'))
        self.assertEqual(self.submit('?dpi=96')[0],202)
