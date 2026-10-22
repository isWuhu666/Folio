# Contributing to Folio

[中文贡献说明](CONTRIBUTING.zh-CN.md)

Use Python 3.14 and Node.js 24 for the currently verified Windows development environment. Create `.venv`, install `requirements.txt` and `requirements-build.txt`, run `npm ci` and `npm run prepare:vendor`.

Run `python -m unittest discover -s tests`, `npx playwright install chromium`, and `npm test` before proposing a change. For desktop changes, also run `powershell -File scripts/build-release.ps1` on Windows. See [release instructions](docs/release.md) for evidence and packaging limits.

For Android changes, run `scripts/build-android.ps1` with the documented SDK/Gradle toolchain and exercise real system file/print behavior when possible. Development builds use a local development certificate; official signing material must never appear in a pull request. See [Android build](docs/android-build.md) and [signing](docs/signing.md). State whether your result was tested on a physical device, emulator or browser mock.

Keep the app local first: no account, telemetry, remote CDN, automatic document upload, or network font requests. Preserve request origin checks, bounded PDF processing, file sanitization, offline HTML output and Chinese input handling. Tests should exercise user-visible success and failure behavior, including hostile inputs.

Explain the problem, resulting behavior, scope, validation and known limitations in pull requests. Include a minimal synthetic fixture for bugs. Never submit private documents, local browser storage, tokens, machine-specific paths, or full logs containing personal data. For suspected vulnerabilities, follow [SECURITY.md](SECURITY.md).

Project code is MIT licensed. Contributions must be your own or compatible with redistribution; add upstream license texts and update THIRD_PARTY_NOTICES.md when adding dependencies or assets. Do not commit `.venv`, `node_modules`, generated packages or user documents.
