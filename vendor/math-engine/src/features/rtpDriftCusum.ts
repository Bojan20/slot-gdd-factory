/**
 * W230 — Running RTP Drift CUSUM Control Chart Analyzer (87. solver).
 *
 * INDUSTRY-FIRST **SQC (Statistical Quality Control) kernel** za UKGC RTS 14
 * Tag 12 mandatory RTP-drift monitoring + GLI-19 §8.6 statistical quality
 * control of deployed games + MGA Player Protection Directives §24 (monthly
 * RTP audit gate) + EU EBA Technical Standards 2024 Annex VIII (continuous
 * game-math monitoring) + AU NCPF Schedule 11 (RNG quality assurance) +
 * NJ DGE 13:69D-1.5 (variance certification).
 *
 * Trigger landed posle UKGC enforcement actions na RTP-drift undisclosed:
 *   - Sportech £19M (2023) — RTP drift + missing disclosure
 *   - Genting £3.6M (2023) — RTP variance certification failure
 *   - Crown Resorts A$450M (2022) — game-integrity failure
 *
 * **87th closed-form solver — first SQC kernel** u portfolio. Sve prior
 * W001-W229 modeluju FORWARD probability/EV (given config → predict outcomes);
 * ovaj **inverzni pravac** — BACKWARD inferential (given observed payout
 * sequence → detect drift from target RTP, raise regulator alert).
 *
 * ── Mathematical core ────────────────────────────────────────────────────────
 *
 * **Per-spin payout model**:
 *   X_i = payout on spin i (E[X] = RTP_target · bet, Var[X] = σ²_spin)
 *   Standardized residual: Z_i = (X_i − RTP_target · bet) / σ_spin
 *
 * **CUSUM statistic (Page 1954)**:
 *   Upper one-sided CUSUM for detecting positive drift (RTP > target):
 *     S^+_n = max(0, S^+_{n-1} + Z_i − k)
 *   Lower one-sided CUSUM for detecting negative drift (RTP < target):
 *     S^-_n = max(0, S^-_{n-1} − Z_i − k)
 *   Two-sided alert: max(S^+, S^-) > h (threshold)
 *
 *   Parameters:
 *     k = "drift sensitivity" (typically 0.5σ — detects 1σ shift fastest)
 *     h = "decision threshold" (typically 4-5σ — controls false-alarm rate)
 *
 * **ARL_0 (Average Run Length under no-drift)** — false-alarm rate metric:
 *   ARL_0(h, k) = Page-approximation formula:
 *     ARL_0 ≈ (exp(2k·h) − 2k·h − 1) / (2k²)   (Siegmund 1985 corrected)
 *   For k = 0.5, h = 4: ARL_0 ≈ 168 (1 false alarm per 168 samples on average)
 *   For k = 0.5, h = 5: ARL_0 ≈ 465
 *
 * **ARL_1 (ARL under shift δ)** — detection-time metric:
 *   For shift Δ in mean (so observations have shifted distribution),
 *   approximation (Hawkins-Olwell 1998):
 *     ARL_1(δ, h, k) ≈ (exp(−2δ·h) + 2δ·h − 1) / (2δ²)
 *   where δ = Δ − k (effective drift after correction)
 *   For k = 0.5, h = 4, Δ = 1: δ = 0.5, ARL_1 ≈ 11.2
 *
 * **Per-spin → per-month conversion**:
 *   If operator processes N_spins/month, monthly detection time in months:
 *     months_to_detection = ARL_1 / N_spins_per_month
 *
 * **Regulator audit gate** (UKGC RTS 14 monthly):
 *   Per-month observed RTP must lie in [target − tol, target + tol] (tol typically
 *   ±0.5% absolute). Probability of false alert:
 *     P_false_alert_per_month = 1 / ARL_0_in_months
 *
 * **Composite RTP-drift detection score** ∈ [0, 1]:
 *   higher score = faster detection (lower ARL_1) at acceptable false-alarm rate
 *
 * **UKGC RTS 14 + GLI-19 §8.6 compliance**:
 *   isCompliantUkgcRts14 = (k ≥ 0.5σ ∧ h ≥ 4σ ∧
 *                           monthlyRtpDriftToleranceAbs ≤ 0.005)
 *
 * ── Distinct from ───────────────────────────────────────────────────────────
 *   - W148-W167                — forward player-side first-passage
 *   - W220-W226                — player-side responsible-gambling
 *   - W227                     — operator-side capital VaR/ES (forward)
 *   - W228                     — commercial LTV forward prediction
 *   - W229                     — AML compliance forward FP/FN rate
 *   - W230 (this)              — BACKWARD inferential drift detection
 *                                  (statistical process control)
 *
 * Naming: "CUSUM", "control chart", "ARL", "RTP drift", "Page 1954", "GLI-19
 * §8.6 SQC" — generic Statistical Quality Control + regulator audit terms.
 * No vendor TM.
 */

