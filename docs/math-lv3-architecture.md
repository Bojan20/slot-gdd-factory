# MATH-INTEGRATION-LV3 · arhitektura

**Boki direktiva (2026-06-23 23:57):** "LV3 = potpuna integracija math
simulatora u slot gdd simulator." Math NIKAD ne sme AI (regulator
reproducibility); AI je samo *oko* math-a (PAR auto-fill, anomaly
explainer, jurisdiction auto-fix).

## Komponente (12 work items, status posle slice 3)

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
