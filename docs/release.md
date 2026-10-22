# Windows release workflow

The portable app targets Windows x64. Build on Windows with Python 3.14 x64 and Node.js 24. No Python or Node installation is required to run the resulting package; a modern Edge/Chrome browser is still required.

```powershell
py -3.14 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt -r requirements-build.txt
npm.cmd ci
npm.cmd run prepare:vendor
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/build-release.ps1
```

The script builds `dist/Folio/Folio.exe`, runs health/local-assets/text-and-facsimile-PDF/paged-job-progress/reuse/shutdown smoke checks from an unrelated temporary working directory, and creates `dist/Folio-1.2.0-windows-x64.zip` plus its SHA-256 file. The zip includes the complete `Folio` folder, Python runtime, native PDF/image/crypto libraries, browser vendor files, examples and dependency license material. Keep the folder together. `--no-browser --no-tray --port 8767` supports unattended checks; `--stop --port 8767` stops the matching desktop instance.

Double-click Folio.exe to open the browser. The notification area menu provides open, service status, restart and exit. Closing the browser keeps the service running. Login startup is **opt in**, configured through the tray checkbox for the current user. Extract to a stable directory before enabling it. Moving/removing the package requires disabling/updating the startup entry. Existing source startup remains supported by `scripts/startup.ps1`; it does not silently migrate to a portable package.

Packaged runtime logs/control state are written beneath `%LOCALAPPDATA%\Folio`, outside the bundle. Source runs retain `artifacts/desktop-PORT.*`. The control state contains a local shutdown token: do not share it. `--pdf-worker` is an internal subprocess command and dispatches before logs, tray or browser initialization.

Before a public release: run backend and browser suites, inspect desktop/mobile screenshots, inspect license material and package contents, and test a freshly extracted archive on a clean Windows machine without Python/Node or internet access. Record exact versions and checks. A development machine package smoke does not establish clean-machine compatibility. Sign binaries when a publisher signing process is available; this project currently has no code signing setup. Do not label artifacts signed or independently security certified.

GitHub Actions builds/test-checks pull requests and attaches the portable artifact. Tag pushes matching `v*` also build the artifact. Maintainers must review checks and attach the archive/checksum to a GitHub Release manually; this workflow does not publish releases. The version in desktop.py, Folio.spec/build archive name, and release notes must agree before tagging.
