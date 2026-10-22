import argparse
import json
import mimetypes
from pathlib import Path
import threading
import subprocess
import sys
import socket
import secrets
import time
import io
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit, parse_qs
import webbrowser
from .limits import MAX_PDF_BYTES, PDF_TIMEOUT_SECONDS
from .pdf_jobs import PdfJobs, worker_command, stop_worker

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / 'web'


class DeadlineInput(io.RawIOBase):
    """Recalculate the header deadline before every raw socket receive."""
    def __init__(self, raw, handler):
        super().__init__()
        self.raw, self.handler = raw, handler

    def readable(self):
        return True

    def readinto(self, buffer):
        deadline = getattr(self.handler, 'header_deadline', None)
        if deadline is not None:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError('Request headers exceeded deadline')
            self.handler.connection.settimeout(remaining)
        return self.raw.readinto(buffer)

    def close(self):
        try:
            self.raw.close()
        finally:
            super().close()


class LocalHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = sys.platform != 'win32'
    # Queue short browser asset bursts without raising the 16 active-connection cap.
    request_queue_size = 64

    def server_close(self):
        if hasattr(self,'pdf_jobs'):self.pdf_jobs.close()
        super().server_close()

    def server_bind(self):
        if sys.platform == 'win32':
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()

    def process_request(self, request, client_address):
        if not self.request_slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        with self.request_count_lock:
            self.active_requests += 1
        try:
            super().process_request(request, client_address)
        except Exception:
            self.release_request_slot()
            raise

    def release_request_slot(self):
        with self.request_count_lock:
            self.active_requests -= 1
        self.request_slots.release()

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.release_request_slot()


