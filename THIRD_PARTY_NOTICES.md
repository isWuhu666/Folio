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
| pdfplumber | MIT |
| pdfminer.six | MIT |
| pypdfium2 | Apache-2.0 OR BSD-3-Clause |
| PDFium and bundled third-party code | BSD-style and individual third-party licenses |
| Pillow | MIT-CMU and bundled component notices |
| cryptography | Apache-2.0 OR BSD-3-Clause |
| cffi | MIT |
| charset-normalizer | MIT |
| pycparser | BSD-3-Clause |
| Playwright (development only) | Apache-2.0 |

`npm run prepare:vendor` copies package license texts into `web/vendor/LICENSES.txt` and retains license files in the copied MathJax packages. Installed Python package license texts, including PDFium's full third-party notices, are under `.venv/Lib/site-packages/`, especially `pypdfium2*/` and the relevant `*.dist-info/licenses/` directories. Preserve these files if redistributing installed dependencies; this summary does not replace their license texts.

The app uses system fonts by name and does not redistribute the user's installed system fonts. Example text, diagrams and PDF fixtures are generated for this project; numerical values in the examples are illustrative and are not measured results.
