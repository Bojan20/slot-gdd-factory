# MATH-INTEGRATION-LV3 · arhitektura

**Boki direktiva (2026-06-23 23:57):** "LV3 = potpuna integracija math
simulatora u slot gdd simulator." Math NIKAD ne sme AI (regulator
reproducibility); AI je samo *oko* math-a (PAR auto-fill, anomaly
explainer, jurisdiction auto-fix).

**2026-06-26 update:** atom count 12 → 14 (added LV3-13
auto-converge-solver + LV3-14 convergenceHud); 5 audit wave-ova
zatvoreno (UQ-LV3-QA-1..5 wave 1+2+3). Math-chain-no-AI lint
(`tools/_math-chain-no-ai-lint.mjs`) je strukturni backstop za
"math NIKAD AI" pravilo.

## Komponente (14 work items, posle UQ-LV3-QA-5 wave 1+2+3)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ slot-gdd-factory (port 5181)                                              │
│                                                                            │
│   tools/web-uploader-server.mjs                                            │
│     • drag-drop GDD/PAR → spawn ingest                                     │
│     • LV3-1: auto-spawn math-backend na boot (lazy, idempotent)            │
│     • LV3-8: GET /math-backend-status — UI badge polls every 5s            │
│                                                                            │
│   tools/math-backend-spawner.mjs   (LV3-1)                                 │
│     • ensureBackendRunning({port}) — probe + spawn ako nije up             │
│     • stopBackend() — idempotent SIGTERM                                   │
│                                                                            │
│   tools/math-backend.mjs           (LV3-A,B,11)                            │
│     • HTTP server na 9001 (autopick 9001-9010 ako busy)                    │
│     • Endpoints: /health · /sessions · /batch · /spin · /cert-pack         │
│     • LV3-11: anti-vendor sanitize svih response strings + binary path     │
│     • Session cache 30min TTL, 100 max, LRU eviction                        │
│                                                                            │
│   tools/cert-pack-export.mjs        (LV3-7)                                │
│     • Generates GLI-16 ZIP (7 files: cover / par / mc / rng / audit /     │
│       jurisdiction / manifest) sa Merkle root                              │
│     • Pure Node (deflateRawSync u zlib, custom ZIP writer)                 │
│     • Anti-vendor scrub before serialize                                    │
│                                                                            │
│   src/blocks/                                                              │
│     liveRtpHud.mjs            (LV3-4)  — top-right HUD + sparkline         │
│     backendSpinEngine.mjs     (LV3-3)  — browser fetch /spin shim          │
│     batchSimulatorPanel.mjs   (LV3-5)  — Run 10K/100K/1M/10M/100M CTAs     │
│     driftSentinel.mjs         (LV3-6)  — amber/red toast alert             │
│                                                                            │
│   src/blocks/hookBus.mjs                                                   │
│     • 4 nova whitelisted events: onLiveRtpUpdate, onDriftAlert,           │
│       onBackendSpinSampled, onBackendStatusChanged                         │
│                                                                            │
│   src/buildSlotHTML.mjs                                                    │
│     • Import + CSS + markup + runtime za sva 4 LV3 bloka                   │
│     • Runtime order: HUD → batchPanel → driftSentinel → backendEngine     │
│                                                                            │
│        ↓ HTTP (port 9001)                                                  │
│                                                                            │
│ sister-repo slot-math-engine-template (Rust)                              │
│   • mc_runtime_real binary — 341M spins/sec na M2 Max                      │
│   • 22 kernels (HW / cluster / cascade / charge / buy / …)                 │
│   • PCG64 RNG + HSM seed entropy                                            │
│   • Wire: JSON-on-stdin → JSON-on-stdout (single-batch oriented)           │
└──────────────────────────────────────────────────────────────────────────┘
```

## Request flow

```
1. Operator drag-drop GDD u uploader UI (port 5181)
   POST /ingest → web-uploader-server.mjs spawn-uje ingest.mjs child
   ingest.mjs parsuje GDD + optional PAR sheet
   buildSlotHTML.mjs generiše slot.html sa LV3 blocks (HUD/batch/sentinel/engine)
   SSE event 'done' → UI iframe učita /preview/<slug>

