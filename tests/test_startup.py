import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent


@unittest.skipUnless(sys.platform == 'win32', 'Windows user login startup')
class StartupTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='startup-test-', dir=ROOT / 'artifacts')
        self.directory = Path(self.temporary.name)

    def tearDown(self):
        self.assertTrue(self.directory.resolve().is_relative_to((ROOT / 'artifacts').resolve()))
        self.temporary.cleanup()

    def run_mode(self, mode, check=True, extra=()):
        result = subprocess.run([
            'powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
            str(ROOT / 'scripts' / 'startup.ps1'), '-Mode', mode,
            '-StartupDirectory', str(self.directory), *extra], cwd=ROOT, capture_output=True,
            creationflags=subprocess.CREATE_NO_WINDOW, timeout=15)
        if check:
            self.assertEqual(result.returncode, 0, result.stderr.decode('utf-8', errors='replace'))
            return json.loads(result.stdout.decode('utf-8-sig'))
        return result

    def test_enable_read_back_and_disable_are_idempotent(self):
        self.assertFalse(self.run_mode('Status')['enabled'])
        enabled = self.run_mode('Enable')
        self.assertTrue(enabled['enabled'])
        self.assertTrue(enabled['matchesProject'])
        self.assertEqual(Path(enabled['target']).name.lower(), 'pythonw.exe')
        self.assertEqual(enabled['arguments'], f'"{ROOT / "desktop.py"}" --no-browser')
        self.assertTrue(Path(enabled['path']).is_file())
        self.assertEqual(self.run_mode('Enable')['path'], enabled['path'])
        self.assertTrue(self.run_mode('Status')['enabled'])
        self.assertFalse(self.run_mode('Disable')['enabled'])
        self.assertFalse(Path(enabled['path']).exists())
        self.assertFalse(self.run_mode('Disable')['enabled'])

    def test_does_not_replace_an_unrelated_startup_entry(self):
        # A file belonging to somebody else must not be overwritten or deleted.
        path = self.directory / 'Folio Background.lnk'
        original = b'not a Folio shortcut'
        path.write_bytes(original)
        self.assertNotEqual(self.run_mode('Enable', check=False).returncode, 0)
        self.assertNotEqual(self.run_mode('Disable', check=False).returncode, 0)
        self.assertEqual(path.read_bytes(), original)

    def test_portable_startup_targets_executable_and_keeps_selected_port(self):
        executable = ROOT / '.venv' / 'Scripts' / 'python.exe'
        extra = ('-ExecutablePath', str(executable), '-Port', '8767')
        enabled = self.run_mode('Enable', extra=extra)
        self.assertTrue(enabled['enabled'])
        self.assertEqual(Path(enabled['target']), executable)
        self.assertEqual(enabled['arguments'], '--no-browser --port 8767')
        self.assertTrue(self.run_mode('Status', extra=extra)['enabled'])
        self.assertFalse(self.run_mode('Disable', extra=extra)['enabled'])
