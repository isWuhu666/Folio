# Windows release validation — 2026-10-22

The locally built Folio 1.1.0 Windows x64 archive is available at `dist/Folio-1.1.0-windows-x64.zip`.

- Size: **56,219,119 bytes** (approximately 53.6 MiB).
- SHA-256: `75b0cd93b76e16d5819c1f1c0b07370aad3c02414d4547d07863b88616c32620`.
- Build environment: Windows 11 x64, Python 3.14.4, PyInstaller 6.22.3, pystray 0.19.5; Python SSL runtime reports OpenSSL 3.0.19.
- The archive is unsigned. It has not been validated on a clean virtual machine or certified by an independent security assessment. Nothing was pushed or published remotely.

## Evidence

Release-owned behavior tests passed: 3 desktop lifecycle tests, 3 startup tests and 3 frozen-entry/runtime/tray tests. The root integration run additionally reported 43/43 Python and 47/47 browser tests passing.

The package was extracted to a newly created directory. The extracted executable passed health, bundled MathJax/font and new project/output/job/history module requests, reading/faithful PDF conversion, asynchronous selected-page conversion with real completed/total progress, repeated-open reuse and authenticated shutdown. It ran from an unrelated working directory with browser/tray UI disabled for unattended checks.

The extracted executable then owned port 8782 (its process remained alive and its health instance was verified before the browser runner). `tests/product.spec.mjs` passed **13/13** tests in 23.0 seconds against that already-running executable. The source test server did not start. The test service was stopped and the closed port was independently checked. The runner's final console print encountered a GBK encoding error after saving the passing browser log; this did not affect browser tests or shutdown. A follow-up check confirmed the passing log, closed port and archive checksum.

A subsequent documentation-only archive correction added the README-linked historical upgrade/security documents. ZIP CRC checks passed; all **1,264 web/example resource files** matched the final source by SHA-256, and the final archived executable matched the browser-tested extracted executable by SHA-256. Every relative Markdown link in the packaged README resolved to an archived file.

Detailed local evidence (generated, ignored by Git):

- `artifacts/release-artifact.json`
- `artifacts/release-extracted-smoke.log`
- `artifacts/release-browser-smoke.log`
- `artifacts/python-dependency-audit-final.json`

The advisory check queried public OSV metadata for 11 pinned runtime/desktop/build packages and returned zero matches at check time. This covers those package/version queries, not every interpreter/native transitive component or unknown vulnerability. Frontend advisory and broader integration evidence are maintained by the root verification record.

## Redistribution material and limits

The bundle retains browser vendor license texts, Python package license metadata, PDFium's per-library notices, Pillow/cryptography licenses, CPython and PyInstaller license texts, and OpenSSL's official Apache license. pystray's LGPL texts and replaceable plain Python source are retained. Folio's root MIT license covers project code; upstream components retain their own terms. Review component versions and notices again when changing the interpreter or dependencies.

Native notification-area open/status/restart/exit and opt-in startup are implemented. Startup shortcut tests use a disposable directory rather than modifying the user's real Startup folder. Native menu callbacks are covered with a backend test; a human click-through of every tray command and login-after-reboot behavior remains a release-machine check.

Remaining release-machine work: clean Windows machine without Python/Node and with internet disconnected, publisher signing/SmartScreen process, actual login/reboot startup behavior, and configuring a real repository private security-report channel. Development-machine package/browser smoke does not substitute for those checks.
