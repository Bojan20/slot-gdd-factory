/* eslint-disable no-console */
/**
 * UQ-DEEP-AM · FIX-2 — liveRtpHud warming threshold raise (Boki 2026-06-24).
 *
 * Contract verified:
 *   • defaultConfig.warmupSpins = 500 (industry minimum)
 *   • resolveConfig clamps warmupSpins to [100, 5000]
 *   • Auto-derive from hit_freq: max(500, ceil(5/hit_freq)), final clamp [100,5000]
 *   • Runtime hides numeric measured value while n < warmupSpins (warming)
 *   • bandClass returns 'warming' when n < warmupSpins regardless of delta
 *
 * Root cause (UQ-DEEP-AL Playwright probe):
 *   N=10..80 spinova prikazivali wild RTP (223.25%, 165.77%, 106.57%) bez
 *   "WARMING" badge-a. Tehnički korektno (kratki prozor → high variance) ali
 *   operator/user vidi "WITHIN CI 223.25%" pa misli da je math broken.
 *   FIX raises warmup default 100→500 i sakriva numerički value dok n<warmup.
 */

import {
  defaultConfig, resolveConfig,
  emitLiveRtpHudCSS, emitLiveRtpHudMarkup, emitLiveRtpHudRuntime,
} from '../../src/blocks/liveRtpHud.mjs';

