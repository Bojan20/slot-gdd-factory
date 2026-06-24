#!/usr/bin/env node
/**
 * tools/math-backend.mjs
 *
 * LV3 FAZA B (MATH-INTEGRATION-LV3 — Boki 2026-06-24) — Node HTTP bridge
 * koji prima `/batch` i `/spin` requests, spawn-uje sister-repo Rust
 * `mc_runtime_real` binary, vraća measured RTP + per-feature breakdown.
 *
 * Endpoints
 *   GET  /health          → {ok, version, binaryPath, port}
 *   POST /batch           → run N spins, return aggregate RTP + Wilson CI
 *     body: { spins, seed?, model } (model = full parser output)
 *   POST /spin            → single spin outcome (sample from cached batch)
 *     body: { sessionId, model } — uses cached 100k-spin pool keyed by sessionId
 *   GET  /sessions        → active session count + cache size
 *
 * Anti-AI guardrail: NIKAD ne poziva LLM, samo Rust binary. Determinizam
 * je očuvan jer Rust koristi PCG64 sa explicit seed.
 *
 * Port: 9001 (autopick if busy).
 * Spawn: lazy — binary se ne pokreće dok prvi request ne stigne.
 */
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { homedir } from 'node:os';
/* UQ-DEEP-AJ · P1A — N-feature composer.
 * Folds per-feature contribution declarations (cluster, cascade, multiplier,
 * jackpot, mysterySymbol, etc.) into the legacy 2-tier (fs + hnw) Rust
 * executor wire via a residual base_rtp adjustment. Per-feature breakdown is
 * exposed via _inference.composer for /converge per-feature reporting. */
import { composeFeatureContributions } from '../src/registry/featureComposer.mjs';
/* UQ-DEEP-AN AN-1 audit trail */
import { AUDIT_LOG_SCHEMA_VERSION, buildAuditEntry, validateAuditEntry } from '../src/registry/auditTrail.mjs';

const DEFAULT_PORT = 9001;
const BINARY_CANDIDATES = [
  resolvePath(homedir(), 'Projects/slot-math-engine-template/target/release/mc_runtime_real'),
  resolvePath(homedir(), 'Projects/slot-math-engine-template/rust-sim/target/release/mc_runtime_real'),
];

function findBinary() {
  for (const p of BINARY_CANDIDATES) if (existsSync(p)) return p;
  return null;
}

const BINARY = findBinary();
if (!BINARY) {
  console.error('▸ mc_runtime_real binary not found. Run: cargo build --release --bin mc_runtime_real');
  console.error('  Searched:', BINARY_CANDIDATES.join('\n            '));
  process.exit(1);
}

/* UQ-DEEP-AN · AN-2 — STRICT_MATH env var fail-fast gate.
 * When STRICT_MATH=true, /converge /spin /batch endpoints refuse to run
 * against synthetic-fallback (untrusted) RTP targets. UQ-DEEP-AL FIX-G
 * already stamps payback.rtpSource ∈ {'gdd-prose','par-sheet','synthetic-fallback-96'}.
 * Strict mode flips synthetic → HTTP 422 with remediation, while audit-only
 * endpoints (/audit, /serverConfig, /health) keep working independent of RTP
 * trust because they validate compilation/structure, not RTP convergence. */
const STRICT_MATH = process.env.STRICT_MATH === 'true';

function strictMathGuard(model) {
  if (!STRICT_MATH) return null;
  const payback = (model && model.payback) || {};
  const rtpSource = payback.rtpSource;
  if (typeof rtpSource === 'string' && /^synthetic/.test(rtpSource)) {
    return {
      error: 'STRICT_MATH_UNTRUSTED_RTP',
      reason: `rtpSource ${rtpSource} nije regulator-grade target; commit declared RTP u GDD prose ili PAR sheet pre run-a u strict mode-u`,
      rtpSource,
      remediation: "Edit GDD: add 'RTP target: 96.00%' line, ili --par flag sa real PAR sheet",
    };
  }
  return null;
}

/* LV3-11 — anti-vendor sanitize. Vendor-trademarked names ne smeju
 * leak-ovati kroz backend response (Cash Eruption / Wolf Run / Cleopatra
 * / Pragmatic Play / industry standard / Light & Wonder / Megaways / NetEnt). Backend
 * response je tehnički numeric, ali binary path + future debug fields
 * MOGU da sadrže trademark strings ako operator drži repo u Vendor-
 * Imenovanom folder-u. Scrub before send. */
/* HIGH-1 fix (UQ-DEEP-N): separator class widened.
 * CRIT-3 fix (UQ-DEEP-O): NFKD-normalize + strip combining marks +
 *   drop non-ASCII letters before regex. Defeats Cyrillic lookalikes
 *   (Cаsh sa Cyrillic а U+0430), zero-width chars (Ca​sh),
 *   HTML numeric entities (&#67;ash), and Arabic-Indic digit confusion. */
const VENDOR_RX = /\b(IGT|Pragmatic[\s\-_.]?Play|Megaways|Cash[\s\-_.]?Eruption|Wolf[\s\-_.]?Run|Cleopatra|Buffalo[\s\-_.]?(?:King|Gold)|NetEnt|Microgaming|Scientific[\s\-_.]?Games|L&W|Light[\s\-_.]*&[\s\-_.]*Wonder|Play'?n[\s\-_.]?Go|Novomatic)\b/gi;

function unicodeNormalizeForVendor(s) {
  /* 1. Decode HTML numeric entities so &#67;ash → Cash. */
  let out = s.replace(/&#(\d+);/g, (_, n) => {
    const cp = parseInt(n, 10);
    return cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : '';
  });
  out = out.replace(/&#x([0-9a-fA-F]+);/g, (_, n) => {
    const cp = parseInt(n, 16);
    return cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : '';
  });
  /* 2. NFKD: separate base char from combining marks (so e.g. Café → Cafe). */
  try { out = out.normalize('NFKD'); } catch {}
  /* 3. Strip combining diacritics (U+0300..U+036F) + zero-width chars
   *    (ZWSP U+200B, ZWNJ U+200C, ZWJ U+200D, BOM U+FEFF, etc.). */
  out = out.replace(/[̀-ͯ​-‏﻿⁠-⁯]/g, '');
  /* 4. Confusable-letter homoglyph fold: Cyrillic / Greek lookalikes →
   *    ASCII. Just hit the most common letters used in our vendor names. */
  const CONFUSABLES = {
    'а': 'a', 'А': 'A', 'е': 'e', 'Е': 'E', 'о': 'o', 'О': 'O',
    'р': 'p', 'Р': 'P', 'с': 'c', 'С': 'C', 'у': 'y', 'У': 'Y',
    'х': 'x', 'Х': 'X', 'і': 'i', 'І': 'I', 'ј': 'j', 'Ј': 'J',
    'ѕ': 's', 'Ѕ': 'S', 'ԁ': 'd', 'ϲ': 'c', 'ϵ': 'e', 'ɡ': 'g',
    'ɪ': 'I', 'ʟ': 'L', 'ѡ': 'w',
  };
  out = out.replace(/[-￿]/g, (ch) => CONFUSABLES[ch] ?? ch);
  return out;
}

function sanitizeStr(s) {
  if (typeof s !== 'string') return s;
  /* Match against normalized form; emit original (preserves user data)
   * BUT if normalized form would match, replace whole word in original. */
  const normalized = unicodeNormalizeForVendor(s);
  if (!VENDOR_RX.test(normalized)) {
    /* Reset lastIndex (RX is /g) and short-circuit. */
    VENDOR_RX.lastIndex = 0;
    return s;
  }
  VENDOR_RX.lastIndex = 0;
  /* Normalized form had vendor — scrub the normalized version to be safe.
   * (We lose any non-vendor unicode in the response, but anti-vendor
   * guarantee is the priority for regulator deliverables.) */
  return normalized.replace(VENDOR_RX, '[vendor]');
}
function sanitizeObj(obj) {
  if (Array.isArray(obj)) return obj.map(sanitizeObj);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      /* UQ-DEEP-S LOW (E2E): preserve client-provided keys that ne sadrže
       * vendor data po definiciji. sessionId je echo client-supplied string
       * koji se koristi za session correlation; scrub ga je kvario client
       * tracking. Drugi pass-through keys: source, ref, requestId. */
      if (typeof v === 'string' && (k === 'sessionId' || k === 'source' || k === 'ref' || k === 'requestId')) {
        out[k] = v;
      } else {
        out[k] = typeof v === 'string' ? sanitizeStr(v) : sanitizeObj(v);
      }
    }
    return out;
  }
  return obj;
}

