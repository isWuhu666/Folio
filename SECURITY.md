# Security policy

This repository currently maintains the latest source tree and its latest release. Older snapshots may lack security fixes. There is no guaranteed response SLA.

For suspected vulnerabilities, use the repository's **Security → Report a vulnerability** private reporting channel when enabled. If the repository does not offer that channel, ask maintainers in a public issue to provide a private contact, without posting exploit details, documents, tokens or logs. A dedicated maintainer address has not yet been designated.

Describe the affected revision/package, platform, impact, reproduction using synthetic data, and any suggested mitigation. Please allow maintainers to assess the issue before public disclosure.

Folio listens on the local loopback interface. It does not intentionally upload documents. Browser storage, exported projects, PDFs and HTML remain sensitive local files and are not encrypted by the app. Other software running as the same user may access them. Local-only operation is not a sandbox or a guarantee that arbitrary PDFs are harmless. PDF conversion uses separate bounded worker processes, but relies on third-party native parsers. Update dependencies and avoid untrusted inputs when possible.

The Windows portable archive is currently unsigned. A SHA-256 checksum detects changes relative to a trusted checksum; it does not establish publisher identity. No clean virtual machine or penetration-test certification is claimed. See THIRD_PARTY_NOTICES.md for dependencies and docs/release.md for validation scope.

PDF jobs temporarily store the uploaded PDF and generated result in a private temporary directory on this machine. Normal completion/expiry/cancellation and service cleanup remove these files; up to four job results are retained, each bounded at 128 MiB, for approximately ten minutes of inactivity. A crash or forced termination can leave temporary files behind; automatic cleanup across subsequent runs is not guaranteed. System temporary storage and browser storage must be included in handling sensitive documents.