let pass = 0, fail = 0;
const t = (n, fn) => {
  try { fn(); console.log('  ok', n); pass++; }
  catch (e) { console.log('  FAIL', n, '\n     ', e.message); fail++; }
};
const eq  = (a, b, m = '') => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`); };
const ok  = (v, m = '') => { if (!v) throw new Error(`expected truthy — ${m}`); };
const ct  = (s, n, m = '') => { if (!String(s).includes(n)) throw new Error(`missing substring ${JSON.stringify(n)} — ${m}`); };
const ge  = (a, b, m = '') => { if (!(a >= b)) throw new Error(`expected ${a} >= ${b} — ${m}`); };
const le  = (a, b, m = '') => { if (!(a <= b)) throw new Error(`expected ${a} <= ${b} — ${m}`); };

console.log('— blocks/liveRtpHud.mjs (UQ-DEEP-AM FIX-2) —');

/* ── 1. default config ── */
t('defaultConfig: warmupSpins default = 500', () => {
  const c = defaultConfig();
  eq(c.warmupSpins, 500, 'warmupSpins must default to 500');
});

t('defaultConfig: includes contract fields', () => {
  const c = defaultConfig();
  ok(typeof c.enabled === 'boolean', 'enabled bool');
  ok(typeof c.warmupSpins === 'number', 'warmupSpins number');
  ok(typeof c.warmupSpinsMin === 'number', 'legacy warmupSpinsMin alias present');
  ok(typeof c.ciZ === 'number', 'ciZ present');
});

/* ── 2. resolveConfig clamp ── */
t('resolveConfig: clamps warmupSpins below floor (50 → 100)', () => {
  const c = resolveConfig({ liveRtpHud: { warmupSpins: 50 } });
  eq(c.warmupSpins, 100, 'must clamp UP to 100 (floor)');
  eq(c.warmupSpinsMin, 100, 'legacy alias kept in sync');
});

t('resolveConfig: clamps warmupSpins above ceiling (10000 → 5000)', () => {
  const c = resolveConfig({ liveRtpHud: { warmupSpins: 10000 } });
  eq(c.warmupSpins, 5000, 'must clamp DOWN to 5000 (ceiling)');
  eq(c.warmupSpinsMin, 5000, 'legacy alias kept in sync');
});

t('resolveConfig: preserves in-range warmupSpins (1500)', () => {
  const c = resolveConfig({ liveRtpHud: { warmupSpins: 1500 } });
  eq(c.warmupSpins, 1500, 'in-range value preserved');
});

t('resolveConfig: ignores non-numeric warmupSpins', () => {
  const c = resolveConfig({ liveRtpHud: { warmupSpins: 'bogus' } });
  eq(c.warmupSpins, 500, 'invalid → default 500');
});

/* ── 3. auto-derive from hit_freq (rendered runtime LRH_CFG.warmupSpins) ── */
function extractLrhCfg(runtimeJs) {
  const m = runtimeJs.match(/var\s+LRH_CFG\s*=\s*(\{[^;]*\});/);
  if (!m) throw new Error('LRH_CFG inline not found in runtime');
  return JSON.parse(m[1]);
}

t('auto-derive: hit_freq=0.2 → max(500, ceil(25)) = 500', () => {
  const runtime = emitLiveRtpHudRuntime(defaultConfig(), {
    payback: { rtp: 0.96, hitFrequency: 0.2, volatilityIdx: 5, maxWinX: 5000 },
  });
  const cfg = extractLrhCfg(runtime);
  eq(cfg.warmupSpins, 500, 'high hit_freq → floor 500 dominates');
});

t('auto-derive: hit_freq=0.05 → max(500, ceil(100)) = 500', () => {
  const runtime = emitLiveRtpHudRuntime(defaultConfig(), {
    payback: { rtp: 0.96, hitFrequency: 0.05, volatilityIdx: 5, maxWinX: 5000 },
  });
  const cfg = extractLrhCfg(runtime);
  eq(cfg.warmupSpins, 500, 'mid hit_freq → still 500');
});

t('auto-derive: hit_freq=0.001 (rare jackpot) → 5000 (clamped at ceiling)', () => {
  const runtime = emitLiveRtpHudRuntime(defaultConfig(), {
    payback: { rtp: 0.96, hitFrequency: 0.001, volatilityIdx: 10, maxWinX: 50000 },
  });
  const cfg = extractLrhCfg(runtime);
  /* ceil(5/0.001) = 5000 → max(500, 5000) = 5000 → clamp [100,5000] = 5000 */
  eq(cfg.warmupSpins, 5000, 'rare-hit slot → 5000 ceiling');
});

t('auto-derive: clamp [100, 5000] inclusive', () => {
  /* Extremely rare (hit_freq=0.0001 → ceil 50000) must clamp to 5000. */
  const runtime = emitLiveRtpHudRuntime(defaultConfig(), {
    payback: { rtp: 0.96, hitFrequency: 0.0001, volatilityIdx: 10, maxWinX: 50000 },
  });
  const cfg = extractLrhCfg(runtime);
  ge(cfg.warmupSpins, 100, 'never below floor');
  le(cfg.warmupSpins, 5000, 'never above ceiling');
  eq(cfg.warmupSpins, 5000, 'extreme rare hit clamped to 5000');
});

/* ── 4. display behavior during warming: numeric measured hidden ── */
t('runtime: hides numeric measured value while n < warmupSpins', () => {
  const runtime = emitLiveRtpHudRuntime(defaultConfig(), {
    payback: { rtp: 0.96, hitFrequency: 0.2, volatilityIdx: 5, maxWinX: 5000 },
  });
  /* The paint() function gates measured display on inWarmup flag. */
  ct(runtime, 'inWarmup', 'inWarmup gate variable present');
  ct(runtime, '!inWarmup', 'measured rendered only when !inWarmup');
  /* The lrhMeasured update must reference inWarmup, not just isFinite. */
  ok(/m\.textContent\s*=\s*\(isFinite\(measured\)\s*&&\s*!inWarmup\)/.test(runtime),
    'lrhMeasured must combine isFinite(measured) && !inWarmup');
});

/* ── 5. bandClass returns 'warming' when n < warmupSpins ── */
t('bandClass: warming branch present in runtime', () => {
  const runtime = emitLiveRtpHudRuntime(defaultConfig(), {
    payback: { rtp: 0.96, hitFrequency: 0.2, volatilityIdx: 5, maxWinX: 5000 },
  });
  ct(runtime, "return 'warming'", 'warming return branch present');
  ct(runtime, 'n < LRH_CFG.warmupSpins', 'n threshold check present');
});

/* ── 6. inline bandClass math behavior (n<warmup → warming for ANY delta) ── */
t('bandClass math: n<warmup with massive delta still returns warming', () => {
  /* Mirror the inline bandClass logic for isolated assertion. */
  function bandClass(deltaAbs, n, cfg) {
    if (!Number.isFinite(deltaAbs)) return 'off';
    if (n < cfg.warmupSpins) return 'warming';
    const avgWinIfHit = cfg.target / Math.max(cfg.hitFreq, 0.01);
    const varFactor = Math.max(1, cfg.volIdx / 3);
    const sigma2 = cfg.hitFreq * avgWinIfHit * avgWinIfHit * varFactor;
    let sigma = Math.sqrt(sigma2);
    if (cfg.maxWinX > 0) sigma = Math.min(sigma, cfg.maxWinX * 0.5);
    const halfWidth = cfg.ciZ * sigma / Math.sqrt(n);
    const amberThresh = halfWidth * cfg.ciAmberScale;
    const redThresh = halfWidth * cfg.ciRedScale;
    if (deltaAbs <= amberThresh) return 'green';
    if (deltaAbs <= redThresh) return 'amber';
    return 'red';
  }
  const cfg = {
    target: 0.96, hitFreq: 0.2, volIdx: 5, maxWinX: 5000,
    ciZ: 2.576, ciAmberScale: 1.0, ciRedScale: 2.0, warmupSpins: 500,
  };
  /* QA-1 reported deltas (223.25%, 165.77%, 130.60%) at N=10..40 must be warming. */
  eq(bandClass(2.2325, 10, cfg), 'warming', 'N=10 with 223% delta → warming');
  eq(bandClass(1.6577, 20, cfg), 'warming', 'N=20 with 165% delta → warming');
  eq(bandClass(1.3060, 20, cfg), 'warming', 'N=20 with 130% delta → warming');
  eq(bandClass(1.1031, 40, cfg), 'warming', 'N=40 with 110% delta → warming');
  /* Past warmup with small delta → green. */
  eq(bandClass(0.05, 1000, cfg), 'green', 'post-warmup small delta → green');
});

/* ── 7. CSS / Markup contract sanity ── */
t('emitLiveRtpHudCSS: warming badge style present', () => {
  const css = emitLiveRtpHudCSS(defaultConfig());
  ct(css, 'lrh-badge--warming', 'warming badge css class shipped');
});

t('emitLiveRtpHudMarkup: lrhMeasured element present', () => {
  const html = emitLiveRtpHudMarkup(defaultConfig());
  ct(html, 'id="lrhMeasured"', 'measured value DOM target present');
  ct(html, 'id="lrhDrift"', 'drift badge DOM target present');
});

console.log(`\nliveRtpHud UQ-DEEP-AM tests — ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