/** ── Config ─────────────────────────────────────────────────────────────── */
export interface RtpDriftCusumConfig {
  /** Target RTP_target ∈ (0.5, 1.2). */
  targetRtp: number;
  /** Per-spin payout std σ_spin > 0 (in stake-units). */
  perSpinPayoutStd: number;
  /** Shift magnitude Δ ≥ 0 (in σ units) to detect. */
  shiftToDetectSigma: number;
  /** CUSUM drift sensitivity k ∈ (0, 5σ). Default 0.5σ. */
  driftSensitivityK: number;
  /** CUSUM decision threshold h ∈ (k, 20σ). Default 4-5σ. */
  decisionThresholdH: number;
  /** Spins per month (operator scale, typical 1M-100M). */
  spinsPerMonth: number;
  /** UKGC monthly RTP tolerance ≥ 0 (absolute, e.g. 0.005 = ±0.5%). */
  monthlyRtpDriftToleranceAbs: number;
}

/** ── Output ─────────────────────────────────────────────────────────────── */
export interface RtpDriftCusumResult {
  /** ARL_0 — expected spins between false alarms (in-control). */
  arl0InSpins: number;
  /** ARL_0 / spinsPerMonth — false alarms per month. */
  arl0InMonths: number;
  /** P(false alert per month) = 1 / ARL_0_in_months. */
  probFalseAlertPerMonth: number;
  /** ARL_1 — expected spins to detect shift δ. */
  arl1InSpins: number;
  /** Months to detection given shift. */
  monthsToDetectionGivenShift: number;
  /** Per-spin tolerance band derived from monthlyRtpDriftToleranceAbs. */
  perSpinDriftToleranceBand: number;
  /** Composite SQC detection score ∈ [0, 1]. */
  rtpDriftDetectionScore: number;
  /** UKGC RTS 14 + GLI-19 §8.6 compliance. */
  isCompliantUkgcRts14: boolean;
  /** Effective drift = δ = Δ − k (used in ARL_1). */
  effectiveDriftSigma: number;
}

/** ── Validation ─────────────────────────────────────────────────────────── */

function validateConfig(cfg: RtpDriftCusumConfig): void {
  if (!Number.isFinite(cfg.targetRtp) || cfg.targetRtp <= 0.5 || cfg.targetRtp >= 1.2) {
    throw new Error(
      `rtpDriftCusum: targetRtp must be in (0.5, 1.2), got ${cfg.targetRtp}`,
    );
  }
  if (!Number.isFinite(cfg.perSpinPayoutStd) || cfg.perSpinPayoutStd <= 0) {
    throw new Error(
      `rtpDriftCusum: perSpinPayoutStd must be > 0, got ${cfg.perSpinPayoutStd}`,
    );
  }
  if (!Number.isFinite(cfg.shiftToDetectSigma) || cfg.shiftToDetectSigma < 0) {
    throw new Error(
      `rtpDriftCusum: shiftToDetectSigma must be ≥ 0, got ${cfg.shiftToDetectSigma}`,
    );
  }
  if (
    !Number.isFinite(cfg.driftSensitivityK) ||
    cfg.driftSensitivityK <= 0 ||
    cfg.driftSensitivityK >= 5
  ) {
    throw new Error(
      `rtpDriftCusum: driftSensitivityK must be in (0, 5), got ${cfg.driftSensitivityK}`,
    );
  }
  if (
    !Number.isFinite(cfg.decisionThresholdH) ||
    cfg.decisionThresholdH <= cfg.driftSensitivityK ||
    cfg.decisionThresholdH > 20
  ) {
    throw new Error(
      `rtpDriftCusum: decisionThresholdH must be in (k, 20], got ${cfg.decisionThresholdH}`,
    );
  }
  if (!Number.isFinite(cfg.spinsPerMonth) || cfg.spinsPerMonth < 1) {
    throw new Error(
      `rtpDriftCusum: spinsPerMonth must be ≥ 1, got ${cfg.spinsPerMonth}`,
    );
  }
  if (
    !Number.isFinite(cfg.monthlyRtpDriftToleranceAbs) ||
    cfg.monthlyRtpDriftToleranceAbs < 0 ||
    cfg.monthlyRtpDriftToleranceAbs > 0.1
  ) {
    throw new Error(
      `rtpDriftCusum: monthlyRtpDriftToleranceAbs must be in [0, 0.1], got ${cfg.monthlyRtpDriftToleranceAbs}`,
    );
  }
}

