# Third-party components

This application uses the following local dependencies. It does not claim ownership of their code or fonts.

| Component | License |
| --- | --- |
| markdown-it | MIT |
| markdown-it-footnote | MIT |
| DOMPurify | Apache-2.0 OR MPL-2.0 |
| highlight.js browser assets | BSD-3-Clause |
| MathJax | Apache-2.0 |
| MathJax New Computer Modern font data | Apache-2.0; see package font notices for source font terms |
| PDF.js (Android local PDF engine) | Apache-2.0; bundled CMaps, standard fonts and image/WASM decoders retain their own license files |
| AndroidX WebKit and AndroidX support libraries (Android only) | Apache-2.0 |
| pdfplumber | MIT |
| pdfminer.six | MIT |
| pypdfium2 | Apache-2.0 OR BSD-3-Clause |
| PDFium and bundled third-party code | BSD-style and individual third-party licenses |
| Pillow | MIT-CMU and bundled component notices |
| cryptography | Apache-2.0 OR BSD-3-Clause |
| cffi | MIT |
| charset-normalizer | MIT |
| pycparser | BSD-3-Clause |
| pystray | LGPL-3.0; preserve library source and license |
| six | MIT |
| OpenSSL 3 (Python runtime DLLs) | Apache-2.0 |
| CPython runtime | Python-2.0 and bundled notices |
| PyInstaller bootloader | GPL-2.0-or-later with bootloader exception |
| Playwright (development only) | Apache-2.0 |

`npm run prepare:vendor` copies package license texts into `web/vendor/LICENSES.txt` and retains license files in the copied MathJax packages. Installed Python package license texts, including PDFium's full third-party notices, are under `.venv/Lib/site-packages/`, especially `pypdfium2*/` and the relevant `*.dist-info/licenses/` directories. Preserve these files if redistributing installed dependencies; this summary does not replace their license texts.

The app uses system fonts by name and does not redistribute the user's installed system fonts. Example text, diagrams and PDF fixtures are generated for this project; numerical values in the examples are illustrative and are not measured results.

The frozen distribution retains package metadata/license directories and includes pystray source modules via collect_all; its LGPL text is included with pystray metadata. You may modify or replace that library and rebuild using the documented recipe; Folio imposes no reverse-engineering restriction. PyInstaller is a build tool; its bootloader exception permits distribution of the resulting application under the project license. Bundled native libraries retain their upstream notices; the MIT license at the root only covers Folio project code.

OpenSSL runtime license text is retained in `docs/third-party/OpenSSL-LICENSE.txt` and in the frozen package under `_internal/licenses/OpenSSL/`. Source: [OpenSSL 3.0.19 LICENSE.txt](https://github.com/openssl/openssl/blob/openssl-3.0.19/LICENSE.txt), matching the development Python SSL runtime at the time of packaging. Recheck runtime component versions/licenses when changing the build interpreter.