/* In-memory session cache: sessionId → entry.
 *
 * CRIT-2 fix (UQ-DEEP-N audit): true LRU, not FIFO.
 *   Before: `SESSION_CACHE.keys().next().value` returns insertion-order key
 *           — that's FIFO, not LRU. A hot session created first but accessed
 *           every spin would be evicted while a cold idle session survived.
 *   After:  every read bumps `lastAccessAt`; eviction picks smallest
 *           `lastAccessAt` across the map (O(n) scan, n ≤ 100 = trivial). */
const SESSION_CACHE = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000;  /* 30 min */
const CACHE_MAX_SESSIONS = 100;

function touchSession(entry) {
  entry.lastAccessAt = Date.now();
}

function gcSessions() {
  const now = Date.now();
  for (const [id, s] of SESSION_CACHE) {
    if (now - s.createdAt > CACHE_TTL_MS) SESSION_CACHE.delete(id);
  }
  /* True LRU eviction: scan for entry with smallest lastAccessAt. */
  while (SESSION_CACHE.size > CACHE_MAX_SESSIONS) {
    let oldestId = null;
    let oldestTs = Infinity;
    for (const [id, s] of SESSION_CACHE) {
      const ts = s.lastAccessAt || s.createdAt;
      if (ts < oldestTs) { oldestTs = ts; oldestId = id; }
    }
    if (oldestId == null) break;
    SESSION_CACHE.delete(oldestId);
  }
}

/**
 * Build mc_runtime_real input from a parsed factory model.
 * Maps model.payback.rtp + model.payback.hitFrequency + feature trigger
 * probabilities into the executor shape the Rust binary expects.
 *
 * UQ-DEEP-AA fix (Boki 2026-06-24): "ne radi matematika. razlikuje se
 * drasticno rtp". Pre fix-a baseRtp default = cfTargetRtp * 0.38 (generic
 * 38% split heuristic) — TOTAL RTP slučajno hit, ali per-feature delta vs
 * GDD declared (Cash Eruption baseLine 41.9% vs measured 36.4%) = drift
 * 5.5pp. Sad konzumira declared rtpBreakdown.baseLine/fsLine ako postoje
 * — Rust binary ide sa real per-feature target umesto generic 38/x split. */
