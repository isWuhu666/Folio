"""Windows desktop entry: run with the project's pythonw.exe, without a console."""
import argparse
import ctypes
import http.client
import json
import os
import subprocess
from pathlib import Path
import secrets
import sys
import threading
import time
import traceback
import webbrowser

from folio.http_server import create_server


ROOT = Path(__file__).resolve().parent
VERSION = '1.2.0'


def runtime_directory():
    if getattr(sys, 'frozen', False):
        return Path(os.environ.get('LOCALAPPDATA', Path.home() / '.local' / 'share')) / 'Folio'
    return ROOT / 'artifacts'


RUNTIME = runtime_directory()


def startup(mode='Status', port=8765):
    command = ['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
               str(ROOT / 'scripts' / 'startup.ps1'), '-Mode', mode, '-Port', str(port)]
    if getattr(sys, 'frozen', False):
        command += ['-ExecutablePath', sys.executable]
    response = subprocess.run(command, capture_output=True, timeout=15,
                              creationflags=subprocess.CREATE_NO_WINDOW)
    if response.returncode:
        raise RuntimeError(response.stderr.decode('utf-8', errors='replace'))
    return json.loads(response.stdout.decode('utf-8-sig'))


def tray_icon(server, url, args):
    if sys.platform != 'win32' or args.no_tray:
        return None
    try:
        import pystray
        from PIL import Image, ImageDraw
    except ImportError:
        return None  # Source-only minimal installs keep their existing lifecycle.
    image = Image.new('RGB', (64, 64), '#163c46')
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((17, 10, 47, 54), radius=4, fill='#faf7ee')
    for y in (23, 32, 41):
        draw.line((24, y, 40, y), fill='#163c46', width=3)

    def stop_from_tray(restart=False):
        server.restart_requested = restart
        try:
            stop_service(args.port, RUNTIME / f'desktop-{args.port}.json', wait=False)
        except Exception as exc:
            server.restart_requested = False
            ctypes.windll.user32.MessageBoxW(0, str(exc), 'Folio', 0x10)

    def exit_app(icon, item):
        stop_from_tray()

    def restart(icon, item):
        stop_from_tray(restart=True)

    def toggle_startup(icon, item):
        try:
            startup('Disable' if startup(port=args.port)['enabled'] else 'Enable', port=args.port)
            icon.update_menu()
        except Exception as exc:
            ctypes.windll.user32.MessageBoxW(0, str(exc), 'Folio 登录自启', 0x10)

    def checked(item):
        try:
            return startup(port=args.port)['enabled']
        except Exception:
            return False

    icon = pystray.Icon('Folio', image, f'Folio {VERSION} · 本机服务运行中 :{args.port}', pystray.Menu(
        pystray.MenuItem('打开 Folio', lambda: webbrowser.open(url), default=True),
        pystray.MenuItem(f'运行中 · 127.0.0.1:{args.port}', None, enabled=False),
        pystray.MenuItem('登录时启动（当前用户）', toggle_startup, checked=checked),
        pystray.MenuItem('重启服务', restart),
        pystray.MenuItem('退出 Folio', exit_app)))
    icon.run_detached()
    return icon


def restore_worker_streams():
    # PyInstaller windowed bootloaders clear sys.std*. Worker pipes still exist
    # as Windows standard handles; reattach them before importing the converter.
    if sys.platform == 'win32' and sys.stdin is None:
        import msvcrt
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.GetStdHandle.restype = ctypes.c_void_p
        for name, handle_id, flags, mode in (
            ('stdin', -10, os.O_RDONLY, 'rb'),
            ('stdout', -11, os.O_WRONLY, 'wb'),
            ('stderr', -12, os.O_WRONLY, 'wb')):
            handle = kernel.GetStdHandle(handle_id)
            fd = msvcrt.open_osfhandle(handle, flags | os.O_BINARY)
            stream = os.fdopen(fd, mode, buffering=0)
            import io
            setattr(sys, name, io.TextIOWrapper(stream, encoding='utf-8'))


def probe(port):
    connection = http.client.HTTPConnection('127.0.0.1', port, timeout=2)
    try:
        connection.request('GET', '/api/health')
        response = connection.getresponse()
        data = json.loads(response.read(8192))
        if response.status != 200 or data.get('status') != 'ok' or data.get('name') != '墨页 Folio':
            raise RuntimeError(f'端口 {port} 被其他程序占用，请使用 --port 指定其他端口。')
        return data
    except (OSError, http.client.HTTPException):
        return None
    except (ValueError, AttributeError) as exc:
        raise RuntimeError(f'端口 {port} 的响应不是墨页服务，请使用其他端口。') from exc
    finally:
        connection.close()


