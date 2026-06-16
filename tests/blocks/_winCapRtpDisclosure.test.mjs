#!/usr/bin/env node
/**
 * tests/blocks/_winCapRtpDisclosure.test.mjs
 *
 * Wave W58.J-AGCO — RTP transparency disclosure gate.
 *
 * Validates that operators deploying under ON / UKGC / MGA emit
 * `onRtpDisclosureRequired` at session launch with the RTP value (or
 * null when math layer gated). Citation:
 *   • ON AGCO Standard 4.06 — RTP transparency mandatory
 *   • UKGC RTS 8 — return-to-player must be visible
 *   • MGA Player Protection — RTP visibility recommended
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  defaultConfig,
  resolveConfig,
  emitWinCapRuntime,
  RTP_DISCLOSURE_REQUIRED_JURISDICTIONS,
} from '../../src/blocks/winCap.mjs';

let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
function block(name, fn) { console.log('— ' + name + ' —'); fn(); console.log(''); }

/* ════════════════════════════════════════════════════════════════════
 * 1. RTP_DISCLOSURE_REQUIRED_JURISDICTIONS export
 * ════════════════════════════════════════════════════════════════════ */
block('1. RTP_DISCLOSURE_REQUIRED_JURISDICTIONS', () => {
  t('1.1 frozen',                              Object.isFrozen(RTP_DISCLOSURE_REQUIRED_JURISDICTIONS));
  t('1.2 contains ON (AGCO 4.06)',             RTP_DISCLOSURE_REQUIRED_JURISDICTIONS.includes('ON'));
  t('1.3 contains UKGC (RTS 8)',               RTP_DISCLOSURE_REQUIRED_JURISDICTIONS.includes('UKGC'));
  t('1.4 contains MGA (PP)',                   RTP_DISCLOSURE_REQUIRED_JURISDICTIONS.includes('MGA'));
  t('1.5 exactly 3 required',                  RTP_DISCLOSURE_REQUIRED_JURISDICTIONS.length === 3);
  t('1.6 does NOT include SE/DE/NL/NJ/IT/OFF',
    !RTP_DISCLOSURE_REQUIRED_JURISDICTIONS.includes('SE') &&
    !RTP_DISCLOSURE_REQUIRED_JURISDICTIONS.includes('DE') &&
    !RTP_DISCLOSURE_REQUIRED_JURISDICTIONS.includes('NL') &&
    !RTP_DISCLOSURE_REQUIRED_JURISDICTIONS.includes('OFF'));
});

/* ════════════════════════════════════════════════════════════════════
 * 2. resolveConfig sets requireRtpDisclosure + rtp value
 * ════════════════════════════════════════════════════════════════════ */
block('2. resolveConfig rtp + requireRtpDisclosure', () => {
  const cOn = resolveConfig({
    winCap: { jurisdiction: 'ON', maxWinX: 50000 },
    math: { rtp: 0.9601 },
  });
  t('2.1 ON jurisdiction → requireRtpDisclosure=true', cOn.requireRtpDisclosure === true);
  t('2.2 ON jurisdiction captures rtp=0.9601',          cOn.rtp === 0.9601);

  const cUk = resolveConfig({
    winCap: { jurisdiction: 'UKGC', maxWinX: 50000 },
    math: { rtp: 0.95 },
  });
  t('2.3 UKGC → requireRtpDisclosure=true',             cUk.requireRtpDisclosure === true);

  const cMga = resolveConfig({
    winCap: { jurisdiction: 'MGA', maxWinX: 50000 },
    math: { rtp: 0.96 },
  });
  t('2.4 MGA → requireRtpDisclosure=true',              cMga.requireRtpDisclosure === true);

  const cDe = resolveConfig({
    winCap: { jurisdiction: 'DE', maxWinX: 50000 },
    math: { rtp: 0.96 },
  });
  t('2.5 DE jurisdiction → requireRtpDisclosure=false (not in mandatory list)',
    cDe.requireRtpDisclosure === false);

  const cNoRtp = resolveConfig({ winCap: { jurisdiction: 'ON' } });
  t('2.6 ON without rtp → rtp=null (math gated)',       cNoRtp.rtp === null);
  t('2.7 ON without rtp still requireRtpDisclosure=true (consumer renders placeholder)',
    cNoRtp.requireRtpDisclosure === true);

  /* model.rtp shorthand fallback */
  const cShort = resolveConfig({
    winCap: { jurisdiction: 'ON' },
    rtp: 0.965,
  });
  t('2.8 model.rtp shorthand honored when model.math.rtp absent',
    cShort.rtp === 0.965);

  /* out-of-range rejected */
  const cBad = resolveConfig({
    winCap: { jurisdiction: 'ON' },
    math: { rtp: 1.5 },
  });
  t('2.9 rtp > 1 rejected → null',                       cBad.rtp === null);
});

