from pathlib import Path
import subprocess
import sys
import unittest


class WorkerLimitTests(unittest.TestCase):
    def test_worker_cannot_allocate_past_its_memory_ceiling(self):
        source = '''from folio.worker_limits import apply_worker_limits
apply_worker_limits(128 * 1024 * 1024)
try:
    value = bytearray(256 * 1024 * 1024)
except MemoryError:
    print('LIMITED')
else:
    raise SystemExit('memory limit was not enforced')
'''
        result = subprocess.run([sys.executable, '-c', source],
                                cwd=Path(__file__).resolve().parent.parent,
                                capture_output=True, timeout=15,
                                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform=='win32' else 0)
        self.assertEqual(result.returncode, 0, result.stderr.decode(errors='replace'))
        self.assertIn(b'LIMITED', result.stdout)

    @unittest.skipUnless(sys.platform=='win32', 'Windows active-process job limit')
    def test_windows_worker_cannot_spawn_an_additional_process(self):
        source = '''from folio.worker_limits import apply_worker_limits
import subprocess, sys
apply_worker_limits()
try:
    subprocess.run([sys.executable, '-c', 'pass'], check=True)
except OSError:
    print('BLOCKED')
else:
    raise SystemExit('child process limit was not enforced')
'''
        result = subprocess.run([sys.executable, '-c', source],
                                cwd=Path(__file__).resolve().parent.parent,
                                capture_output=True, timeout=15, creationflags=subprocess.CREATE_NO_WINDOW)
        self.assertEqual(result.returncode, 0, result.stderr.decode(errors='replace'))
        self.assertIn(b'BLOCKED', result.stdout)
