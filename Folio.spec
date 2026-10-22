# Build with the active Windows venv: python -m PyInstaller Folio.spec
from pathlib import Path
import sys
import PyInstaller
from PyInstaller.utils.hooks import collect_all, copy_metadata, collect_data_files
root = Path(SPECPATH)
datas = [(str(root / name), name) for name in ('web', 'examples', 'scripts')]
datas += [(str(root / name), '.') for name in ('README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'SECURITY.md')]
datas += [(str(Path(sys.base_prefix) / 'LICENSE.txt'), 'licenses/CPython')]
datas += [(str(Path(PyInstaller.__file__).parent.parent / 'pyinstaller-6.22.3.dist-info' / 'licenses' / 'COPYING.txt'), 'licenses/PyInstaller')]
datas += [(str(root / 'docs' / 'third-party' / 'OpenSSL-LICENSE.txt'), 'licenses/OpenSSL')]
datas += collect_data_files('pystray', include_py_files=True)
binaries, hiddenimports = [], ['pystray._win32', 'folio.pdf_worker', '_cffi_backend']
for package in ('pdfplumber', 'pdfminer', 'pypdfium2', 'pypdfium2_raw', 'PIL', 'cryptography', 'pystray'):
    more_data, more_binaries, more_hidden = collect_all(package)
    datas += more_data
    binaries += more_binaries
    hiddenimports += more_hidden
for package in ('pdfplumber', 'pdfminer.six', 'pypdfium2', 'pillow', 'cryptography', 'cffi', 'charset-normalizer', 'pycparser', 'pystray', 'six'):
    datas += copy_metadata(package)
a = Analysis([str(root / 'desktop.py')], pathex=[str(root)], binaries=binaries,
             datas=datas, hiddenimports=hiddenimports, module_collection_mode={'pystray': 'py'}, excludes=['tkinter'], noarchive=False)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name='Folio', debug=False,
          bootloader_ignore_signals=False, strip=False, upx=False, console=False)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name='Folio')