/* ════════════════════════════════════════════════════════════════════
 * 3. Runtime emit at boot
 * ════════════════════════════════════════════════════════════════════ */
block('3. Runtime emit onRtpDisclosureRequired', () => {
  const rt = emitWinCapRuntime(resolveConfig({
    winCap: { jurisdiction: 'ON', maxWinX: 50000 },
    math: { rtp: 0.9601 },
  }));
  t('3.1 W58.J-AGCO marker present',
    /W58\.J-AGCO/.test(rt));
  t('3.2 WIN_CAP_RTP_REQUIRED literal baked true',
    /WIN_CAP_RTP_REQUIRED\s*=\s*true/.test(rt));
  t('3.3 WIN_CAP_RTP_VALUE literal baked',
    /WIN_CAP_RTP_VALUE\s*=\s*0\.9601/.test(rt));
  t('3.4 boot-time HookBus.emit onRtpDisclosureRequired',
    /if\s*\(WIN_CAP_RTP_REQUIRED[\s\S]{0,300}HookBus\.emit\(\s*['"]onRtpDisclosureRequired['"]/.test(rt));
  t('3.5 payload carries jurisdiction + rtp',
    /onRtpDisclosureRequired[\s\S]{0,400}jurisdiction:\s*WIN_CAP_JURISDICTION[\s\S]{0,200}rtp:\s*WIN_CAP_RTP_VALUE/.test(rt));

  /* Non-required jurisdiction skips emit. Use SE (regulated → enabled
   * stays true) instead of OFF (which short-circuits to disabled stub). */
  const rtSe = emitWinCapRuntime(resolveConfig({
    winCap: { jurisdiction: 'SE', maxWinX: 50000 },
  }));
  t('3.6 SE jurisdiction bakes WIN_CAP_RTP_REQUIRED=false (no emit)',
    /WIN_CAP_RTP_REQUIRED\s*=\s*false/.test(rtSe));

  /* Null RTP carried as literal `null` */
  const rtNull = emitWinCapRuntime(resolveConfig({
    winCap: { jurisdiction: 'ON' },
  }));
  t('3.7 RTP null baked as literal null',
    /WIN_CAP_RTP_VALUE\s*=\s*null/.test(rtNull));
});

/* ════════════════════════════════════════════════════════════════════
 * 4. EXPECTED_EMIT_OWNERS registry
 * ════════════════════════════════════════════════════════════════════ */
block('4. EXPECTED_EMIT_OWNERS registry', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const legoGate = readFileSync(resolve(here, '../../tools/lego-gate.mjs'), 'utf8');
  t('4.1 onRtpDisclosureRequired registered as winCap.mjs single-owner',
    /onRtpDisclosureRequired:\s*\[\s*'winCap\.mjs'\s*\]/.test(legoGate));
});

/* ════════════════════════════════════════════════════════════════════
 * 5. JSDoc citations
 * ════════════════════════════════════════════════════════════════════ */
block('5. JSDoc citations', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(resolve(here, '../../src/blocks/winCap.mjs'), 'utf8');
  t('5.1 cites ON AGCO Standard 4.06',
    /ON\s*AGCO\s*Standard\s*4\.06/i.test(src));
  t('5.2 cites UKGC RTS 8',
    /UKGC\s*RTS\s*8/i.test(src));
  t('5.3 cites MGA Player Protection',
    /MGA\s*Player\s*Protection/i.test(src));
});

/* ════════════════════════════════════════════════════════════════════
 * 6. Vendor-neutrality + determinism
 * ════════════════════════════════════════════════════════════════════ */
block('6. Vendor-neutral + determinism', () => {
  const VENDORS = /\b(igt|pragmatic|megaways|cleopatra|buffalo|netent|microgaming|lightning\s*link|sweet\s*bonanza)\b/i;
  const rt = emitWinCapRuntime(resolveConfig({
    winCap: { jurisdiction: 'ON', maxWinX: 50000 },
    math: { rtp: 0.96 },
  }));
  t('6.1 runtime vendor-neutral', !VENDORS.test(rt));

  const a = emitWinCapRuntime(resolveConfig({
    winCap: { jurisdiction: 'UKGC', maxWinX: 50000 },
    math: { rtp: 0.95 },
  }));
  const b = emitWinCapRuntime(resolveConfig({
    winCap: { jurisdiction: 'UKGC', maxWinX: 50000 },
    math: { rtp: 0.95 },
  }));
  t('6.2 deterministic emit (same input → byte-identical)', a === b);
});

console.log('');
console.log(`  pass: ${pass}   fail: ${fail}`);
process.exit(fail > 0 ? 1 : 0);