2. Slot.html u iframe bootuje
   liveRtpHud probe-uje http://127.0.0.1:9001/health (auto-spawned u koraku 1.5)
   backendSpinEngine probe-uje isti, generiše sessionId
   Backend status badge u UI ažurira "MATH backend: ONLINE :9001"

3. Player klikne SPIN u slot.html
   reelEngine.mjs (vanilla JS) odradi visual spin animaciju
   postSpin event fire-uje
   liveRtpHud (priority -100) ažurira measured RTP iz __LAST_SPIN_WIN__
   backendSpinEngine (priority -200) POST /spin {sessionId, model} ka 9001
   Rust kernel vrati per-spin sample iz cached batch distribucije
   backendSpinEngine OVERWRITES liveRtpHud sa real Rust payX

4. Player klikne "Run 1M" u batch panel
   batchSimulatorPanel.mjs POST /batch {spins: 1_000_000, seed, model}
   Rust mc_runtime_real radi 1M spins u ~3ms na M2 Max
   Vraća rtp / wilson_99_halfwidth / convergence_pass / spins_per_sec
   Panel prikaže "1M spins @ 342M/s · measured 96.04% · δ 4 bps · CI ±0.02%"

5. Drift sentinel kontinuirano sluša onDriftAlert
   Posle 100 spinova warmup, ako measured drift > 0.5%:
   Show toast "⚠ RTP DRIFT 0.72% — after 1247 spins"
   Auto-dismiss posle 8s, 30s cooldown per nivo

6. Operator klikne "Export GLI-16 cert pack" (TODO: dodati u UI)
   cert-pack-export.mjs build-uje ZIP iz dist/ingest/<slug>/ artifacts
   7 fajlova: cover / par_sheet / mc_results / rng_sample (90KB) /
              audit_chain (Merkle root) / jurisdiction / manifest
   Download ~94KB ZIP, regulator audituje sve hash-ove
```

## Anti-AI guardrail (regulator requirement)

| Layer            | Implementation                  | Why no AI                         |
|------------------|---------------------------------|-----------------------------------|
| Math kernel      | Rust PCG64 (deterministic)      | GLI-19/UKGC/MGA require RNG cert  |
| Spin outcome     | Rust mc_runtime_real            | NIST SP800-22 / FIPS 140-2 reqd   |
| RTP convergence  | Wilson 99% CI closed-form       | Reproducibility per regulator     |

| AI assist (NOT in spin path) | Wired in                         |
|------------------------------|----------------------------------|
| PAR auto-fill (Kimi/Opus)    | E atom self-healing parser       |
| Anomaly explainer            | HYB-3 LLM cross-check            |
| Jurisdiction auto-fix        | HYB-2 LLM field completer        |

## Endpoint reference

### math-backend (port 9001)

```
GET  /health
  → { ok: true, server: "math-backend", version, binaryPath, port, uptimeSec, sessions, pid }

GET  /sessions
  → { count, sessions: [{id, spinsServed, ageMs, measuredRtp}] }

POST /batch
  body: { spins: 10000..1e9, seed?: number, model: {payback, freeSpins?, holdAndWin?} }
  → { ok, spins, rtp, std_error, wilson_99_halfwidth, hit_rate, fs_trigger_rate,
      hnw_trigger_rate, max_win_x, cf_target_rtp, delta_bps, convergence_pass,
      wallclock_seconds, spins_per_sec, feature_breakdown }

POST /spin
  body: { sessionId, model }
  → { ok, sessionId, spinIdx, payX, isHit, fsTrigger, hnwTrigger,
      measuredRtp, measuredHitRate, targetRtp, sessionN }
```

### web-uploader (port 5181)

```
GET  /math-backend-status
  → { spawned, healthOk, port, pid, binaryPath, reason }