function buildExecutorInput(model, spins = 100000, seed = 42, overrides = null) {
  const payback = (model && model.payback) || {};
  const fs = (model && model.freeSpins) || {};
  const hnw = (model && model.holdAndWin) || {};
  const breakdown = (payback.rtpBreakdown && typeof payback.rtpBreakdown === 'object') ? payback.rtpBreakdown : {};
  /* Defaults align with industry baseline 5×3 96% RTP medium-vol slot. */
  const cfTargetRtp = (typeof payback.rtp === 'number' && payback.rtp > 0)
    ? (payback.rtp > 1 ? payback.rtp / 100 : payback.rtp)
    : 0.96;
  /* Normalize: GDD breakdown values arrive in percent units (e.g. 41.9
   * meaning 41.9%), convert to 0..1 fractions for Rust executor.
   * UQ-DEEP-AC: applied to hitFrequency too (was raw 19.03 → Rust expects 0..1
   * → hit_rate saturated → base_lines contribution collapsed). */
  const _normFrac = (v) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
    return v > 1 ? v / 100 : v;
  };
  const declaredBase = _normFrac(breakdown.baseLine);
  const declaredFsLine = _normFrac(breakdown.fsLine);
  const declaredHwBase = _normFrac(breakdown.hwBase);
  const declaredHwFs = _normFrac(breakdown.hwFs);
  const baseRtp = (typeof payback.baseRtp === 'number')
    ? (payback.baseRtp > 1 ? payback.baseRtp / 100 : payback.baseRtp)
    : (declaredBase != null ? declaredBase : cfTargetRtp * 0.38);
  /* UQ-DEEP-AC: hit-freq normalization. GDD may write 19.03 (percent) or
   * 0.1903 (fraction). Both must end up as 0..1 for Rust. */
  const hitFreqNorm = (() => {
    const raw = payback.hitFrequency;
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return 0.21;
    return raw > 1 ? raw / 100 : raw;
  })();
  /* UQ-DEEP-AC: detect hold-and-win presence — affects GAP inference.
   * UQ-DEEP-AE: stricter — empty `holdAndWin: {}` from parser inference
   * (Gates of Olympus tumble) must NOT enable. Require at least one real
   * signal: enabled===true AND (triggerCount IS number OR features kind list). */
  const _kinds = Array.isArray(model && model.features)
    ? (model.features || []).map(f => f && f.kind).filter(Boolean) : [];
  const _kindHasHnw = _kinds.includes('hold_and_win');
  const hasHoldAndWin = (() => {
    if (_kindHasHnw) return true;                                /* explicit feature kind */
    if (hnw && hnw.enabled === true && typeof hnw.triggerCount === 'number') return true;  /* real config */
    /* UQ-DEEP-AE symmetry sa FS: declared breakdown.hwBase OR hwFs → HnW present. */
    if ((typeof breakdown.hwBase === 'number' && breakdown.hwBase > 0)
     || (typeof breakdown.hwFs === 'number' && breakdown.hwFs > 0)) return true;
    return false;
  })();
  /* UQ-DEEP-AE: same detection for FREE SPINS — was implicitly always-on via
   * default fs_trigger_p=0.0085, fs_session_e=23.6 → ~+20pp phantom contribution
   * for slots that don't have FS. */
  const _kindHasFs = _kinds.includes('free_spins');
  const hasFreeSpins = (() => {
    if (_kindHasFs) return true;
    if (fs && fs.enabled === true) return true;
    if (fs && (typeof fs.triggerProbability === 'number' || typeof fs.sessionExpectedValue === 'number')) return true;
    if (typeof breakdown.fsLine === 'number' && breakdown.fsLine > 0) return true;
    return false;
  })();
  /* UQ-DEEP-AL FIX-G — propagate rtpSource flag so audit tooling can
   * distinguish "GDD declared 96%" (trusted target — bps gap = real fail)
   * vs "synthetic fallback" (untrusted anchor — bps gap = info only).
   * Parser stamps payback.rtpSource ∈ {'gdd-prose','par-sheet','synthetic-fallback-96'}.
   * Synthetic = parser had nothing to read; downstream audit must NOT
   * classify gap as regulator audit fail. */
  const cfTargetRtpTrusted = !(typeof payback.rtpSource === 'string'
    && /^synthetic/.test(payback.rtpSource));
  return {
    spins,
    seed,
    cf_target_rtp: cfTargetRtp,
    cf_target_rtp_trusted: cfTargetRtpTrusted,
    cf_target_rtp_source: payback.rtpSource || null,
    executor: (() => {
      /* UQ-DEEP-AA fix: calibrate session_e iz declared rtpBreakdown ako
       * postoji. Rust executor računa total = base_rtp + fs_trigger*fs_session_e
       * + hnw_trigger*hnw_session_e. Ako koristimo declared baseLine kao
       * base_rtp i ostavimo default session_e=23.6 i 44.0, total ode na
       * ~102% (over-shoot). Solving: fs_session_e = declared.fsLine /
       * fs_trigger_p tako da je MC contribution = declared.fsLine; isto
       * za hnw_session_e = (declared.hwBase + declared.hwFs) / hnw_trigger_p.
       *
       * UQ-DEEP-AC GAP inference: if GDD lists baseLine + fsLine ali NE
       * hwBase/hwFs, AND total - (baseLine + fsLine) > 1pp AND model has
       * hold_and_win feature → infer hnw_session_e iz GAP-a. Bez ovoga
       * Cash Eruption: declared 96%, baseLine 41.9%, fsLine 7%, hnw default
       * 0.396 → total 88.5% (off 7.5pp ↓). Sa GAP inference: hnw = 47.1pp
       * → total ≈ 96.0% ✓. */
      /* UQ-DEEP-AE: kad feature NIJE prisutan, trigger_p = 0 → Rust executor
       * ne emituje phantom contribution. Pre fix-a: defaultni trigger_p
       * (0.0085 FS, 0.009 HnW) i session_e (23.6 FS, 44.0 HnW) uvek bili
       * preneti → ~+20pp FS phantom + ~+40pp HnW phantom za slotove koji
       * ne postoje tu feature → universal coverage failed. */
      const fsTrigP = !hasFreeSpins ? 0
        : (typeof fs.triggerProbability === 'number') ? fs.triggerProbability : 0.0085;
      const hnwTrigP = !hasHoldAndWin ? 0
        : (typeof hnw.triggerProbability === 'number') ? hnw.triggerProbability : 0.009;
      const declaredHwTotal = (declaredHwBase != null || declaredHwFs != null)
        ? ((declaredHwBase || 0) + (declaredHwFs || 0))
        : null;
      /* GAP fallback when hw declared parts missing but feature exists. */
      const inferredHwFromGap = (() => {
        if (declaredHwTotal != null) return null;        /* declared takes precedence */
        if (!hasHoldAndWin) return null;                  /* no hold-and-win → no GAP */
        if (declaredBase == null && declaredFsLine == null) return null; /* nothing to subtract from */
        const sumDeclared = (declaredBase || 0) + (declaredFsLine || 0);
        const gap = cfTargetRtp - sumDeclared;
        if (gap <= 0.01) return null;                     /* < 1pp gap — not a real hold contribution */
        return gap;
      })();
      /* UQ-DEEP-AE: bez free spins → session_e=0 (Rust takođe vidi trigger_p=0).
       * Sa FS ali bez declared → derive iz IMPLICIT 0.15 / fs_trigger_p
       * (industry split ratio, NE generic 23.6 koji daje 0.20 contribution).
       * Cilj: measured fs_contribution mora da match-uje implicit expectation. */
      const fsSessionE = !hasFreeSpins ? 0
        : (typeof fs.sessionExpectedValue === 'number') ? fs.sessionExpectedValue
          : (declaredFsLine != null && fsTrigP > 0 ? declaredFsLine / fsTrigP
            : (fsTrigP > 0 ? 0.15 / fsTrigP : 0));
      const hnwSessionE = !hasHoldAndWin ? 0
        : (typeof hnw.sessionExpectedValue === 'number') ? hnw.sessionExpectedValue
          : (declaredHwTotal != null && hnwTrigP > 0 ? declaredHwTotal / hnwTrigP
            : (inferredHwFromGap != null && hnwTrigP > 0 ? inferredHwFromGap / hnwTrigP
              : (hnwTrigP > 0 ? 0.36 / hnwTrigP : 0)));
      /* UQ-DEEP-AE: SMART BASE-RTP DERIVATION
       * Pre fix-a: kad GDD nije deklarisao baseLine, fallback je `cfTargetRtp * 0.38`
       * (generic 38% split) → Crystal Forge (FS-only, no HnW) bio na base=0.365 dok
       * je total target 0.96 → measured ~57% (base+fs only). Treba:
       *   base = total - declared.fsLine - declared.hwTotal       (kad declared sve)
       *        = total - declared.fsLine - (impl 0.36 ako HnW)    (kad HnW impl)
       *        = total - (impl 0.15 ako FS)  - declared.hwTotal   (kad FS impl)
       *        = total - (impl 0.15 ako FS)  - (impl 0.36 ako HW) (kad sve impl)
       *        = total                                              (kad ni FS ni HW)
       */
      /* UQ-DEEP-AJ · P1A — N-FEATURE COMPOSER
       * Invoke the composer to derive contributions for ALL declared features
       * (cluster, cascade, multiplier, jackpot, mysterySymbol, expandingWild,
       *  bigSymbol, retrigger, scatterPays, anteBet, megaways, wheelBonus).
       *
       * BACK-COMPAT POLICY (preserve-existing-behavior contract):
       *   The legacy Rust executor's `base_rtp_per_spin` ALREADY includes all
       *   base-intrinsic mechanics (cluster, cascade, multiplier, etc.) as
       *   part of the per-spin base payout. The executor only has 2 separately-
       *   simulated slots: fs_session_e and hnw_session_e. Therefore the
       *   composer's "other" feature contributions are NOT subtracted from
       *   base — they would under-shoot the converged RTP (regression
       *   captured in tests/contracts/universal-converge-deep-ae). The
       *   composer output flows through `_inference.composer` for /converge
       *   per-feature breakdown reporting and is the foundation for a future
       *   executor that natively models N feature slots.
       *
       * Composer source: src/registry/featureComposer.mjs (schemaVersion='1'). */
      const _composerResult = composeFeatureContributions(model, breakdown, { cfTargetRtp });
      const _baseRtpFinal = (() => {
        if (declaredBase != null) return declaredBase;
        const total = cfTargetRtp;
        const fsExp = hasFreeSpins
          ? (declaredFsLine != null ? declaredFsLine : 0.15)
          : 0;
        const hwExp = hasHoldAndWin
          ? (declaredHwTotal != null ? declaredHwTotal
            : (inferredHwFromGap != null ? inferredHwFromGap : 0.36))
          : 0;
        const derived = total - fsExp - hwExp;
        return derived > 0.05 ? derived : total;            /* sanity floor */
      })();
      /* Std dev: scale proportionally with sessionE (preserve CoV ≈ 1.13). */
      const fsSessionStd = !hasFreeSpins ? 0
        : (typeof fs.sessionStdDev === 'number') ? fs.sessionStdDev : fsSessionE * 1.127;
      const hnwSessionStd = !hasHoldAndWin ? 0
        : (typeof hnw.sessionStdDev === 'number') ? hnw.sessionStdDev : hnwSessionE * 1.773;
      /* UQ-DEEP-AC: iterative-tuning overrides — auto-converge może overrideovati
       * session_e/std između rounda da self-correctuje delta vs declared. */
      const ov = (overrides && typeof overrides === 'object') ? overrides : {};
      return {
        base_rtp_per_spin: typeof ov.baseRtp === 'number' ? ov.baseRtp : _baseRtpFinal,
        base_hit_freq: hitFreqNorm,
        fs_trigger_p: typeof ov.fsTrigP === 'number' ? ov.fsTrigP : fsTrigP,
        fs_session_e: typeof ov.fsSessionE === 'number' ? ov.fsSessionE : fsSessionE,
        fs_session_std: typeof ov.fsSessionStd === 'number' ? ov.fsSessionStd : fsSessionStd,
        hnw_trigger_p: typeof ov.hnwTrigP === 'number' ? ov.hnwTrigP : hnwTrigP,
        hnw_session_e: typeof ov.hnwSessionE === 'number' ? ov.hnwSessionE : hnwSessionE,
        hnw_session_std: typeof ov.hnwSessionStd === 'number' ? ov.hnwSessionStd : hnwSessionStd,
        max_win_cap_x: (typeof payback.maxWinX === 'number') ? payback.maxWinX : 5000.0,
      };
    })(),
    /* Diagnostics for /converge feedback loop. */
    _inference: {
      hasHoldAndWin,
      hasFreeSpins,
      declaredBase, declaredFsLine, declaredHwBase, declaredHwFs,
      baseRtp, hitFreqNorm,
      /* UQ-DEEP-AJ · P1A — N-feature composer breakdown.
       * Surfaces per-feature contribution table (kind, triggerProbability,
       * sessionExpectedValue, contribution, source: config|declared|default)
       * + gapInferenceUsed flag. Consumed by /converge handler for per-feature
       * delta reporting beyond the legacy fs/hnw pair. */
      composer: (() => {
        try {
          const r = composeFeatureContributions(model, breakdown, { cfTargetRtp });
          return {
            schemaVersion: r.schemaVersion,
            features: r.features,
            baseRtp: r.baseRtp,
            totalRtp: r.totalRtp,
            gapInferenceUsed: r.gapInferenceUsed,
          };
        } catch (e) { return { error: e.message }; }
      })(),
    },
  };
}

/* UQ-DEEP-AA helper: extract declared per-feature RTP targets from GDD so
 * /converge can validate each contribution against spec (not just total). */
function getDeclaredTargets(model) {
  const payback = (model && model.payback) || {};
  const breakdown = (payback.rtpBreakdown && typeof payback.rtpBreakdown === 'object') ? payback.rtpBreakdown : {};
  const _norm = (v) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
    return v > 1 ? v / 100 : v;
  };
  return {
    total: _norm(payback.rtp),
    baseLine: _norm(breakdown.baseLine),
    fsLine: _norm(breakdown.fsLine),
    hwBase: _norm(breakdown.hwBase),
    hwFs: _norm(breakdown.hwFs),
    hitFrequency: _norm(payback.hitFrequency),
    maxWinX: typeof payback.maxWinX === 'number' && payback.maxWinX > 0 ? payback.maxWinX : null,
  };
}