def stop_service(port, state_file, wait=True):
    health = probe(port)
    if health is None:
        return
    if not state_file.is_file():
        raise RuntimeError('当前服务由旧版命令行启动，请先在原窗口按 Ctrl+C 关闭，再使用新的打开入口。')
    state = json.loads(state_file.read_text(encoding='utf-8'))
    if not health.get('instance') or state.get('instance') != health['instance']:
        raise RuntimeError('当前服务与启动记录不一致，未关闭任何进程。请检查原启动窗口。')
    connection = http.client.HTTPConnection('127.0.0.1', port, timeout=5)
    try:
        connection.request('POST', '/api/shutdown', body=b'', headers={
            'X-Folio-Control': state['token']})
        response = connection.getresponse()
        response.read()
        if response.status == 409:
            raise RuntimeError('PDF 正在转换，请等待完成后再关闭墨页。')
        if response.status != 200:
            raise RuntimeError('服务拒绝关闭请求，请检查启动记录。')
    finally:
        connection.close()
    if not wait:
        return
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if probe(port) is None:
            return
        time.sleep(0.1)
    raise RuntimeError('服务尚未停止，请稍后重试。')


def run(args):
    state_file = RUNTIME / f'desktop-{args.port}.json'
    if args.stop:
        stop_service(args.port, state_file)
        return
    if not (ROOT / 'web/vendor/mathjax/tex-svg.js').is_file():
        raise RuntimeError('依赖尚未准备好，请先双击“安装.cmd”。')
    url = f'http://127.0.0.1:{args.port}'
    if probe(args.port):
        if not args.no_browser:
            webbrowser.open(url)
        return
    try:
        server = create_server(args.port)
    except OSError:
        # Two simultaneous double-clicks may race to bind. Reuse the winner.
        for _ in range(20):
            if probe(args.port):
                if not args.no_browser:
                    webbrowser.open(url)
                return
            time.sleep(0.1)
        raise RuntimeError(f'无法启动服务，端口 {args.port} 可能被占用。请使用其他端口。')
    instance = secrets.token_hex(16)
    token = secrets.token_urlsafe(32)
    server.control_token = token
    server.instance_id = instance
    try:
        state_file.write_text(json.dumps({'instance': instance, 'token': token}), encoding='utf-8')
        # Serving starts before opening the browser, so its first request is ready.
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        icon = tray_icon(server, url, args)
        try:
            if not args.no_browser:
                webbrowser.open(url)
            thread.join()
        except KeyboardInterrupt:
            server.shutdown()
            thread.join()
    finally:
        if "icon" in locals() and icon:
            icon.stop()
        server.server_close()
        if state_file.is_file():
            state = json.loads(state_file.read_text(encoding='utf-8'))
            if state.get('instance') == instance:
                state_file.unlink()
    return getattr(server, 'restart_requested', False)


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv and argv[0] == '--pdf-worker':
        restore_worker_streams()
        from folio.pdf_worker import main as worker_main
        original_argv = sys.argv
        try:
            sys.argv = [sys.argv[0], *argv[1:]]
            worker_main()
        finally:
            sys.argv = original_argv
        return 0
    parser = argparse.ArgumentParser(description='墨页 Folio 后台启动与关闭入口')
    parser.add_argument('--port', type=int, default=8765, choices=range(1, 65536), metavar='PORT')
    parser.add_argument('--no-browser', action='store_true')
    parser.add_argument('--stop', action='store_true')
    parser.add_argument('--no-tray', action='store_true', help='Disable the native tray icon')
    parser.add_argument('--version', action='version', version=VERSION)
    args = parser.parse_args(argv)
    RUNTIME.mkdir(parents=True, exist_ok=True)
    log_file = RUNTIME / f'desktop-{args.port}.log'
    original_out, original_err = sys.stdout, sys.stderr
    with log_file.open('a', encoding='utf-8', buffering=1) as log:
        sys.stdout = sys.stderr = log
        try:
            while run(args):
                pass
            return 0
        except Exception as exc:
            traceback.print_exc()
            message = f'{exc}\n\n错误日志：{log_file}'
            if sys.platform == 'win32' and original_err is None:
                ctypes.windll.user32.MessageBoxW(0, message, '墨页 Folio', 0x10)
            elif original_err:
                print(message, file=original_err)
            return 1
        finally:
            sys.stdout, sys.stderr = original_out, original_err


if __name__ == '__main__':
    raise SystemExit(main())
