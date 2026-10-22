"""Exercise the frozen package from an unrelated cwd, without browser/tray UI."""
import http.client
import hashlib
import json
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'tests'))
from pdf_fixtures import make_pdf
exe = Path(sys.argv[1]).resolve()
root = Path(__file__).resolve().parent.parent
for tree in ('web', 'examples'):
    for source in (root / tree).rglob('*'):
        if not source.is_file():
            continue
        packaged = exe.parent / '_internal' / source.relative_to(root)
        assert packaged.is_file(), f'Missing bundled resource: {source.relative_to(root)}'
        assert hashlib.sha256(source.read_bytes()).digest() == hashlib.sha256(packaged.read_bytes()).digest(), f'Stale bundled resource: {source.relative_to(root)}'
for license_path in ('licenses/CPython/LICENSE.txt', 'licenses/PyInstaller/COPYING.txt', 'licenses/OpenSSL/OpenSSL-LICENSE.txt', 'pystray-0.19.5.dist-info/COPYING.LGPL'):
    assert (exe.parent / '_internal' / license_path).is_file(), f'Missing license: {license_path}'
assert list((exe.parent / '_internal').rglob('pdfium.dll')), 'Missing native PDFium library'
assert (exe.parent / '_internal' / 'pystray' / '_win32.py').is_file(), 'Missing replaceable tray library source'

with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]

def request(path, method='GET', body=None, extra_headers=None):
    connection = http.client.HTTPConnection('127.0.0.1', port, timeout=45)
    try:
        headers = {'Content-Type': 'application/pdf', 'X-Folio-Request': '1'}
        connection.request(method, path, body=body, headers={**headers, **(extra_headers or {})})
        response = connection.getresponse()
        return response.status, response.read()
    finally:
        connection.close()

with tempfile.TemporaryDirectory() as cwd:
    command = [str(exe), '--port', str(port), '--no-browser', '--no-tray']
    service = subprocess.Popen(command, cwd=cwd)
    try:
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            try:
                if request('/api/health')[0] == 200:
                    break
            except OSError:
                pass
            if service.poll() is not None:
                raise RuntimeError(f'Portable service exited: {service.returncode}')
            time.sleep(.1)
        else:
            raise RuntimeError('Portable startup timed out')
        for path in ('/', '/vendor/mathjax/tex-svg.js', '/vendor/mathjax-font/svg.js', '/modules/project.js', '/modules/output.js', '/modules/pdf-job.js', '/modules/history.js'):
            status, body = request(path)
            assert status == 200 and body, (path, status)
        for mode in ('reading', 'faithful'):
            status, body = request(f'/api/pdf?mode={mode}&dpi=96', 'POST', make_pdf())
            assert status == 200, (mode, status, body[:500])
            assert json.loads(body)['pageCount'] == 1
        status, body = request('/api/pdf/jobs?mode=faithful&dpi=96&pages=1', 'POST', make_pdf())
        assert status == 202, (status, body)
        job = json.loads(body)
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            status, body = request('/api/pdf/jobs/' + job['id'], extra_headers={'X-Folio-Job': job['token']})
            assert status == 200, (status, body)
            progress = json.loads(body)
            if progress['state'] in ('completed', 'failed', 'cancelled'):
                break
            time.sleep(.05)
        assert progress['state'] == 'completed', progress
        assert progress['completed'] == progress['total'] == 1, progress
        assert progress['result']['pageCount'] == 1
        duplicate = subprocess.run(command, cwd=cwd, timeout=15)
        assert duplicate.returncode == 0
        stopped = subprocess.run([*command, '--stop'], cwd=cwd, timeout=20)
        assert stopped.returncode == 0
        assert service.wait(timeout=15) == 0
        print('Portable resource hashes/licenses, health, local assets, text/facsimile PDF, paged job/progress, reuse and shutdown passed.')
    finally:
        if service.poll() is None:
            service.terminate()
            service.wait(timeout=15)
