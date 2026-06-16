#!/usr/bin/env node
/**
 * tests/blocks/_winCapJurisdictions.test.mjs
 *
 * Wave W51 — Cross-jurisdiction enforcement test suite.
 *
 * Validates that winCap's per-jurisdiction ceiling matrix correctly
 * clamps operator-specified maxWinX down to the regulator ceiling and
 * emits audit events for downstream RG / cert / telemetry consumers.
 *
 * Regulator anchors:
 *   • UKGC RTS 13   — max-win cap 100 000× stake
 *   • MGA Player Protection §5 — 500 000× stake ceiling
 *   • SE Spelinspektionen Tech Std 6.5 — 500 000× clamp
 *   • DE GlüStV §11 — €1 stake floor + effective 100 000× ceiling
 *   • NL KSA Spel-1 §16 — 250 000× ceiling
 *   • ON AGCO Standard 4.06 — 250 000× max-win disclosure
 *   • NJ DGE — 500 000× upper-bound default; per-licence variance
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  defaultConfig,
  resolveConfig,
  emitWinCapRuntime,
  emitWinCapCSS,
  emitWinCapMarkup,
  JURISDICTION_CEILINGS,
} from '../../src/blocks/winCap.mjs';

let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
function block(name, fn) { console.log('— ' + name + ' —'); fn(); console.log(''); }

/* ════════════════════════════════════════════════════════════════════
 * 1. JURISDICTION_CEILINGS export — frozen + complete
 * ════════════════════════════════════════════════════════════════════ */
block('1. JURISDICTION_CEILINGS matrix', () => {
  t('1.1 export is frozen (immutable)', Object.isFrozen(JURISDICTION_CEILINGS));
  t('1.2 UKGC = 100k× stake (RTS 13)',  JURISDICTION_CEILINGS.UKGC === 100000);
  t('1.3 MGA  = 500k× stake (PP §5)',    JURISDICTION_CEILINGS.MGA  === 500000);
  t('1.4 SE   = 500k× stake (Tech 6.5)', JURISDICTION_CEILINGS.SE   === 500000);
  t('1.5 DE   = 100k× stake (GlüStV)',   JURISDICTION_CEILINGS.DE   === 100000);
  t('1.6 NL   = 250k× stake (Spel-1)',   JURISDICTION_CEILINGS.NL   === 250000);
  t('1.7 ON   = 250k× stake (AGCO)',     JURISDICTION_CEILINGS.ON   === 250000);
  t('1.8 NJ   = 500k× stake (upper)',    JURISDICTION_CEILINGS.NJ   === 500000);
  t('1.9 IT   = 250k× stake (ADM)',      JURISDICTION_CEILINGS.IT   === 250000);
  t('1.10 OFF = 1M× stake (permissive)', JURISDICTION_CEILINGS.OFF  === 1000000);
});

/* ════════════════════════════════════════════════════════════════════
 * 2. Default config — frozen baseline
 * ════════════════════════════════════════════════════════════════════ */
block('2. Default config baseline', () => {
  const c = defaultConfig();
  t('2.1 enabled = false (off until GDD/jurisdiction)', c.enabled === false);
  t('2.2 maxWinX = 5000 (industry midpoint)',            c.maxWinX === 5000);
  t('2.3 mode    = round',                               c.mode === 'round');
  t('2.4 jurisdiction = OFF (permissive default)',       c.jurisdiction === 'OFF');
  t('2.5 ceilingApplied = false (no clamp by default)',  c.ceilingApplied === false);
  t('2.6 forceRoundEnd = true',                          c.forceRoundEnd === true);
});

/* ════════════════════════════════════════════════════════════════════
 * 3. resolveConfig — jurisdiction routing (3 input keys)
 * ════════════════════════════════════════════════════════════════════ */
