from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import desktop


class PortableEntryTests(unittest.TestCase):
    def test_worker_dispatch_happens_before_desktop_setup(self):
        with patch('folio.pdf_worker.main') as worker, patch.object(desktop, 'run') as run:
            self.assertEqual(desktop.main(['--pdf-worker', 'reading', '96', '1']), 0)
        worker.assert_called_once()
        run.assert_not_called()

    def test_frozen_runtime_is_outside_bundle(self):
        with patch.object(sys, 'frozen', True, create=True), patch.dict('os.environ', {'LOCALAPPDATA': str(ROOT / 'artifacts' / 'local-data')}):
            self.assertEqual(desktop.runtime_directory(), ROOT / 'artifacts' / 'local-data' / 'Folio')

    def test_tray_restart_sets_intent_before_nonblocking_shutdown(self):
        entries = []
        class Icon:
            def __init__(self, *args):
                self.menu = args[-1]
            def run_detached(self):
                pass
        def menu_item(label, action, **kwargs):
            entries.append((label, action))
            return label
        backend = SimpleNamespace(Icon=Icon, MenuItem=menu_item, Menu=lambda *items: items)
        server = SimpleNamespace()
        args = SimpleNamespace(port=12345, no_tray=False)
        def shutdown(*values, **kwargs):
            self.assertTrue(server.restart_requested)
            self.assertFalse(kwargs['wait'])
        with patch.object(sys, 'platform', 'win32'), patch.dict(sys.modules, {'pystray': backend}), patch.object(desktop, 'stop_service', side_effect=shutdown) as stop:
            desktop.tray_icon(server, 'http://127.0.0.1:12345', args)
            restart = next(action for label, action in entries if label == '重启服务')
            restart(None, None)
        stop.assert_called_once()