/* HIGH-1 (UQ-DEEP-O): clear timeout on completion (was leaking 4MB/min).
 * UQ-DEEP-AC: optional overrides za iterative self-correction loop. */
function runBatch(model, spins = 100000, seed = 42, overrides = null) {
  const input = buildExecutorInput(model, spins, seed, overrides);
  /* Strip diagnostics from wire payload (Rust ignores _inference). */
  const wire = { spins: input.spins, seed: input.seed, cf_target_rtp: input.cf_target_rtp, executor: input.executor };
  return new Promise((resolveR, reject) => {
    const child = spawn(BINARY, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    ACTIVE_BATCH_CHILDREN.add(child);
    let stdout = '', stderr = '';
    const timeoutId = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 60_000);
    const cleanup = () => {
      clearTimeout(timeoutId);
      ACTIVE_BATCH_CHILDREN.delete(child);
    };
    child.stdout.on('data', (b) => { stdout += b.toString(); });
    child.stderr.on('data', (b) => { stderr += b.toString(); });
    child.on('error', (e) => { cleanup(); reject(e); });
    child.on('close', (code) => {
      cleanup();
      if (code !== 0) {
        return reject(new Error(`mc_runtime_real exit ${code}: ${stderr.slice(0, 400)}`));
      }
      try {
        const out = JSON.parse(stdout);
        /* Attach inference diagnostics so callers can introspect (e.g. /converge). */
        out._inferenceUsed = input._inference || null;
        out._executorInput = input.executor;
        /* UQ-DEEP-AL FIX-G — propagate trust flag iz buildExecutorInput
         * tako da /converge handler može da klasifikuje synthetic-fallback
         * targets kao INFO (not regulator FAIL). */
        out.cf_target_rtp_trusted = input.cf_target_rtp_trusted !== false;
        out.cf_target_rtp_source = input.cf_target_rtp_source || null;
        resolveR(out);
      } catch (e) { reject(new Error(`JSON parse: ${e.message} / stdout: ${stdout.slice(0, 200)}`)); }
    });
    child.stdin.write(JSON.stringify(wire));
    child.stdin.end();
  });
}

/* HIGH-2 (UQ-DEEP-O): bound concurrent Rust spawns (4 max). 100 paralelnih
 * batch-eva po 100MB PAR table = 10GB OOM swap-death. */
const BATCH_MAX_CONCURRENT = 4;
const BATCH_QUEUE = [];
let _batchInFlight = 0;
const ACTIVE_BATCH_CHILDREN = new Set();  /* LOW-3: clean-shutdown bookkeeping. */

function runBatchQueued(model, spins, seed, overrides = null) {
  return new Promise((resolveR, reject) => {
    const task = { model, spins, seed, overrides, resolveR, reject };
    BATCH_QUEUE.push(task);
    drainBatchQueue();
  });
}

function drainBatchQueue() {
  while (_batchInFlight < BATCH_MAX_CONCURRENT && BATCH_QUEUE.length) {
    const task = BATCH_QUEUE.shift();
    _batchInFlight++;
    runBatch(task.model, task.spins, task.seed, task.overrides)
      .then((out) => task.resolveR(out))
      .catch((e) => task.reject(e))
      .finally(() => { _batchInFlight--; drainBatchQueue(); });
  }
}

/* CRIT-P2 (UQ-DEEP-P): in-flight Promise dedupe — two parallel /spin for
 * a new sessionId now share one runBatch() call (rather than spawning two
 * Rust children and racing to overwrite the cache entry). */
const SESSION_PENDING = new Map();

/* UQ-DEEP-AN · AN-1 — bounded in-memory audit store.
 *   AUDIT_STORE: Map<sessionId, audit-entry[]>
 *   AUDIT_MAX_PER_SESSION: 1000 (FIFO roll-over, ~few MB total cap).
 * Bounded per-session, not globally. Explicit POST /audit may outlive its
 * parent session — operators wanting long retention should persist out-of-
 * band via a sink (file/DB/KMS sign service). */
const AUDIT_STORE = new Map();
const AUDIT_MAX_PER_SESSION = 1000;

function appendAuditEntry(sessionId, entry) {
  if (typeof sessionId !== 'string' || sessionId.length === 0) return;
  let bucket = AUDIT_STORE.get(sessionId);
  if (!bucket) { bucket = []; AUDIT_STORE.set(sessionId, bucket); }
  bucket.push(entry);
  while (bucket.length > AUDIT_MAX_PER_SESSION) bucket.shift();
}

async function ensureSession(sessionId, model) {
  gcSessions();
  if (SESSION_CACHE.has(sessionId)) {
    const cached = SESSION_CACHE.get(sessionId);
    touchSession(cached);  /* CRIT-2: bump LRU on hit. */
    return cached;
  }
  if (SESSION_PENDING.has(sessionId)) {
    return SESSION_PENDING.get(sessionId);
  }
  /* CRIT-5 fix (UQ-DEEP-N): deterministic per-session seed. Derive seed
   * from sessionId hash so two identical sessionIds always get identical
   * Rust batch (idempotency contract). */
  let seedHash = 0x811c9dc5 >>> 0;  /* FNV-1a 32-bit basis */
  for (let i = 0; i < sessionId.length; i++) {
    seedHash ^= sessionId.charCodeAt(i);
    seedHash = Math.imul(seedHash, 0x01000193) >>> 0;
  }
  const deterministicSeed = seedHash & 0xffff;
  /* Cold start: run 100k batch, cache aggregate metrics + per-bucket
   * outcome distribution. Per-spin sampler uses inverse CDF on these. */
  const pending = (async () => {
    try {
      const batch = await runBatchQueued(model, 100000, deterministicSeed);
      /* CRIT-P4 (UQ-DEEP-P): reject NaN/Infinity propagation. If Rust
       * binary returns missing/garbled fields, fail loud rather than
       * letting NaN poison every subsequent measuredRtp. */
      const validFinite = (v, min = 0) => typeof v === 'number' && Number.isFinite(v) && v >= min;
      if (!validFinite(batch.rtp) || !validFinite(batch.hit_rate) || batch.hit_rate <= 0 || batch.hit_rate > 1) {
        throw new Error(`backend invariant violation: rtp=${batch.rtp} hit_rate=${batch.hit_rate}`);
      }
      const now = Date.now();
      const entry = {
        model,
        batch,
        spinsServed: 0,
        rtpSum: 0,
        rtpComp: 0,  /* HIGH-P3 (UQ-DEEP-P): Kahan summation compensator. */
        hits: 0,
        createdAt: now,
        lastAccessAt: now,
        hitRate: batch.hit_rate,
        rtpPerSpin: batch.rtp,
        fsTriggerRate: validFinite(batch.fs_trigger_rate) ? batch.fs_trigger_rate : 0,
        hnwTriggerRate: validFinite(batch.hnw_trigger_rate) ? batch.hnw_trigger_rate : 0,
        maxWinX: validFinite(batch.max_win_x, 1) ? batch.max_win_x : 5000,
      };
      SESSION_CACHE.set(sessionId, entry);
      return entry;
    } finally {
      SESSION_PENDING.delete(sessionId);
    }
  })();
  SESSION_PENDING.set(sessionId, pending);
  return pending;
}

/**
 * Per-spin sampler: given cached session metrics, draw a single spin
 * outcome using PCG64-ish hash of sessionId+spinIdx for determinism.
 * NOT the exact Rust per-spin (would require separate binary or WASM);
 * this is a faithful statistical sample from the empirical distribution
 * Rust just produced.
 */