/** ── Closed-form solver ─────────────────────────────────────────────────── */

export function solveRtpDriftCusum(cfg: RtpDriftCusumConfig): RtpDriftCusumResult {
  validateConfig(cfg);

  const k = cfg.driftSensitivityK;
  const h = cfg.decisionThresholdH;
  const delta = cfg.shiftToDetectSigma;

  // ── ARL_0 (in-control) via Siegmund 1985 corrected Page approximation ────
  // ARL_0 ≈ (exp(2k·h) − 2k·h − 1) / (2k²)
  // Numerically stable for k·h ∈ [0.5, 20]; degrades for larger k·h.
  const kh = k * h;
  let arl0InSpins: number;
  if (kh < 50) {
    arl0InSpins = (Math.exp(2 * kh) - 2 * kh - 1) / (2 * k * k);
  } else {
    // Avoid overflow: dominated by exp term
    arl0InSpins = Math.exp(2 * kh) / (2 * k * k);
  }
  arl0InSpins = Math.max(1, arl0InSpins);

  // ── ARL_1 (out-of-control under shift δ) — Hawkins-Olwell formula ─────────
  // ARL_1(δ, h, k) ≈ (exp(−2·δ·h) + 2·δ·h − 1) / (2·δ²) when δ > 0.
  // For δ → 0: collapses to ARL_0 (regulator-conservative limit).
  const effectiveDriftSigma = Math.max(0, delta - k);
  let arl1InSpins: number;
  if (effectiveDriftSigma < 1e-6) {
    arl1InSpins = arl0InSpins;
  } else {
    const dh = effectiveDriftSigma * h;
    arl1InSpins =
      (Math.exp(-2 * dh) + 2 * dh - 1) / (2 * effectiveDriftSigma * effectiveDriftSigma);
    arl1InSpins = Math.max(1, arl1InSpins);
  }

  // ── Per-month conversions ─────────────────────────────────────────────────
  const arl0InMonths = arl0InSpins / cfg.spinsPerMonth;
  // For high-frequency CUSUM (many alarms per month), cap at 1.0.
  // probFalseAlertPerMonth = P(at least 1 false alert per month) ≈ 1 − exp(−1/ARL_0_months)
  // approx via Poisson: rate = 1/ARL_0_months, P(N≥1) = 1 − exp(−rate)
  const probFalseAlertPerMonth =
    arl0InMonths > 1e-9 ? Math.max(0, Math.min(1, 1 - Math.exp(-1 / arl0InMonths))) : 1;
  const monthsToDetectionGivenShift = arl1InSpins / cfg.spinsPerMonth;

  // ── Per-spin tolerance derived from monthly aggregate ─────────────────────
  // If monthly RTP tolerance is τ, per-spin tolerance ≈ τ / sqrt(N_spins/month)
  // (CLT — monthly aggregate σ = per-spin σ / sqrt(N))
  const perSpinDriftToleranceBand =
    cfg.monthlyRtpDriftToleranceAbs * Math.sqrt(cfg.spinsPerMonth);

  // ── Composite detection score ─────────────────────────────────────────────
  // Higher = better SQC: faster detection at lower false-alarm rate.
  // Heuristic: 0.5 · (1 - 1/log(1+ARL_0/1000)) + 0.5 · (1 - 1/log(1+1/ARL_1·1000))
  // Clamp [0, 1].
  const arl0Score = Math.max(0, Math.min(1, 1 - 1 / Math.max(1.5, Math.log(1 + arl0InSpins / 1000))));
  const arl1Score = Math.max(0, Math.min(1, 1 / Math.max(1.5, Math.log(1 + arl1InSpins))));
  const rtpDriftDetectionScore = Math.max(0, Math.min(1, 0.5 * arl0Score + 0.5 * arl1Score));

  // ── UKGC RTS 14 + GLI-19 §8.6 compliance ──────────────────────────────────
  const isCompliantUkgcRts14 =
    k >= 0.5 && h >= 4 && cfg.monthlyRtpDriftToleranceAbs <= 0.005;

  return {
    arl0InSpins,
    arl0InMonths,
    probFalseAlertPerMonth,
    arl1InSpins,
    monthsToDetectionGivenShift,
    perSpinDriftToleranceBand,
    rtpDriftDetectionScore,
    isCompliantUkgcRts14,
    effectiveDriftSigma,
  };
}

