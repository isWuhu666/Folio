# SDD ledger — plan: docs/superpowers/plans/2026-10-16-markdown-pdf-html.md

Execution: native, approved by user; baseline 0905308, branch codex/folio-converter.
Ruling: Use the approved, new Folio checkout on a feature branch without an additional worktree — this repository contains only this project's approved documents, with no preexisting product changes — cost if wrong: no extra checkout-level isolation, but BikeCast remains outside the repository.
Pre-flight: Task 2→3→6 shares DocumentDraft/Model and options; signatures consistent.
Pre-flight: Task 4→5→6 shares PdfResult; signatures consistent.
Pre-flight: Task 1→4 shares limits/HTTP lifecycle; consistent.
Task 1: RED — unittest could not import folio.http_server before implementation.
Task 1: complete — HTTP tests 4/4 PASS; local dependencies installed and locked; vendor preparation verified. Task 2: RED — four browser tests fail because converter modules do not yet exist.
Task 2: complete — browser Markdown/resources 4/4 PASS. Task 3: RED — math/export module import failures observed before implementation. Ruling: browser tests reuse the local test server because Windows sandbox process-tree cleanup hangs; final verification will restart it explicitly to avoid stale Python imports — cost: development test server lifecycle is managed during verification.
Task 3: complete — browser suite 6/6 PASS, including offline file opening and bad TeX diagnostics. Task 4: RED — conversion imports and HTTP 501 assertions failed before implementation; timeout recovery race reproduced.
Task 4: complete — Python suite 9/9 PASS, including real worker timeout, recovery, DPI, rotation, scans, limits, and mixed page sizes. Task 5: RED — pdf_reading module missing before implementation.
Task 5: complete — Python suite 11/11 PASS; original collapsed text layer intentionally retained in addition to reconstructed text. Task 6: browser workspace tests written before UI implementation.
Task 6: complete — browser suite 9/9 PASS; editing, themes, downloads, failed PDF replacement and mobile layout tested. First screenshot was captured during iframe navigation; Task 7 will wait for frame content and inspect finished rendering.
Task 7: complete — Python 13/13 PASS; Edge browser 16/16 PASS; pip check clean; install.ps1 replay complete offline; visual/Poppler checks complete. Ruling: serialize frontend PDF requests instead of AbortController — aborting the client does not stop the worker and caused 503 during mode switches — cost: latest PDF operation waits for the current one to finish or time out. Final whole-branch review pending.
Final: Ruling: Regraded heading suffix collisions as Important — duplicate IDs violate the explicit unique-anchor contract and send the table of contents to the wrong section — cost if wrong: one additional targeted regression fix beyond the original Minor grade.
Final: fixed currency/code/formula interaction — currency prefix regression RED→GREEN, full suite 15 Python + 19 browser PASS.
Final: fixed literal-percent filename mapping — filename regression RED→GREEN, full suite PASS.
Final: fixed cropped PDF coordinates — geometry guard/text-layer and reading fallback regressions RED→GREEN, full suite PASS.
Final: fixed ordinary-font superscripts — cross-row neighbour detection regression RED→GREEN, full suite PASS.
Final: fixed heading ID collision — global generated-ID occupancy regression RED→GREEN, full suite PASS.
Final review: one independent whole-branch review; no declined items and no deferred reported findings. Fixes verified without a second review.
Delivery: local checkout retained on codex/folio-converter; no merge, push, publish or PR requested. Runtime 127.0.0.1:8765 health verified.