class Handler(BaseHTTPRequestHandler):
    server_version = 'Folio/1.0'

    def version_string(self):
        return 'Folio'

    def setup(self):
        super().setup()
        self.rfile.close()
        self.rfile = io.BufferedReader(DeadlineInput(self.connection.makefile('rb', buffering=0), self))
        self.connection.settimeout(5)

    def handle_one_request(self):
        self.header_deadline = time.monotonic() + self.server.header_timeout
        super().handle_one_request()

    def parse_request(self):
        try:
            return super().parse_request()
        finally:
            self.header_deadline = None
            self.connection.settimeout(5)

    def log_message(self, *_):
        pass

    def valid_request(self):
        port = self.server.server_port
        hosts = {f'127.0.0.1:{port}', f'localhost:{port}'}
        origin = self.headers.get('Origin')
        return (
            len(self.headers.get_all('Host', [])) == 1
            and self.headers.get('Host', '') in hosts
            and (not origin or origin in {f'http://{h}' for h in hosts})
            and self.headers.get('Sec-Fetch-Site', '') != 'cross-site'
        )

    def send_bytes(self, status, data, content_type='application/json; charset=utf-8'):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'self' blob:; frame-src 'self' blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'")
        self.send_header('X-Frame-Options', 'SAMEORIGIN')
        self.send_header('Cross-Origin-Resource-Policy', 'same-origin')
        self.send_header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()')
        self.send_header('Connection', 'close')
        self.end_headers()
        try:
            self.wfile.write(data)
        except OSError:
            pass

    def send_json(self, status, data):
        self.send_bytes(status, json.dumps(data, ensure_ascii=False).encode('utf-8'))

    def do_GET(self):
        if not self.valid_request():
            return self.send_json(403, {'error': '只接受本机同源请求。'})
        path = unquote(urlsplit(self.path).path)
        if path.startswith('/api/pdf/jobs/'):
            ident=path[len('/api/pdf/jobs/'):]
            status,payload=self.server.pdf_jobs.inspect(ident,self.headers.get('X-Folio-Job',''))
            return self.send_json(status,payload)
        if path == '/api/health':
            return self.send_json(200, {'status': 'ok', 'name': '墨页 Folio',
                                        'instance': self.server.instance_id})
        if '\\' in path or '\x00' in path or any(p.startswith('.') for p in path.split('/') if p):
            return self.send_json(404, {'error': '文件不存在。'})
        base = ROOT / 'examples' if path.startswith('/examples/') else WEB
        relative = path[len('/examples/'):] if base != WEB else path.lstrip('/')
        target = (base / (relative or 'index.html')).resolve()
        if not target.is_relative_to(base.resolve()) or not target.is_file():
            return self.send_json(404, {'error': '文件不存在。'})
        mime = mimetypes.guess_type(target)[0] or 'application/octet-stream'
        if target.suffix in ('.js', '.mjs'):
            mime = 'text/javascript'
        if mime.startswith('text/'):
            mime += '; charset=utf-8'
        self.send_bytes(200, target.read_bytes(), mime)

    def do_POST(self):
        if not self.valid_request():
            return self.send_json(403, {'error': '只接受本机同源请求。'})
        parsed=urlsplit(self.path)
        if self.headers.get('Transfer-Encoding') or len(self.headers.get_all('Content-Length', [])) > 1:
            return self.send_json(400, {'error': '请求长度不明确，已拒绝处理。'})
        if parsed.path == '/api/shutdown':
            token = self.headers.get('X-Folio-Control', '').encode('utf-8')
            expected = (self.server.control_token or '').encode('ascii')
            if not expected or not secrets.compare_digest(token, expected):
                return self.send_json(403, {'error': '关闭凭据无效。'})
            if not self.server.pdf_lock.acquire(blocking=False):
                return self.send_json(409, {'error': 'PDF 正在转换，请等待完成后再关闭。'})
            self.send_json(200, {'status': 'stopping'})
            threading.Thread(target=self.server.shutdown, daemon=True).start()
            return
        if parsed.path.startswith('/api/pdf/jobs/') and parsed.path.endswith('/cancel'):
            ident=parsed.path[len('/api/pdf/jobs/'):-len('/cancel')]
            status,payload=self.server.pdf_jobs.inspect(ident,self.headers.get('X-Folio-Job',''),cancel=True)
            return self.send_json(status,payload)
        if parsed.path not in ('/api/pdf','/api/pdf/jobs'):return self.send_json(404,{'error':'接口不存在。'})
        if self.headers.get('X-Folio-Request') != '1':
            return self.send_json(403, {'error': '仅接受工作台发起的转换请求。'})
        if self.headers.get_content_type() != 'application/pdf':
            return self.send_json(415, {'error': '转换接口仅接受 application/pdf。'})
        try:
            query=parse_qs(parsed.query);pages=query.get('pages',[''])[0];mode=query.get('mode',['faithful'])[0];dpi=int(query.get('dpi',['144'])[0])
            if mode not in ('faithful','reading') or dpi not in (96,144,192) or len(pages)>1000:raise ValueError()
            size=int(self.headers.get('Content-Length','-1'))
            if size<0:return self.send_json(411,{'error':'请求缺少有效文件长度。'})
            if size>MAX_PDF_BYTES:return self.send_json(413,{'error':'PDF 超过 40 MiB，请拆分文档。'})
        except ValueError:return self.send_json(400,{'error':'转换模式、分辨率或文件长度无效。'})
        if not self.server.pdf_lock.acquire(blocking=False):
            # Windows may reset a connection closed with an unread upload.
            deadline=time.monotonic()+min(self.server.upload_timeout,2)
            remaining=size
            try:
                while remaining:
                    wait=deadline-time.monotonic()
                    if wait<=0:break
                    self.connection.settimeout(wait)
                    chunk=self.rfile.read1(min(65536,remaining))
                    if not chunk:break
                    remaining-=len(chunk)
            except (TimeoutError,OSError):pass
            return self.send_json(503,{'error':'另一个 PDF 正在转换，请稍后重试。'})
        process=None
        transferred=False
        try:
            deadline = time.monotonic() + self.server.upload_timeout
            chunks, remaining = [], size
            while remaining:
                wait = deadline - time.monotonic()
                if wait <= 0:
                    raise TimeoutError()
                self.connection.settimeout(wait)
                chunk = self.rfile.read1(min(65536, remaining))
                if not chunk:
                    break
                chunks.append(chunk)
                remaining -= len(chunk)
            data = b''.join(chunks)
            if len(data)!=size:raise ValueError('文件传输不完整，请重试。')
            if parsed.path=='/api/pdf/jobs':
                payload=self.server.pdf_jobs.start(data,mode,dpi,pages)
                transferred=True
                return self.send_json(202,payload)
            process=subprocess.Popen(worker_command(mode,dpi,pages),cwd=ROOT,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,
                                     creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0)
            output,_=process.communicate(data,timeout=self.server.pdf_timeout)
            if process.returncode!=0:
                status,payload=500,{'error':'PDF 工作进程异常退出，请降低分辨率或拆分文档。'}
            else:
                result=json.loads(output)
                status,payload=(result.get('status',400),{'error':result['error']}) if 'error' in result else (200,result['result'])
        except subprocess.TimeoutExpired:
            status,payload=504,{'error':'转换超过时间限制，请拆分文档或降低分辨率。'}
        except (TimeoutError,socket.timeout):status,payload=408,{'error':'文件传输超时，请重试。'}
        except ValueError:status,payload=400,{'error':'文件数据无效或传输不完整，请重试。'}
        except Exception:status,payload=500,{'error':'PDF 转换未能完成，请重新安装依赖或检查文件。'}
        finally:
            if process and process.poll() is None:stop_worker(process);process.communicate()
            if not transferred:self.server.pdf_lock.release()
        self.send_json(status,payload)

    def do_OPTIONS(self):
        self.send_json(403, {'error': '不开放跨站调用。'})


def create_server(port=8765):
    server = LocalHTTPServer(('127.0.0.1', port), Handler)
    server.daemon_threads = True
    server.pdf_lock = threading.Lock()
    server.pdf_timeout = PDF_TIMEOUT_SECONDS
    server.control_token = None
    server.instance_id = None
    server.upload_timeout = 20
    server.header_timeout = 5
    server.request_slots = threading.BoundedSemaphore(16)
    server.request_count_lock = threading.Lock()
    server.active_requests = 0
    server.pdf_jobs = PdfJobs(server,ROOT)
    return server


def main(argv=None):
    # Piped Windows consoles may use CP1252; diagnostics must not stop the service.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, 'reconfigure'):
            stream.reconfigure(errors='backslashreplace')
    parser = argparse.ArgumentParser(description='墨页 Folio 本地文档转换器')
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args(argv)
    try:
        server = create_server(args.port)
    except OSError as exc:
        print(f'启动失败，端口 {args.port} 可能已被占用。可用 --port 8766 指定其他端口。\n{exc}')
        return 1
    url = f'http://127.0.0.1:{server.server_port}'
    print(f'墨页 Folio 已启动：{url}\n按 Ctrl+C 关闭服务。', flush=True)
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0
