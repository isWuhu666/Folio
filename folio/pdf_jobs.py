"""Bounded, local PDF jobs. Only numeric progress leaves the worker on stderr."""
import json
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
import threading
import time

MAX_RESULT_BYTES = 128 * 1024 * 1024
TERMINAL = {'completed', 'failed', 'cancelled'}


def worker_command(mode, dpi, pages=''):
    executable=Path(sys.executable)
    if getattr(sys,'frozen',False):
        return [str(executable),'--pdf-worker',mode,str(dpi),pages]
    if sys.platform=='win32' and executable.name.lower()=='pythonw.exe':
        executable=executable.with_name('python.exe')
    return [str(executable),'-m','folio.pdf_worker',mode,str(dpi),pages]


def stop_worker(process):
    if process.poll() is not None:return
    # Windows virtualenv python.exe is a launcher; its child owns the actual
    # conversion. Kill the process tree so cancellation frees the PDF too.
    if sys.platform=='win32':
        try:
            subprocess.run(['taskkill','/PID',str(process.pid),'/T','/F'],
                stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=5,
                creationflags=subprocess.CREATE_NO_WINDOW)
        except (OSError,subprocess.TimeoutExpired):pass
    if process.poll() is None:process.kill()
    process.wait(timeout=5)


def remove_file(path):
    # TerminateProcess returns before Windows closes every inherited file
    # handle. Allow that brief teardown window before deleting private data.
    for attempt in range(40):
        try:
            path.unlink(missing_ok=True)
            return
        except PermissionError:
            if attempt==39:raise
            time.sleep(.025)


class PdfJobs:
    def __init__(self, server, root, max_jobs=4, retention=600):
        self.server,self.root=server,root
        self.max_jobs,self.retention=max_jobs,retention
        self.lock=threading.RLock()
        self.jobs={}
        self.closed=False
        self.wakeup=threading.Event()
        threading.Thread(target=self._reap,daemon=True).start()

    def _reap(self):
        while not self.wakeup.wait(30):
            with self.lock:self._cleanup()

    def _cleanup(self, room=False):
        now=time.monotonic()
        for ident,job in list(self.jobs.items()):
            if job.get('finished') and now-job['updated']>self.retention:
                job['directory'].cleanup();del self.jobs[ident]
        if room:
            for ident,job in list(self.jobs.items()):
                if len(self.jobs)<self.max_jobs:break
                if job.get('finished'):
                    job['directory'].cleanup();del self.jobs[ident]

    def start(self,data,mode,dpi,pages):
        """Caller transfers ownership of the already acquired server pdf_lock."""
        directory=tempfile.TemporaryDirectory(prefix='folio-pdf-')
        try:
            source=Path(directory.name)/'input.pdf';source.write_bytes(data)
            with self.lock:
                self._cleanup(room=True)
                if self.closed or len(self.jobs)>=self.max_jobs:raise RuntimeError('任务数量超过限制。')
                ident=secrets.token_urlsafe(18);token=secrets.token_urlsafe(32)
                job={'id':ident,'token':token,'state':'running','stage':'starting','completed':0,'total':0,
                     'updated':time.monotonic(),'directory':directory,'process':None,'done':threading.Event()}
                self.jobs[ident]=job
                threading.Thread(target=self._run,args=(job,source,mode,dpi,pages),daemon=True).start()
                return {'id':ident,'token':token}
        except Exception:
            directory.cleanup();raise

    def _progress(self,job,stream):
        try:
            while True:
                line=stream.readline(4097)
                if not line:break
                if len(line)>4096:continue
                try:
                    event=json.loads(line)
                    completed,total=event['completed'],event['total']
                    if type(completed)!=int or type(total)!=int or not 0<=completed<=total<=80:continue
                    with self.lock:
                        if job['state'] not in TERMINAL:
                            job.update(stage='converting',completed=completed,total=total)
                except (ValueError,KeyError,TypeError):pass
        finally:stream.close()

    def _run(self,job,source,mode,dpi,pages):
        process=None
        output=Path(job['directory'].name)/'result.json'
        try:
            with source.open('rb') as stdin, output.open('wb') as stdout:
                with self.lock:
                    if job['state']=='cancelled':return
                    process=subprocess.Popen(worker_command(mode,dpi,pages),cwd=self.root,stdin=stdin,stdout=stdout,stderr=subprocess.PIPE,
                        creationflags=subprocess.CREATE_NO_WINDOW if sys.platform=='win32' else 0)
                    job['process']=process
                reader=threading.Thread(target=self._progress,args=(job,process.stderr),daemon=True);reader.start()
                deadline=time.monotonic()+self.server.pdf_timeout
                while process.poll() is None:
                    if time.monotonic()>deadline:raise TimeoutError('转换超过时间限制，请拆分文档或降低分辨率。')
                    if output.stat().st_size>MAX_RESULT_BYTES:raise ValueError('转换结果过大，请减少页数或分辨率。')
                    time.sleep(.02)
                reader.join(timeout=2)
            if output.stat().st_size>MAX_RESULT_BYTES:raise ValueError('转换结果过大，请减少页数或分辨率。')
            if process.returncode:raise ValueError('PDF 工作进程异常退出，请降低分辨率或拆分文档。')
            payload=json.loads(output.read_bytes())
            if 'error' in payload:raise ValueError(payload['error'])
            if not isinstance(payload.get('result'),dict):raise ValueError('PDF 工作进程返回无效结果。')
            with self.lock:
                if job['state']!='cancelled':job.update(state='completed',stage='completed',output=output)
        except Exception as exc:
            with self.lock:
                if job['state']!='cancelled':job.update(state='failed',stage='failed',error=str(exc) if isinstance(exc,(ValueError,TimeoutError)) else 'PDF 转换未能完成。')
        finally:
            if process and process.poll() is None:stop_worker(process)
            with self.lock:
                job['process']=None;job['updated']=time.monotonic()
                try:
                    remove_file(source)
                    if job['state']!='completed':remove_file(output)
                    if self.closed:job['directory'].cleanup()
                finally:
                    self.server.pdf_lock.release()
                    job['finished']=True
                    job['done'].set()

    def inspect(self,ident,token,cancel=False):
        with self.lock:
            self._cleanup()
            job=self.jobs.get(ident)
            if not job:return 404,{'error':'任务不存在或已过期。'}
            if not token or not secrets.compare_digest(token.encode('utf-8'),job['token'].encode('ascii')):
                return 403,{'error':'任务凭据无效。'}
            if cancel and job['state'] not in TERMINAL:
                job.update(state='cancelled',stage='cancelled',updated=time.monotonic())
                if job['process'] and job['process'].poll() is None:stop_worker(job['process'])
        if cancel:
            # Acknowledgement means a replacement job can acquire pdf_lock.
            # _run needs self.lock to finish, so never wait while holding it.
            job['done'].wait()
        with self.lock:
            if self.jobs.get(ident) is not job:
                return 404,{'error':'任务不存在或已过期。'}
            result={key:job[key] for key in ('state','stage','completed','total')}
            if 'error' in job:result['error']=job['error']
            if job['state']=='completed':result['result']=json.loads(job['output'].read_bytes())['result']
            return 200,result

    def close(self):
        with self.lock:
            self.closed=True;self.wakeup.set()
            for job in self.jobs.values():
                if job['state'] not in TERMINAL:
                    job.update(state='cancelled',stage='cancelled')
                    if job['process'] and job['process'].poll() is None:stop_worker(job['process'])
                elif job.get('finished'):job['directory'].cleanup()