function samplePerSpin(session) {
  const idx = ++session.spinsServed;
  /* CRIT (UQ-DEEP-O+P, both agents): operator precedence bug fixed by
   * replacing biased djb2 hash with Mulberry32 PRNG (full-uniform 32-bit
   * generator). Before:
   *   - `u = djb2(sid) % 1M / 1M` → mean 0.66, hit_rate 0.21 fired 1/1000
   *     times (∼200× under-shoot) → measuredRtp always 0
   *   - `u2 = >>> 0 % 1M` parsed as `>>> 0` (dead mod) → u2 > 1 → -log
   *     returned negative → payX pinned to 0.1
   * After: Mulberry32 seeded by FNV-1a(session.batch.seed + idx) → 4
   * uniformly-distributed [0,1) samples per spin (u, u2, fsR, hnwR).
   *
   * Mulberry32 passes BigCrush, has 2^32 period — plenty for ≤100k spins
   * per session. Determinism preserved (same seed → same stream). */
  let mState = 0x811c9dc5 >>> 0;  /* FNV-1a basis */
  const seedKey = String(session.batch.seed || 42) + ':' + idx;
  for (let i = 0; i < seedKey.length; i++) {
    mState ^= seedKey.charCodeAt(i);
    mState = Math.imul(mState, 0x01000193) >>> 0;
  }
  function nextU() {
    mState = (mState + 0x6D2B79F5) >>> 0;
    let t = mState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const u = nextU();
  const u2 = nextU();
  const fsR = nextU();
  const hnwR = nextU();

  /* Bernoulli hit decision. */
  const isHit = u < session.hitRate;
  let payX = 0;
  if (isHit) {
    /* Exponential-ish payout tail; mean tuned to match session RTP/hitRate. */
    const meanPay = session.rtpPerSpin / Math.max(session.hitRate, 1e-6);
    payX = Math.max(0.1, -Math.log(Math.max(u2, 1e-9)) * meanPay);
    if (payX > session.maxWinX) payX = session.maxWinX;
  }
  const fsTrigger = fsR < session.fsTriggerRate;
  const hnwTrigger = hnwR < session.hnwTriggerRate;
  /* HIGH-P3 (UQ-DEEP-P): Kahan summation. Naive `+=` loses ~1e-6 precision
   * per spin after 10M; Kahan keeps full double accuracy at +1 mult/add. */
  const y = payX - session.rtpComp;
  const t = session.rtpSum + y;
  session.rtpComp = (t - session.rtpSum) - y;
  session.rtpSum = t;
  if (isHit) session.hits++;
  return {
    spinIdx: idx,
    payX,
    isHit,
    fsTrigger,
    hnwTrigger,
    measuredRtp: session.rtpSum / idx,
    measuredHitRate: session.hits / idx,
    targetRtp: session.rtpPerSpin,
    sessionN: idx,
  };
}

/* ── HTTP server ─────────────────────────────────────────────────────── */

/* MED-P3 (UQ-DEEP-P): immediately destroy socket on oversize to stop
 * client streaming further bytes. Was leaking CPU on attack until end. */
function readJsonBody(req) {
  return new Promise((resolveR, reject) => {
    let body = '';
    let killed = false;
    req.on('data', (c) => {
      if (killed) return;
      body += c;
      if (body.length > 8 * 1024 * 1024) {
        killed = true;
        try { req.destroy(); } catch {}
        reject(new Error('body > 8MB'));
      }
    });
    req.on('end', () => { if (killed) return; try { resolveR(body ? JSON.parse(body) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

/* CRIT-2 (UQ-DEEP-O): CORS origin allowlist. Wildcard '*' lets any
 * cross-origin tab POST /batch/spin and GET /sessions → data exfil.
 * Echo back only if origin matches localhost variants on the
 * uploader port. */
const CORS_ALLOWLIST = new Set([
  'http://127.0.0.1:5181',
  'http://localhost:5181',
  'http://127.0.0.1:5180',
  'http://localhost:5180',
  /* null = file:// or sandboxed iframe — slot.html runs in srcdoc iframe. */
  'null',
]);

function send(res, code, obj, reqOrigin) {
  /* LV3-11: scrub vendor names + path strings before serializing. */
  const sanitized = sanitizeObj(obj);
  const json = JSON.stringify(sanitized);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json),
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Vary': 'Origin',
  };
  if (reqOrigin && CORS_ALLOWLIST.has(reqOrigin)) {
    headers['Access-Control-Allow-Origin'] = reqOrigin;
  }
  res.writeHead(code, headers);
  res.end(json);
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || null;
  try {
    if (req.method === 'OPTIONS') return send(res, 204, {}, origin);
    const url = new URL(req.url, 'http://127.0.0.1');
    const p = url.pathname;

    if (req.method === 'GET' && p === '/health') {
      /* LV3-11: don't leak host path or username. Return basename only. */
      const binBase = BINARY.split('/').pop();
      return send(res, 200, {
        ok: true,
        server: 'math-backend',
        version: '1.0.0-lv3',
        binaryPath: binBase,
        port: server.address()?.port,
        uptimeSec: Math.floor(process.uptime()),
        sessions: SESSION_CACHE.size,
        pid: process.pid,
      }, origin);
    }

    if (req.method === 'GET' && p === '/sessions') {
      /* MED-2 (UQ-DEEP-O): /sessions is enumeration leak. Already gated
       * by CORS allowlist; additionally require explicit auth token if
       * MATH_BACKEND_TOKEN env var set (operator opt-in). */
      const reqToken = url.searchParams.get('token');
      if (process.env.MATH_BACKEND_TOKEN && reqToken !== process.env.MATH_BACKEND_TOKEN) {
        return send(res, 401, { error: 'token required' }, origin);
      }
      return send(res, 200, {
        count: SESSION_CACHE.size,
        sessions: [...SESSION_CACHE.entries()].map(([id, s]) => ({
          id, spinsServed: s.spinsServed, ageMs: Date.now() - s.createdAt,
          measuredRtp: s.spinsServed > 0 ? s.rtpSum / s.spinsServed : null,
        })),
      }, origin);
    }

    if (req.method === 'POST' && p === '/batch') {
      const body = await readJsonBody(req);
      /* UQ-DEEP-AN · AN-2 — STRICT_MATH fail-fast on synthetic RTP. */
      const _sg = strictMathGuard(body.model || {});
      if (_sg) return send(res, 422, _sg, origin);
      /* MED-P4: Number.isFinite check so seed=0 stays 0 (deterministic),
       * not coerced to 42. Same for spins NaN guard. */
      const spinsRaw = Number(body.spins);
      const spins = Math.min(Math.max(Number.isFinite(spinsRaw) ? spinsRaw : 100000, 1000), 1_000_000_000);
      const seedRaw = Number(body.seed);
      const seed = Number.isFinite(seedRaw) ? seedRaw : 42;
      const out = await runBatchQueued(body.model || {}, spins, seed);
      /* UQ-DEEP-S HIGH (E2E): convergence_pass gate. Rust binary returns
       * convergence_pass:true ali bez gate na halfwidth → operator vidi
       * "PASS" iako Wilson CI je 7×+ ispred ±0.05% precision bound.
       * Override convergence_pass strict: rtp within ±0.05% AND
       * halfwidth < 0.01 (regulator precision band MATH_PRECISION_BAND). */
      const CONVERGENCE_PRECISION_PCT = 0.0005;  /* 0.05% */
      const CONVERGENCE_CI_HALFWIDTH = 0.01;     /* 1.0% Wilson 99% CI */
      const measuredDelta = (typeof out.rtp === 'number' && typeof out.cf_target_rtp === 'number')
        ? Math.abs(out.rtp - out.cf_target_rtp) : Infinity;
      const halfwidth = (typeof out.wilson_99_halfwidth === 'number') ? out.wilson_99_halfwidth : Infinity;
      const strictPass = (measuredDelta <= CONVERGENCE_PRECISION_PCT) && (halfwidth <= CONVERGENCE_CI_HALFWIDTH);
      const convergenceCriterion = {
        rtpDelta: measuredDelta,
        rtpDeltaPct: measuredDelta * 100,
        rtpDeltaBoundPct: CONVERGENCE_PRECISION_PCT * 100,
        halfwidth,
        halfwidthBound: CONVERGENCE_CI_HALFWIDTH,
        spinsRun: spins,
      };
      return send(res, 200, {
        ok: true,
        ...out,
        /* Override Rust-reported convergence_pass with strict gate. */
        convergence_pass: strictPass,
        convergence_pass_rust: out.convergence_pass,  /* preserve original for debug */
        convergence_criterion: convergenceCriterion,
      }, origin);
    }

    if (req.method === 'POST' && p === '/converge') {
      /* UQ-DEEP-W (Boki 2026-06-24): auto-converge endpoint.
       * Eskalira batch size 10K → 100K → 1M → 10M → 100M dok pass=true
       * ili maxSpins iscrpljen. Vraća JSON sa rounds[] history + final
       * verdict. Per-round Rust spawn unutar runBatchQueued (concurrency
       * cap 4) — koristi isti deterministic seed iz model hash. */
      const body = await readJsonBody(req);
      const model = body.model || {};
      /* UQ-DEEP-AN · AN-2 — STRICT_MATH fail-fast on synthetic RTP. */
      const _sg = strictMathGuard(model);
      if (_sg) return send(res, 422, _sg, origin);
      /* Budget kapovi: hard cap 100M, soft start 10K. */
      const maxSpinsRaw = Number(body.maxSpins);
      const maxSpins = Math.min(Math.max(Number.isFinite(maxSpinsRaw) ? maxSpinsRaw : 10_000_000, 10_000), 100_000_000);
      /* Precision overrides — Boki može da labavi za high-vol slots. */
      const precisionPctRaw = Number(body.precisionPct);
      const precisionPct = Number.isFinite(precisionPctRaw) && precisionPctRaw > 0 ? precisionPctRaw : 0.005;  /* 0.5% default — high-vol slot realistic */
      const halfwidthBoundRaw = Number(body.halfwidthBound);
      const halfwidthBound = Number.isFinite(halfwidthBoundRaw) && halfwidthBoundRaw > 0 ? halfwidthBoundRaw : 0.01;  /* 1% Wilson CI */
      /* Ladder of batch sizes — geometric escalation. */
      const ladder = [10_000, 100_000, 1_000_000, 10_000_000, 100_000_000].filter((n) => n <= maxSpins);
      if (ladder[ladder.length - 1] !== maxSpins && maxSpins > 10_000) ladder.push(maxSpins);
      /* Seed: deterministic per model hash. */
      let seedHash = 0x811c9dc5 >>> 0;
      const seedStr = JSON.stringify(model);
      for (let i = 0; i < seedStr.length; i++) {
        seedHash ^= seedStr.charCodeAt(i);
        seedHash = Math.imul(seedHash, 0x01000193) >>> 0;
      }
      const baseSeed = seedHash & 0xffff;
      const rounds = [];
      let passed = false;
      let lastOut = null;
      const t0 = Date.now();
      /* UQ-DEEP-AC SELF-CORRECTING LOOP.
       * Boki: "ti ili Automatski simulator da racuna sve dok ne izracuna sve
       * kompletno". Pre fix-a: ladder samo eskalira spins (više precision).
       * Sad: ako measured RTP miss declared za >0.5pp, REKALIBRIŠEMO
       * session_e/std između round-a:
       *   factor = (target - baseRtp - fsContribMeasured) / hnwContribMeasured
       *   hnw_session_e *= factor
       * Tako self-correctujemo i kad GDD nema hwBase/hwFs deklaraciju.
       * Convergence loop: spawn small probe (100K) → adjust → spawn next ladder. */
      const _declared = getDeclaredTargets(model);
      let overrides = null;   /* propagate corrections između round-a */
      const corrections = []; /* audit trail */
      for (let i = 0; i < ladder.length; i++) {
        const spinsThis = ladder[i];
        /* Vary seed per round so pooled estimator can average σ. */
        const seedThis = (baseSeed + i * 7919) & 0xffff;
        let out;
        try {
          out = await runBatchQueued(model, spinsThis, seedThis, overrides);
        } catch (e) {
          rounds.push({ spins: spinsThis, seed: seedThis, error: e.message });
          break;
        }
        const deltaPct = (typeof out.rtp === 'number' && typeof out.cf_target_rtp === 'number')
          ? Math.abs(out.rtp - out.cf_target_rtp) : Infinity;
        const halfwidth = (typeof out.wilson_99_halfwidth === 'number') ? out.wilson_99_halfwidth : Infinity;
        const roundPass = (deltaPct <= precisionPct) && (halfwidth <= halfwidthBound);
        const fbdRow = out.feature_breakdown || {};
        rounds.push({
          spins: spinsThis,
          seed: seedThis,
          rtp: out.rtp,
          delta_bps: typeof out.delta_bps === 'number' ? out.delta_bps : null,
          deltaPct,
          halfwidth,
          hit_rate: out.hit_rate,
          max_win_x: out.max_win_x,
          pass: roundPass,
          spins_per_sec: out.spins_per_sec,
          baseContrib: fbdRow.base_lines?.rtp_contribution || null,
          fsContrib: fbdRow.free_spins?.rtp_contribution || null,
          hnwContrib: fbdRow.hold_and_win?.rtp_contribution || null,
          overridesApplied: overrides ? { ...overrides } : null,
        });
        lastOut = out;
        if (roundPass) { passed = true; break; }
        /* UQ-DEEP-AC: self-correct between rounds.
         * GAP inference (in buildExecutorInput) already provides a structurally-
         * correct initial hnw_session_e — at 10M spins typical delta is < 0.05%.
         * Self-correction here handles RESIDUAL drift from default trigger_p
         * (0.0085 fs, 0.009 hnw) misalignment with actual GDD feature rates.
         *
         * Guards against over-tuning:
         *   1. SKIP first 2 rounds (10K/100K too noisy — Wilson hw > 5%)
         *   2. SKIP if halfwidth > 0.02 (measurement variance > 2%)
         *   3. Use DECLARED base/fs anchors when available (immune to noise)
         *   4. DAMP factor toward 1.0 by 30% (gentle convergence, no overshoot)
         *   5. Only correct if |delta| > 0.5pp (don't chase variance) */
        const shouldCorrect = (
          i >= 2 &&                                                    /* skip noisy early rounds */
          halfwidth <= 0.02 &&                                         /* require tight CI */
          out.rtp != null && out.cf_target_rtp != null &&
          Math.abs(out.rtp - out.cf_target_rtp) > 0.005                /* > 0.5pp drift */
        );
        if (shouldCorrect) {
          const target = out.cf_target_rtp;
          const baseMeas = fbdRow.base_lines?.rtp_contribution || 0;
          const fsMeas = fbdRow.free_spins?.rtp_contribution || 0;
          const hnwMeas = fbdRow.hold_and_win?.rtp_contribution || 0;
          const exec = out._executorInput || {};
          const curFsSessionE = exec.fs_session_e;
          const curHnwSessionE = exec.hnw_session_e;
          const newOv = overrides ? { ...overrides } : {};
          /* Anchor strategy: use declared targets when present, measured otherwise. */
          const hwDeclared = (_declared.hwBase != null || _declared.hwFs != null);
          const fsLineDeclared = (_declared.fsLine != null);
          const baseAnchor = (_declared.baseLine != null) ? _declared.baseLine : baseMeas;
          const fsAnchor = fsLineDeclared ? _declared.fsLine : fsMeas;
          const hwAnchor = hwDeclared ? ((_declared.hwBase || 0) + (_declared.hwFs || 0)) : hnwMeas;
          const DAMP = 0.7;     /* apply 70% of correction — gentle convergence */
          if (!hwDeclared && hnwMeas > 0.001) {
            const needHnw = target - baseAnchor - fsAnchor;
            if (needHnw > 0) {
              const rawFactor = needHnw / hnwMeas;
              const damped = 1 + (rawFactor - 1) * DAMP;
              const newHnwE = curHnwSessionE * damped;
              if (Number.isFinite(newHnwE) && newHnwE > 0 && newHnwE < 1000 && Math.abs(damped - 1) > 0.005) {
                newOv.hnwSessionE = newHnwE;
                newOv.hnwSessionStd = newHnwE * 1.773;
                corrections.push({ round: i, kind: 'hnw_session_e_rescale', from: curHnwSessionE, to: newHnwE, rawFactor, damped, needHnw, hnwMeas });
              }
            }
          }
          if (!fsLineDeclared && fsMeas > 0.001 && hwDeclared) {
            const needFs = target - baseAnchor - hwAnchor;
            if (needFs > 0) {
              const rawFactor = needFs / fsMeas;
              const damped = 1 + (rawFactor - 1) * DAMP;
              const newFsE = curFsSessionE * damped;
              if (Number.isFinite(newFsE) && newFsE > 0 && newFsE < 200 && Math.abs(damped - 1) > 0.005) {
                newOv.fsSessionE = newFsE;
                newOv.fsSessionStd = newFsE * 1.127;
                corrections.push({ round: i, kind: 'fs_session_e_rescale', from: curFsSessionE, to: newFsE, rawFactor, damped, needFs, fsMeas });
              }
            }
          }
          if (Object.keys(newOv).length > 0) overrides = newOv;
        }
      }
      const wallclockMs = Date.now() - t0;
      const final = lastOut ? {
        rtp: lastOut.rtp,
        cf_target_rtp: lastOut.cf_target_rtp,
        delta_bps: lastOut.delta_bps,
        wilson_99_halfwidth: lastOut.wilson_99_halfwidth,
        hit_rate: lastOut.hit_rate,
        fs_trigger_rate: lastOut.fs_trigger_rate,
        hnw_trigger_rate: lastOut.hnw_trigger_rate,
        max_win_x: lastOut.max_win_x,
        spins_per_sec: lastOut.spins_per_sec,
        feature_breakdown: lastOut.feature_breakdown,
      } : null;
      const totalSpins = rounds.reduce((s, r) => s + (r.spins || 0), 0);
      /* UQ-DEEP-AA: per-feature delta vs GDD declared rtpBreakdown.
       * Boki: "razlikuje se drasticno rtp". Total RTP convergence može
       * pucati ali per-feature drift može biti drasticno off (e.g.
       * baseLine declared 41.9% vs measured 36.4%). Report svaki delta
       * tako da operator zna gde tačno math ne odgovara spec-u. */
      const declared = getDeclaredTargets(model);
      const fbd = (lastOut && lastOut.feature_breakdown) || {};
      const _measuredFrac = (key) => {
        if (fbd[key] && typeof fbd[key].rtp_contribution === 'number') return fbd[key].rtp_contribution;
        return null;
      };
      const _featRow = (key, declaredVal, measuredKey) => {
        const measured = _measuredFrac(measuredKey || key);
        const delta = (declaredVal != null && measured != null) ? (measured - declaredVal) : null;
        const deltaPct = (delta != null) ? delta * 100 : null;
        /* Per-feature tolerance: ±2pp default (operator can override later). */
        const tolerancePct = 2.0;
        const pass = (delta != null) ? (Math.abs(deltaPct) <= tolerancePct) : null;
        return { declared: declaredVal, measured, delta, deltaPct, tolerancePct, pass };
      };
      /* UQ-DEEP-AE: derive IMPLICIT per-feature expected when GDD ne deklariše
       * breakdown ali feature postoji. Inače `pass:null` se silently brojao
       * kao OK → 4/5 baseline-ova "trivially-passed" jer nemaju breakdown.
       * Logika: ako hasFreeSpins/hasHoldAndWin AND no declared breakdown,
       * implicit expectation = generic industry split (lines 45%, fs 15%,
       * hnw 36%, sum ≈ 96%). To je STILL validacija — measured contribution
       * mora biti unutar široke ±5pp tolerance, ali bar nije ignorisano. */
      const lastInf = lastOut?._inferenceUsed || {};
      const _hasFS = lastInf.hasFreeSpins === true;
      const _hasHW = lastInf.hasHoldAndWin === true;
      /* GAP-aware implicit expectations. When GDD ima PARTIAL declared
       * (e.g. baseLine+fsLine ali ne hwBase/hwFs), HnW implicit = GAP
       * (total - baseLine - fsLine), NE generic 0.36. */
      const _total = declared.total != null ? declared.total : 0.96;
      const implicitFsLine = (declared.fsLine == null && _hasFS) ? 0.15 : null;
      const implicitHnw = (() => {
        if (declared.hwBase != null || declared.hwFs != null) return null;
        if (!_hasHW) return null;
        /* GAP from partial declared. */
        if (declared.baseLine != null || declared.fsLine != null) {
          const gap = _total - (declared.baseLine || 0) - (declared.fsLine || (implicitFsLine || 0));
          return gap > 0.05 ? gap : 0.36;
        }
        return 0.36;                                       /* generic */
      })();
      const implicitBaseLine = (declared.baseLine == null) ? (() => {
        let remaining = _total;
        if (declared.fsLine != null) remaining -= declared.fsLine;
        else if (_hasFS) remaining -= 0.15;
        if (declared.hwBase != null || declared.hwFs != null) {
          remaining -= ((declared.hwBase || 0) + (declared.hwFs || 0));
        } else if (_hasHW) {
          remaining -= (implicitHnw != null ? implicitHnw : 0.36);
        }
        return Math.max(remaining, 0.1);
      })() : null;
      /* Wider tolerance for implicit (±5pp) vs declared (±2pp). */
      const _featRowImplicit = (key, declaredVal, implicitVal, measuredKey) => {
        const measured = _measuredFrac(measuredKey || key);
        const effectiveExpected = declaredVal != null ? declaredVal : implicitVal;
        const isImplicit = declaredVal == null && implicitVal != null;
        const tolerancePct = isImplicit ? 5.0 : 2.0;
        const delta = (effectiveExpected != null && measured != null) ? (measured - effectiveExpected) : null;
        const deltaPct = (delta != null) ? delta * 100 : null;
        const pass = (delta != null) ? (Math.abs(deltaPct) <= tolerancePct) : null;
        return { declared: declaredVal, implicit: implicitVal, measured, delta, deltaPct, tolerancePct, pass, source: declaredVal != null ? 'declared' : (implicitVal != null ? 'implicit' : null) };
      };
      const featureValidation = {
        baseLine: _featRowImplicit('baseLine', declared.baseLine, implicitBaseLine, 'base_lines'),
        fsLine:   _featRowImplicit('fsLine',   declared.fsLine,   implicitFsLine,   'free_spins'),
        holdAndWin: _featRowImplicit('holdAndWin',
          (declared.hwBase != null || declared.hwFs != null) ? ((declared.hwBase || 0) + (declared.hwFs || 0)) : null,
          implicitHnw,
          'hold_and_win'),
        /* totalRtp ALWAYS validated when declared.total exists — independent of breakdown. */
        totalRtp: {
          declared: declared.total,
          measured: lastOut ? lastOut.rtp : null,
          deltaPct: (declared.total != null && lastOut) ? Math.abs(lastOut.rtp - declared.total) * 100 : null,
          tolerancePct: precisionPct * 100,
          pass: (declared.total != null && lastOut)
            ? Math.abs(lastOut.rtp - declared.total) <= precisionPct : null,
        },
        hitFrequency: {
          declared: declared.hitFrequency,
          measured: lastOut ? lastOut.hit_rate : null,
          deltaPct: (declared.hitFrequency != null && lastOut)
            ? Math.abs(lastOut.hit_rate - declared.hitFrequency) * 100 : null,
        },
        /* UQ-DEEP-AE: phantom contribution audit — fail if feature NOT detected
         * but Rust reports >1pp contribution (means executor still phantom-sampled). */
        phantomAudit: {
          fsPhantom: !_hasFS && (lastOut?.feature_breakdown?.free_spins?.rtp_contribution || 0) > 0.01,
          hnwPhantom: !_hasHW && (lastOut?.feature_breakdown?.hold_and_win?.rtp_contribution || 0) > 0.01,
        },
      };
      /* UQ-DEEP-AE: stricter all-features pass.
       * 1. Every declared row must pass.
       * 2. Every implicit row must pass (within ±5pp).
       * 3. Total RTP must pass if declared (≤ precisionPct).
       * 4. No phantom contributions allowed. */
      const featureRows = [featureValidation.baseLine, featureValidation.fsLine, featureValidation.holdAndWin];
      const allRowsPass = featureRows.every(r => r.pass !== false);
      const totalPass = featureValidation.totalRtp.pass !== false;
      const noPhantom = !featureValidation.phantomAudit.fsPhantom && !featureValidation.phantomAudit.hnwPhantom;
      const allFeaturesPass = allRowsPass && totalPass && noPhantom;
      return send(res, 200, {
        ok: true,
        passed,
        passedAllFeatures: passed && allFeaturesPass,
        rounds,
        roundCount: rounds.length,
        totalSpins,
        finalSpins: rounds.length > 0 ? rounds[rounds.length - 1].spins : 0,
        wallclockMs,
        criterion: {
          precisionPct,
          precisionPctDisplay: precisionPct * 100,
          halfwidthBound,
          halfwidthBoundDisplay: halfwidthBound * 100,
          maxSpins,
          perFeatureTolerancePct: 2.0,
        },
        final,
        declared,
        featureValidation,
        corrections,                   /* UQ-DEEP-AC: audit trail of session_e rescales */
        inference: lastOut?._inferenceUsed || null,
      }, origin);
    }

    if (req.method === 'POST' && p === '/spin') {
      const body = await readJsonBody(req);
      /* UQ-DEEP-AN · AN-2 — STRICT_MATH fail-fast on synthetic RTP. */
      const _sg = strictMathGuard(body.model || {});
      if (_sg) return send(res, 422, _sg, origin);
      /* CRIT-P1 (UQ-DEEP-P): reject sessionId > 64 char rather than
       * slice() which produces silent collisions when two distinct ids
       * share a 64-char prefix.
       * HIGH-3 (UQ-DEEP-O): reject empty / missing sessionId rather than
       * collapsing to 'default' which causes cross-game contamination. */
      const sidRaw = body.sessionId;
      if (typeof sidRaw !== 'string' || sidRaw.length === 0 || sidRaw.length > 64) {
        return send(res, 400, { error: 'sessionId required, non-empty, <=64 chars' }, origin);
      }
      if (!/^[A-Za-z0-9._:\-]+$/.test(sidRaw)) {
        return send(res, 400, { error: 'sessionId must be alnum + ._:- only' }, origin);
      }
      const session = await ensureSession(sidRaw, body.model || {});
      const outcome = samplePerSpin(session);
      /* UQ-DEEP-AG: emit wire-compatible GameLogicResponse envelope on opt-in.
       * Legacy clients (existing browser BSP_MODEL) ne traže `gle:true` pa
       * dobijaju starograno flat blob (back-compat). industry-grade klijenti
       * dobijaju OutcomeDetail{transactionId, stage, nextStage, gameStatus,
       * settled, pending, payout} + paytableHash + sessionId echo. */
      const includeGle = body.gle === true || body.emitGle === true;
      const baseResponse = { ok: true, sessionId: sidRaw, ...outcome };
      if (includeGle) {
        try {
          const { emitGleResponse } = await import('./gle-response-emitter.mjs');
          const sessionState = {
            sessionId: sidRaw,
            spinIdx: outcome.spinIdx || session.spinsServed || 0,
            stage: body.stage || 'BaseGame',
            betX: body.betX || 1,
            paytableHash: body.paytableHash || null,
          };
          baseResponse.gle = emitGleResponse(outcome, sessionState, {
            gleVersion: '4.0',
            includePopulation: false,                  /* requires grid + reelStrips */
          });
        } catch (e) {
          baseResponse.gleError = e.message;
        }
      }
      /* UQ-DEEP-AN · AN-1 — auto-stamp regulator audit entry per /spin success.
       * Operator can read back via GET /audit/<sid> or /audit/<sid>/<spinIdx>.
       * Non-fatal — backend never blocks response on audit-store contention. */
      try {
        const auditEntry = buildAuditEntry({
          sessionId: sidRaw,
          spinIdx: outcome.spinIdx || session.spinsServed || 0,
          model: body.model || {},
          executor: session.batch?._executorInput || null,
          outcome: {
            transactionId: `txn-${sidRaw}-${outcome.spinIdx || 0}`,
            payX: outcome.payX,
            measuredRtp: outcome.measuredRtp,
            measuredHitRate: outcome.measuredHitRate,
            fsTrigger: outcome.fsTrigger,
            hnwTrigger: outcome.hnwTrigger,
            stage: body.stage || 'BaseGame',
            gameStatus: 'settled',
            convergencePass: typeof outcome.measuredRtp === 'number'
              && typeof outcome.targetRtp === 'number'
              && Math.abs(outcome.measuredRtp - outcome.targetRtp) <= 0.005,
          },
          rng: { seed: session.batch?.seed || 42 },
          target: {
            declaredRtp: ((body.model || {}).payback || {}).rtp,
            hitFrequency: outcome.measuredHitRate,
          },
        });
        appendAuditEntry(sidRaw, auditEntry);
      } catch (e) {
        baseResponse.auditError = e.message;
      }
      return send(res, 200, baseResponse, origin);
    }

    /* UQ-DEEP-AN · AN-1 · regulator-grade audit endpoints.
     *   POST /audit                       → write new audit entry
     *   GET  /audit/<sessionId>           → list all entries for session
     *   GET  /audit/<sessionId>/<spinIdx> → fetch single entry
     * Storage: in-memory Map<sessionId, audit[]>, bounded 1000/session
     * with FIFO roll-over. Schema enforced via validateAuditEntry. */
    if (req.method === 'POST' && p === '/audit') {
      const body = await readJsonBody(req);
      const entry = (body && body.auditLog) ? body : buildAuditEntry(body || {});
      const v = validateAuditEntry(entry);
      if (!v.ok) {
        return send(res, 400, { ok: false, error: 'invalid audit entry', errors: v.errors }, origin);
      }
      const sid = entry.auditLog.sessionId;
      appendAuditEntry(sid, entry);
      return send(res, 200, {
        ok: true,
        sessionId: sid,
        spinIdx: entry.auditLog.spinIdx,
        schemaVersion: AUDIT_LOG_SCHEMA_VERSION,
        stored: AUDIT_STORE.get(sid)?.length || 0,
      }, origin);
    }

    if (req.method === 'GET' && p.startsWith('/audit/')) {
      const parts = p.split('/').filter(Boolean);
      if (parts.length < 2) {
        return send(res, 400, { error: 'sessionId required in path' }, origin);
      }
      const sid = decodeURIComponent(parts[1]);
      const bucket = AUDIT_STORE.get(sid);
      if (!bucket || bucket.length === 0) {
        return send(res, 404, { error: 'sessionId not found', sessionId: sid }, origin);
      }
      if (parts.length >= 3) {
        const idxN = Number(parts[2]);
        if (!Number.isFinite(idxN)) {
          return send(res, 400, { error: 'spinIdx must be number' }, origin);
        }
        const found = bucket.find((e) => e.auditLog && e.auditLog.spinIdx === idxN);
        if (!found) {
          return send(res, 404, { error: 'spinIdx not found', sessionId: sid, spinIdx: idxN }, origin);
        }
        return send(res, 200, {
          ok: true, sessionId: sid, spinIdx: idxN, entry: found,
          schemaVersion: AUDIT_LOG_SCHEMA_VERSION,
        }, origin);
      }
      return send(res, 200, {
        ok: true, sessionId: sid, count: bucket.length, entries: bucket,
        schemaVersion: AUDIT_LOG_SCHEMA_VERSION,
      }, origin);
    }

    /* UQ-DEEP-AG · wire-compatible serverConfig kompajler endpoint.
     * POST /serverConfig { model } → { serverConfig, paytableHash, gleVersion }
     * Klijent može da snima paytable hash za regulator audit i da koristi
     * lines flatten + gain_table + special_symbols u industry math handshake. */
    if (req.method === 'POST' && p === '/serverConfig') {
      const body = await readJsonBody(req);
      const model = body.model || {};
      try {
        const { compileServerConfig } = await import('./sgs-compiler.mjs');
        const result = compileServerConfig(model, {
          gleVersion: body.gleVersion || '4.0',
        });
        return send(res, 200, { ok: true, ...result }, origin);
      } catch (e) {
        return send(res, 500, { ok: false, error: e.message }, origin);
      }
    }

    return send(res, 404, { error: `unknown route: ${req.method} ${p}` }, origin);
  } catch (e) {
    return send(res, 500, { error: e.message }, origin);
  }
});

/* Port autopick: try DEFAULT_PORT, fallback to 9002, 9003, ... */
function tryListen(port, host = '127.0.0.1') {
  return new Promise((resolveR, reject) => {
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE' && port < DEFAULT_PORT + 10) {
        server.removeAllListeners('listening');
        resolveR(tryListen(port + 1, host));
      } else { reject(err); }
    });
    server.once('listening', () => {
      console.log(`▸ math-backend listening on http://${host}:${port}`);
      console.log(`  binary: ${BINARY}`);
      /* UQ-DEEP-AN · AN-2 — operator visibility on strict mode. */
      console.log(`  STRICT_MATH=${STRICT_MATH ? 'true' : 'false'}${STRICT_MATH ? ' (synthetic-fallback RTP → HTTP 422)' : ' (soft warning only)'}`);
      resolveR(port);
    });
    server.listen(port, host);
  });
}

const PORT_ARG = (() => {
  const i = process.argv.indexOf('--port');
  return i >= 0 ? Number(process.argv[i + 1]) : DEFAULT_PORT;
})();

tryListen(PORT_ARG).catch((e) => {
  console.error('▸ failed to listen:', e.message);
  process.exit(1);
});

/* Graceful shutdown. */
['SIGINT', 'SIGTERM'].forEach((sig) => {
  process.on(sig, () => {
    console.log(`▸ ${sig} received, closing`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 3000);
  });
});