```

### cert-pack CLI

```
node tools/cert-pack-export.mjs --slug <SLUG> [--out <FILE.zip>]
  → writes reports/cert-pack-<slug>.zip (~94KB sa 90KB RNG sample)
```

## Ops runbook

| Symptom                              | Fix                                            |
|--------------------------------------|------------------------------------------------|
| HUD shows "OFFLINE"                  | `node tools/math-backend.mjs` manually         |
| Backend won't spawn                  | Rebuild Rust: `cargo build --release` in sister |
| 502/timeout on /spin                 | Check sessions cache, restart backend          |
| Batch panel "backend offline"        | Same as HUD OFFLINE; restart spawner            |
| Cert pack ZIP rejected by regulator  | Verify manifest.merkleRoot matches per-file sha |

## Lifecycle

- Math backend auto-spawn lazy: prvi GET /math-backend-status request
  trigeruje ensureBackendRunning() ako port 9001 prazan
- Idempotent: drugi web-uploader instance neće duplicirati backend (probe-uje
  port 9001 prvo, koristi postojeći ako live)
- Graceful shutdown: web-uploader SIGTERM → stopBackend() → SIGTERM
  child math-backend → Rust binary exit

## Performance (M2 Max measured)

- mc_runtime_real: 341M spins/sec (single-threaded), 1B+ s rayon parallel
- /batch 1M spins: ~3ms wallclock + 5ms HTTP overhead = 8ms total
- /spin per-spin: ~0.5ms (sample from cached batch, deterministic PRNG)
- /health: <1ms

## Anti-vendor compliance

- LV3-11: math-backend response sanitize-uje vendor tokens (industry standard / Pragmatic
  Play / Megaways / Cash Eruption / Wolf Run / Cleopatra / NetEnt / etc.)
- Cert pack scrub-uje cover.json, par_sheet.json, mc_results.json pre
  serializacije
- Binary path u /health vraća samo basename, ne host path/username
- **UQ-LV3-QA-5 Wave 2:** cert-pack import-uje `sanitizeObj` iz
  `src/registry/antiVendorShield.mjs` (shared registry — single source of
  truth, no more parallel VENDOR_RX drift)
- **UQ-LV3-QA-5 Wave 1:** `tools/_math-chain-no-ai-lint.mjs` strukturni
  backstop — fails CI ako bilo koji od 10 math-chain fajlova doda AI SDK
  import

## UQ-LV3-QA-5 wave summary

```
Wave 1 (9175078)  — 3 P0 dead-wire fix + AI backstop
  • liveRtpHud sets window.__MEASURED_RTP__ (probe sad real-passes)
  • backendSpinEngine emits onBackendFallback + counter
  • operator backend toggle audit log via buildAuditEntry
  • tools/_math-chain-no-ai-lint.mjs (10 files swept, 0 hits)

Wave 2 (eb29958)  — cert-pack runtime consume + per-jur PASS/FAIL
  • buildCertPack accepts opts.fallbackCount/operatorToggleLog/solverHistory
  • mc_results.runtime block populated when caller supplies signals
  • jurisdiction.<row>.floorPassed + jurisdiction.verdict propagation
  • cover.seedProvenance documents derivation rule + HSM vendor + entropy
  • GET /cert-pack/<slug> route na uploader-server
  • buildCertPack returns parsed bodies dictionary (ZIP stays canonical)

Wave 3 (this commit) — endpoint round-trip + lifecycle hardening
  • roundId dedup u backendSpinEngine → liveRtpHud (no 2× sample inflation)
  • uncaughtException + unhandledRejection + SIGHUP + SIGQUIT cleanup
  • UI cert-pack download button (next to "open slot in new tab")
  • docs/math-lv3-architecture.md sync (12 → 14 atom + Wave 2/3 ref)