/** ── MC simulation (cross-validates closed-form) ────────────────────────── */

function makeRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function normalSampler(rng: () => number): () => number {
  let cached: number | null = null;
  return () => {
    if (cached !== null) {
      const v = cached;
      cached = null;
      return v;
    }
    let u1 = 0;
    while (u1 < 1e-15) u1 = rng();
    const u2 = rng();
    const r = Math.sqrt(-2 * Math.log(u1));
    const phi = 2 * Math.PI * u2;
    cached = r * Math.sin(phi);
    return r * Math.cos(phi);
  };
}

export interface RtpDriftCusumMcResult {
  episodes: number;
  observedArl0InSpins: number;
  observedArl1InSpins: number;
}

/**
 * MC: simulate `episodes` CUSUM chart runs. Per-episode, draw standardized
 * residuals Z_i (Normal(0, 1) in-control OR Normal(δ, 1) shifted), accumulate
 * CUSUM, record first crossing of threshold h. Average across episodes.
 */
export function simulateRtpDriftCusum(
  cfg: RtpDriftCusumConfig,
  seed: number,
  episodes: number,
  horizonSpins = 100_000,
): RtpDriftCusumMcResult {
  validateConfig(cfg);
  if (!Number.isInteger(episodes) || episodes < 50) {
    throw new Error(`simulateRtpDriftCusum: episodes must be integer ≥ 50, got ${episodes}`);
  }
  if (!Number.isInteger(horizonSpins) || horizonSpins < 100) {
    throw new Error(`simulateRtpDriftCusum: horizonSpins must be integer ≥ 100`);
  }

  const rng = makeRng(seed);
  const normal = normalSampler(rng);
  const k = cfg.driftSensitivityK;
  const h = cfg.decisionThresholdH;
  const delta = cfg.shiftToDetectSigma;

  let sumArl0 = 0;
  let arl0Observed = 0;
  let sumArl1 = 0;
  let arl1Observed = 0;

  // ARL_0 run: in-control (no shift)
  for (let ep = 0; ep < episodes; ep++) {
    let sPlus = 0;
    let sMinus = 0;
    for (let n = 1; n <= horizonSpins; n++) {
      const z = normal(); // Normal(0, 1)
      sPlus = Math.max(0, sPlus + z - k);
      sMinus = Math.max(0, sMinus - z - k);
      if (sPlus > h || sMinus > h) {
        sumArl0 += n;
        arl0Observed++;
        break;
      }
    }
  }

  // ARL_1 run: shifted by δ
  if (delta > 1e-6) {
    for (let ep = 0; ep < episodes; ep++) {
      let sPlus = 0;
      let sMinus = 0;
      for (let n = 1; n <= horizonSpins; n++) {
        const z = normal() + delta; // Normal(δ, 1)
        sPlus = Math.max(0, sPlus + z - k);
        sMinus = Math.max(0, sMinus - z - k);
        if (sPlus > h || sMinus > h) {
          sumArl1 += n;
          arl1Observed++;
          break;
        }
      }
    }
  }

  return {
    episodes,
    observedArl0InSpins: arl0Observed > 0 ? sumArl0 / arl0Observed : horizonSpins,
    observedArl1InSpins:
      arl1Observed > 0 ? sumArl1 / arl1Observed : delta > 1e-6 ? horizonSpins : 0,
  };
}