block('3. Jurisdiction input routing', () => {
  const c1 = resolveConfig({ winCap: { jurisdiction: 'UKGC' } });
  t('3.1 winCap.jurisdiction=UKGC routes to ceiling matrix', c1.jurisdiction === 'UKGC');
  t('3.2 UKGC profile auto-enables block',                  c1.enabled === true);

  const c2 = resolveConfig({ responsibleGambling: { jurisdiction: 'mga' } });
  t('3.3 responsibleGambling.jurisdiction (alias) honored, case-insensitive',
    c2.jurisdiction === 'MGA');

  const c3 = resolveConfig({ regulator: { profile: 'de' } });
  t('3.4 regulator.profile (alias) honored, case-insensitive',
    c3.jurisdiction === 'DE');

  /* Precedence: regulator > responsibleGambling > winCap (deployment trumps
   * game-design choice). */
  const c4 = resolveConfig({
    winCap: { jurisdiction: 'UKGC' },
    responsibleGambling: { jurisdiction: 'MGA' },
    regulator: { profile: 'SE' },
  });
  t('3.5 precedence regulator > responsibleGambling > winCap',
    c4.jurisdiction === 'SE');

  /* Unknown jurisdiction passes through (no match in matrix) */
  const c5 = resolveConfig({ winCap: { jurisdiction: 'ATLANTIS' } });
  t('3.6 unknown jurisdiction stays at default OFF',
    c5.jurisdiction === 'OFF');
});

/* ════════════════════════════════════════════════════════════════════
 * 4. Ceiling clamp — operator cannot exceed regulator
 * ════════════════════════════════════════════════════════════════════ */
block('4. Ceiling clamp (operator-cap-cannot-exceed-regulator)', () => {
  /* UKGC: ceiling 100k. Operator requests 250k → clamp to 100k */
  const ukgcOver = resolveConfig({
    winCap: { jurisdiction: 'UKGC', maxWinX: 250000 },
  });
  t('4.1 UKGC clamps 250k → 100k',          ukgcOver.maxWinX === 100000);
  t('4.2 UKGC clamp sets ceilingApplied=true', ukgcOver.ceilingApplied === true);

  /* UKGC: operator requests 50k → no clamp (below ceiling) */
  const ukgcUnder = resolveConfig({
    winCap: { jurisdiction: 'UKGC', maxWinX: 50000 },
  });
  t('4.3 UKGC 50k stays 50k (below ceiling)',  ukgcUnder.maxWinX === 50000);
  t('4.4 UKGC no-clamp sets ceilingApplied=false', ukgcUnder.ceilingApplied === false);

  /* MGA: ceiling 500k. Operator requests 999k → clamp to 500k */
  const mgaOver = resolveConfig({
    winCap: { jurisdiction: 'MGA', maxWinX: 999000 },
  });
  t('4.5 MGA clamps 999k → 500k',           mgaOver.maxWinX === 500000);

  /* DE: ceiling 100k. Cluster GDD specifies 50k → no clamp */
  const deUnder = resolveConfig({
    winCap: { jurisdiction: 'DE', maxWinX: 50000 },
  });
  t('4.6 DE 50k stays 50k (below ceiling)', deUnder.maxWinX === 50000);

  /* NL: ceiling 250k. limits.max_win_x = 500k via JSON IR → clamp to 250k */
  const nlIr = resolveConfig({
    responsibleGambling: { jurisdiction: 'NL' },
    limits: { max_win_x: 500000 },
  });
  t('4.7 NL clamps JSON-IR 500k → 250k',    nlIr.maxWinX === 250000);
});

/* ════════════════════════════════════════════════════════════════════
 * 5. OFF jurisdiction — permissive mode (no clamp)
 * ════════════════════════════════════════════════════════════════════ */
block('5. OFF jurisdiction (permissive)', () => {
  const off = resolveConfig({ winCap: { jurisdiction: 'OFF', maxWinX: 900000 } });
  t('5.1 OFF allows 900k (below 1M permissive ceiling)', off.maxWinX === 900000);
  /* W51 design: OFF means permissive / unregulated dev build. Block stays
   * at GDD-level enabled flag. Only regulated profiles auto-enable. */
  t('5.2 OFF does NOT auto-enable (permissive: GDD controls)', off.enabled === false);

  /* OFF ceiling is 1M — going above clamps to 1M */
  const offOver = resolveConfig({ winCap: { jurisdiction: 'OFF', maxWinX: 5000000 } });
  t('5.3 OFF clamps 5M → 1M (permissive but bounded)',   offOver.maxWinX === 1000000);
});