```

## Endpoint reference (uploader-server)

| Method | Path | Purpose |
|:--|:--|:--|
| GET | `/` | Main UI (web-uploader-ui.html) |
| GET | `/status` | Server health + session count |
| GET | `/math-backend-status` | Backend live + port + version |
| POST | `/backend-mode` | Operator toggle backend on/off (LV3-8, Wave 1 audit) |
| GET | `/cert-pack/<slug>` | Stream GLI-16 ZIP (Wave 2/3) |
| POST | `/ingest` | Multipart upload, returns sessionId + SSE |
| GET | `/events/<sessionId>` | SSE progress stream |
| GET | `/preview/<slug>` | Serve built slot.html |
| GET | `/report/<slug>` | V8+V9+PAR+healing receipts JSON |

## __SOLVER_STATE__ contract (LV3-14 convergenceHud feed)

`convergenceHud` polls `window.__SOLVER_STATE__` every N ms (default 250).
Producer side is the auto-converge solver (Node-side); operator pushes
state to browser via SSE channel that the uploader emits during
`solveRtp()`. Wave 3 ships the consumer.

> **⚠️ OPERATOR NOTICE (UQ-LV3-QA-6-C #2, #6 · 2026-06-26):** the
> producer for `__SOLVER_STATE__` is NOT WIRED in this commit. No code
> writes the global today. `convergenceHud` will display **IDLE** for
> the entire demo on a regulator workstation until Wave 4 ships the SSE
> producer (`/solver-events` SSE on the uploader + ingest pipeline calls
> `solveRtp` + writes `dist/ingest/<slug>/solver-history.jsonl`). This is
> a known gap — do NOT demo convergence-hud iteration progress until
> the producer lands.

Schema (when present — Wave 4 producer MUST emit ALL these fields):
```json
{
  "iter": 7,
  "residual": 1.2e-4,
  "deltaBps": 23,
  "finalRtp": 0.9587,
  "targetRtp": 0.96,
  "converged": false
}
```

`targetRtp` is REQUIRED (UQ-LV3-QA-6-B #18) so convergenceHud's
fallback delta computation `(finalRtp - targetRtp) * 10000` doesn't
return NaN. If the producer omits it, the consumer should fall back to
`window.__LIVE_RTP_TARGET__` (already set by liveRtpHud).

## RNG sample provenance (UQ-LV3-QA-6-C #3)

The `rng_sample.bin` entry in the cert pack is currently a
DETERMINISTIC keystream derived from `slug + certVersion + targetRtp`
via SHA-256 — see `cover.seedProvenance.seedRule`. This is a
**reproducibility-fingerprint** suitable for regression testing, NOT a
regulator-binding PCG64 sample suitable for GLI-16 §3.2.4. A regulator
inspector reading `cover.seedProvenance.hsmVendor === "derived-
deterministic"` will mark the pack as **NON-BINDING** until the sister
Rust binary (`mc_runtime_real`) exposes a `/rng-sample?bytes=N&seed=S`
endpoint that streams the actual PCG64 keystream. Wave 4 sister-repo
work.

## End-to-end demo flow status (post UQ-LV3-QA-5/6)

| Demo step | Wired today? | Wave 4 blocker? |
|:--|:-:|:-:|
| Drop GDD → ingest | ✅ | — |
| Backend auto-spawn (LV3-1) | ✅ | — |
| Operator backend toggle (LV3-8) | ✅ | — |
| liveRtpHud shows measured RTP | ✅ | — |
| convergenceHud shows iteration progress | ❌ idle | Wave 4: SSE producer + ingest wire to solveRtp |
| driftSentinel ±0.05% guard | ✅ | — |
| backendSpinEngine /spin per click | ✅ | — |
| Cert-pack ZIP download (UI button) | ✅ | — |
| solverIterCount populated in mc_results | ❌ 0 | Wave 4: ingest wire to solveRtp |
| rng_sample.bin regulator-binding | ❌ fingerprint | Wave 4: sister-rust-server PCG64 endpoint |
| Operator toggle audit in cert-pack | ✅ | — |
| Per-jurisdiction PASS/FAIL stamp | ✅ | — |
