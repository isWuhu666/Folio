import argparse
import json
import mimetypes
from pathlib import Path
import threading
import subprocess
import sys
import socket
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit, parse_qs
import webbrowser
from .limits import MAX_PDF_BYTES, PDF_TIMEOUT_SECONDS

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / 'web'


class Handler(BaseHTTPRequestHandler):
    server_version = 'Folio/1.0'

    def log_message(self, *_):
        pass

    def valid_request(self):
        port = self.server.server_port
        hosts = {f'127.0.0.1:{port}', f'localhost:{port}'}
        origin = self.headers.get('Origin')
        return (
            self.headers.get('Host', '') in hosts
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
        self.send_header('Connection', 'close')
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass

    def send_json(self, status, data):
        self.send_bytes(status, json.dumps(data, ensure_ascii=False).encode('utf-8'))

    def do_GET(self):
        if not self.valid_request():
            return self.send_json(403, {'error': '只接受本机同源请求。'})
        path = unquote(urlsplit(self.path).path)
        if path == '/api/health':
            return self.send_json(200, {'status': 'ok', 'name': '墨页 Folio'})
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
        if parsed.path!='/api/pdf':return self.send_json(404,{'error':'接口不存在。'})
        try:
            query=parse_qs(parsed.query);mode=query.get('mode',['faithful'])[0];dpi=int(query.get('dpi',['144'])[0])
            if mode not in ('faithful','reading') or dpi not in (96,144,192):raise ValueError()
            size=int(self.headers.get('Content-Length','-1'))
            if size<0:return self.send_json(411,{'error':'请求缺少有效文件长度。'})
            if size>MAX_PDF_BYTES:return self.send_json(413,{'error':'PDF 超过 40 MiB，请拆分文档。'})
        except ValueError:return self.send_json(400,{'error':'转换模式、分辨率或文件长度无效。'})
        if not self.server.pdf_lock.acquire(blocking=False):return self.send_json(503,{'error':'另一个 PDF 正在转换，请稍后重试。'})
        process=None
        try:
            self.connection.settimeout(15)
            data=self.rfile.read(size)
            if len(data)!=size:raise ValueError('文件传输不完整，请重试。')
            process=subprocess.Popen([sys.executable,'-m','folio.pdf_worker',mode,str(dpi)],cwd=ROOT,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
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
            if process and process.poll() is None:process.kill();process.communicate()
            self.server.pdf_lock.release()
        self.send_json(status,payload)


def create_server(port=8765):
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    server.daemon_threads = True
    server.pdf_lock = threading.Lock()
    server.pdf_timeout = PDF_TIMEOUT_SECONDS
    return server


def main(argv=None):
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