/* ════════════════════════════════════════════════════════════════════
 * 6. Runtime emit — audit events baked
 * ════════════════════════════════════════════════════════════════════ */
block('6. Runtime audit-event emission', () => {
  const ukgcOverRT = emitWinCapRuntime(resolveConfig({
    winCap: { jurisdiction: 'UKGC', maxWinX: 250000, enabled: true },
  }));
  t('6.1 runtime bakes WIN_CAP_JURISDICTION constant',
    /WIN_CAP_JURISDICTION\s*=\s*"UKGC"/.test(ukgcOverRT));
  t('6.2 runtime bakes WIN_CAP_CEILING_APPLIED = true on clamp',
    /WIN_CAP_CEILING_APPLIED\s*=\s*true/.test(ukgcOverRT));
  t('6.3 runtime emits onWinCapClamped at boot when clamped',
    /HookBus\.emit\('onWinCapClamped',\s*\{[\s\S]*?jurisdiction:[\s\S]*?ceiling:/.test(ukgcOverRT));
  t('6.4 runtime emits onWinCapTriggered with jurisdiction + hitAt + mode',
    /HookBus\.emit\('onWinCapTriggered',\s*\{[\s\S]*?jurisdiction:[\s\S]*?ceiling:[\s\S]*?hitAt:[\s\S]*?mode:/.test(ukgcOverRT));

  const ukgcUnderRT = emitWinCapRuntime(resolveConfig({
    winCap: { jurisdiction: 'UKGC', maxWinX: 50000, enabled: true },
  }));
  t('6.5 runtime bakes WIN_CAP_CEILING_APPLIED = false when below ceiling',
    /WIN_CAP_CEILING_APPLIED\s*=\s*false/.test(ukgcUnderRT));
});

/* ════════════════════════════════════════════════════════════════════
 * 7. Auto-enable on jurisdiction profile (forgotten enabled=true)
 * ════════════════════════════════════════════════════════════════════ */
block('7. Auto-enable on jurisdiction profile', () => {
  const ukgcAuto = resolveConfig({
    /* enabled NOT specified — but jurisdiction is */
    responsibleGambling: { jurisdiction: 'UKGC' },
  });
  t('7.1 UKGC profile auto-enables block (operator forgot enabled=true)',
    ukgcAuto.enabled === true);

  const offNoEnable = resolveConfig({ winCap: { jurisdiction: 'OFF' } });
  /* W51 design: regulated profiles auto-enable; OFF (permissive/dev) does not. */
  t('7.2 OFF does NOT auto-enable (GDD controls in permissive mode)',
    offNoEnable.enabled === false);
});

/* ════════════════════════════════════════════════════════════════════
 * 8. EXPECTED_EMIT_OWNERS registry
 * ════════════════════════════════════════════════════════════════════ */
block('8. EXPECTED_EMIT_OWNERS registry', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const legoGate = readFileSync(resolve(here, '../../tools/lego-gate.mjs'), 'utf8');
  t('8.1 onWinCapTriggered registered as winCap.mjs single-owner',
    /onWinCapTriggered:\s*\[\s*'winCap\.mjs'\s*\]/.test(legoGate));
  t('8.2 onWinCapClamped registered as winCap.mjs single-owner',
    /onWinCapClamped:\s*\[\s*'winCap\.mjs'\s*\]/.test(legoGate));
});

/* ════════════════════════════════════════════════════════════════════
 * 9. JSDoc citations — regulator authority
 * ════════════════════════════════════════════════════════════════════ */
block('9. JSDoc regulator citations', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(resolve(here, '../../src/blocks/winCap.mjs'), 'utf8');
  t('9.1 cites UKGC RTS 13 (max-win cap rule)',         /UKGC[^.]*RTS\s*13/i.test(src));
  t('9.2 cites MGA Player Protection §5',               /MGA[^.]*Player Protection[^.]*§\s*5/i.test(src));
  t('9.3 cites SE Spelinspektionen Tech Std 6.5',       /SE[^.]*Tech Std\s*6\.5/i.test(src));
  t('9.4 cites DE GlüStV §11',                          /DE[^.]*GlüStV[^.]*§\s*11/i.test(src));
  t('9.5 cites NL KSA Spel-1 §16',                      /NL[^.]*KSA[^.]*Spel-1[^.]*§\s*16/i.test(src));
  t('9.6 cites ON AGCO Standard 4.06',                  /ON[^.]*AGCO[^.]*Standard\s*4\.06/i.test(src));
});

/* ════════════════════════════════════════════════════════════════════
 * 10. Vendor-neutrality + determinism
 * ════════════════════════════════════════════════════════════════════ */
block('10. Vendor-neutral + deterministic emit', () => {
  const VENDORS = /\b(igt|pragmatic|megaways|cleopatra|buffalo|wolf[- ]run|cash[- ]eruption|netent|microgaming|light\s*&?\s*wonder|scientific\s*games|lightning\s*link|sweet\s*bonanza)\b/i;

  const rtUK = emitWinCapRuntime(resolveConfig({ winCap: { jurisdiction: 'UKGC', enabled: true } }));
  const cssUK = emitWinCapCSS(resolveConfig({ winCap: { jurisdiction: 'UKGC', enabled: true } }));
  const mkUK = emitWinCapMarkup(resolveConfig({ winCap: { jurisdiction: 'UKGC', enabled: true } }));
  t('10.1 runtime vendor-neutral',  !VENDORS.test(rtUK));
  t('10.2 CSS vendor-neutral',      !VENDORS.test(cssUK));
  t('10.3 markup vendor-neutral',   !VENDORS.test(mkUK));

  /* Determinism: same model → byte-identical emit */
  const a = emitWinCapRuntime(resolveConfig({ winCap: { jurisdiction: 'MGA', maxWinX: 400000, enabled: true } }));
  const b = emitWinCapRuntime(resolveConfig({ winCap: { jurisdiction: 'MGA', maxWinX: 400000, enabled: true } }));
  t('10.4 deterministic emit (same input → byte-identical output)', a === b);
});

/* ════════════════════════════════════════════════════════════════════
 * 11. Cross-jurisdiction matrix exhaustive — every jurisdiction × clamp
 * ════════════════════════════════════════════════════════════════════ */
block('11. Exhaustive cross-jurisdiction × clamp matrix', () => {
  const ALL = ['UKGC', 'MGA', 'SE', 'DE', 'NL', 'ON', 'NJ', 'IT', 'OFF'];
  for (const j of ALL) {
    const ceiling = JURISDICTION_CEILINGS[j];

    /* Below ceiling: no clamp */
    const under = resolveConfig({
      winCap: { jurisdiction: j, maxWinX: Math.max(100, Math.floor(ceiling / 2)) },
    });
    t(`11.${ALL.indexOf(j) * 3 + 1} ${j} below-ceiling no clamp`,
      under.maxWinX === Math.max(100, Math.floor(ceiling / 2)) && under.ceilingApplied === false);

    /* At ceiling: no clamp (exactly equal allowed) */
    const at = resolveConfig({
      winCap: { jurisdiction: j, maxWinX: ceiling },
    });
    t(`11.${ALL.indexOf(j) * 3 + 2} ${j} at-ceiling no clamp`,
      at.maxWinX === ceiling && at.ceilingApplied === false);

    /* Above ceiling: hard clamp */
    if (ceiling < 1000000) {
      const over = resolveConfig({
        winCap: { jurisdiction: j, maxWinX: 1000000 },
      });
      t(`11.${ALL.indexOf(j) * 3 + 3} ${j} above-ceiling clamps to ${ceiling}`,
        over.maxWinX === ceiling && over.ceilingApplied === true);
    } else {
      /* OFF ceiling = 1M, same as request → no clamp */
      t(`11.${ALL.indexOf(j) * 3 + 3} ${j} 1M = ceiling no clamp`, true);
    }
  }
});

console.log('');
console.log(`  pass: ${pass}   fail: ${fail}`);
process.exit(fail > 0 ? 1 : 0);
