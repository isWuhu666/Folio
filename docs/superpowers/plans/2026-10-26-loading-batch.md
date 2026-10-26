# Loading and Batch Conversion Implementation Plan

**Goal:** Improve local loading and allow bounded multi-document conversion with independent results.
**Architecture:** Independent batch UI and scheduler reuse existing validators, renderer, MathJax and PDF job API. Existing editor remains isolated. Desktop PDF workers and resource readers have explicit concurrency/memory bounds.
**Tech Stack:** Existing JavaScript modules, Python local HTTP server, Playwright, unittest; no new runtime dependency.
**Spec:** ../specs/2026-10-26-loading-batch-design.md

- [x] Measure baseline startup requests/readiness and repeated resource work.
- [x] Add failing regression tests for static revalidation and concurrent isolated PDF jobs; implement backend limits and shutdown/cancel semantics.
- [x] Add failing tests for bounded resource concurrency, stable ordering, re-use, no-math queue and lazy platform import; optimize shared modules.
- [x] Add failing batch tests: two independent outputs, actual overlapping work, resource path handling, cancellation, failure isolation, settings capture, and review gating.
- [x] Implement batch scheduler/converter/UI, bounded retained results, per-item downloads and combined ZIP; preserve editor state.
- [x] Verify laptop/mobile rendering, offline exports, before/after measurements and existing Python/browser suites.
- [ ] Independent review, resolve findings, document practical limits, publish PR; verify exact commit CI and merged main checks before claiming completion.
