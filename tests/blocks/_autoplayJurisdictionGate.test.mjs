#!/usr/bin/env node
/**
 * tests/blocks/_autoplayJurisdictionGate.test.mjs
 *
 * Wave W58.J-UKGC — autoplay cross-jurisdiction disclosure gate.
 *
 * Validates that operators deploying under UKGC / ON / MGA MUST
 * surface a stop-condition disclosure modal (via
 * onAutoplayDisclosureRequired) before autoplayStart() proceeds.
 * Player acknowledgement is captured via
 * window.__AUTOPLAY_DISCLOSURE_ACK__ which downstream consumer sets
 * after the modal closes.
 *
 * Citations:
 *   • UKGC LCCP 1.4.6 — autoplay disclosure mandatory
 *   • Ontario AGCO Standard 4.06 — RTP + autoplay disclosure
 *   • MGA Player Protection — autoplay disclosure recommended
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  defaultConfig,
  resolveConfig,
  emitAutoplayRuntime,
  AUTOPLAY_DISCLOSURE_REQUIRED_JURISDICTIONS,
} from '../../src/blocks/autoplay.mjs';

let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
function block(name, fn) { console.log('— ' + name + ' —'); fn(); console.log(''); }

/* ════════════════════════════════════════════════════════════════════
 * 1. AUTOPLAY_DISCLOSURE_REQUIRED_JURISDICTIONS export
 * ════════════════════════════════════════════════════════════════════ */
block('1. Disclosure-required jurisdictions export', () => {
  t('1.1 export is frozen',                  Object.isFrozen(AUTOPLAY_DISCLOSURE_REQUIRED_JURISDICTIONS));
  t('1.2 contains UKGC (LCCP 1.4.6)',        AUTOPLAY_DISCLOSURE_REQUIRED_JURISDICTIONS.includes('UKGC'));
  t('1.3 contains ON (AGCO 4.06)',           AUTOPLAY_DISCLOSURE_REQUIRED_JURISDICTIONS.includes('ON'));
  t('1.4 contains MGA (PP recommend)',       AUTOPLAY_DISCLOSURE_REQUIRED_JURISDICTIONS.includes('MGA'));
  t('1.5 exactly 3 required',                AUTOPLAY_DISCLOSURE_REQUIRED_JURISDICTIONS.length === 3);
  t('1.6 does NOT include OFF/permissive',   !AUTOPLAY_DISCLOSURE_REQUIRED_JURISDICTIONS.includes('OFF'));
  t('1.7 does NOT include SE/DE/NL (different rule path)',
    !AUTOPLAY_DISCLOSURE_REQUIRED_JURISDICTIONS.includes('SE') &&
    !AUTOPLAY_DISCLOSURE_REQUIRED_JURISDICTIONS.includes('DE') &&
    !AUTOPLAY_DISCLOSURE_REQUIRED_JURISDICTIONS.includes('NL'));
});

/* ════════════════════════════════════════════════════════════════════
 * 2. defaultConfig has jurisdiction + requireDisclosure fields
 * ════════════════════════════════════════════════════════════════════ */
block('2. Default config schema', () => {
  const c = defaultConfig();
  t('2.1 jurisdiction field exists, default empty string',
    'jurisdiction' in c && c.jurisdiction === '');
  t('2.2 requireDisclosure field exists, default false',
    'requireDisclosure' in c && c.requireDisclosure === false);
});

/* ════════════════════════════════════════════════════════════════════
 * 3. resolveConfig jurisdiction routing
 * ════════════════════════════════════════════════════════════════════ */
block('3. Jurisdiction routing (3 input keys + precedence)', () => {
  const c1 = resolveConfig({ autoplay: { jurisdiction: 'ukgc' } });
  t('3.1 autoplay.jurisdiction=ukgc → uppercased UKGC',
    c1.jurisdiction === 'UKGC');
  t('3.2 UKGC → requireDisclosure=true',
    c1.requireDisclosure === true);

  const c2 = resolveConfig({ responsibleGambling: { jurisdiction: 'ON' } });
  t('3.3 responsibleGambling.jurisdiction=ON honored',
    c2.jurisdiction === 'ON' && c2.requireDisclosure === true);

  const c3 = resolveConfig({ regulator: { profile: 'MGA' } });
  t('3.4 regulator.profile=MGA honored',
    c3.jurisdiction === 'MGA' && c3.requireDisclosure === true);

  const c4 = resolveConfig({
    autoplay: { jurisdiction: 'OFF' },
    responsibleGambling: { jurisdiction: 'SE' },
    regulator: { profile: 'UKGC' },
  });
  t('3.5 precedence regulator > responsibleGambling > autoplay',
    c4.jurisdiction === 'UKGC' && c4.requireDisclosure === true);
});

/* ════════════════════════════════════════════════════════════════════
 * 4. Non-required jurisdictions stay disclosure=false
 * ════════════════════════════════════════════════════════════════════ */
block('4. Non-required jurisdictions', () => {
  for (const j of ['SE', 'DE', 'NL', 'NJ', 'IT', 'OFF']) {
    const c = resolveConfig({ autoplay: { jurisdiction: j } });
    t(`4.${j} captured but requireDisclosure stays false`,
      c.jurisdiction === j && c.requireDisclosure === false);
  }
});

/* ════════════════════════════════════════════════════════════════════
 * 5. Explicit override (requireDisclosure=true without jurisdiction)
 * ════════════════════════════════════════════════════════════════════ */
block('5. Explicit override', () => {
  const c = resolveConfig({ autoplay: { requireDisclosure: true } });
  t('5.1 explicit requireDisclosure=true honored without jurisdiction',
    c.requireDisclosure === true && c.jurisdiction === '');
});

/* ════════════════════════════════════════════════════════════════════
 * 6. Runtime emit gate
 * ════════════════════════════════════════════════════════════════════ */
block('6. Runtime gate (autoplayStart)', () => {
  const rt = emitAutoplayRuntime(resolveConfig({
    autoplay: { enabled: true, jurisdiction: 'UKGC' },
  }));
  t('6.1 W58.J-UKGC marker present',
    /W58\.J-UKGC/.test(rt));
  t('6.2 disclosure flag literal baked',
    /var __discReq = true/.test(rt));
  t('6.3 disclosure ack check uses window flag',
    /window\.__AUTOPLAY_DISCLOSURE_ACK__\s*===\s*true/.test(rt));
  t('6.4 emits onAutoplayDisclosureRequired before active=true',
    /HookBus\.emit\('onAutoplayDisclosureRequired'/.test(rt));
  t('6.5 payload contains jurisdiction + step + 4 stop-thresholds',
    /onAutoplayDisclosureRequired[\s\S]{0,800}jurisdiction:[\s\S]{0,400}step:[\s\S]{0,400}stopOnLossAbove:[\s\S]{0,400}stopOnWinAbove:[\s\S]{0,400}stopOnBalanceBelow:[\s\S]{0,400}stopOnSingleWinX:/.test(rt));
  t('6.6 gate ABORTS autoplayStart via return when disclosure required',
    /onAutoplayDisclosureRequired[\s\S]{0,1500}\}\s*\)\s*;\s*\}\s*return\s*;/.test(rt));

  const rtPermissive = emitAutoplayRuntime(resolveConfig({
    autoplay: { enabled: true, jurisdiction: 'OFF' },
  }));
  t('6.7 OFF jurisdiction bakes __discReq = false (no gate)',
    /var __discReq = false/.test(rtPermissive));
});

/* ════════════════════════════════════════════════════════════════════
 * 7. EXPECTED_EMIT_OWNERS registry
 * ════════════════════════════════════════════════════════════════════ */
block('7. EXPECTED_EMIT_OWNERS registry', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const legoGate = readFileSync(resolve(here, '../../tools/lego-gate.mjs'), 'utf8');
  t('7.1 onAutoplayDisclosureRequired registered as autoplay.mjs single-owner',
    /onAutoplayDisclosureRequired:\s*\[\s*'autoplay\.mjs'\s*\]/.test(legoGate));
});

/* ════════════════════════════════════════════════════════════════════
 * 8. JSDoc citations
 * ════════════════════════════════════════════════════════════════════ */
block('8. JSDoc citations', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(resolve(here, '../../src/blocks/autoplay.mjs'), 'utf8');
  t('8.1 cites UKGC LCCP 1.4.6',
    /UKGC\s*LCCP[^.]*1\.4\.6/i.test(src));
  t('8.2 cites Ontario AGCO Standard 4.06',
    /(Ontario\s*AGCO|ON\s*AGCO)[^.]*Standard\s*4\.06/i.test(src));
  t('8.3 cites MGA Player Protection',
    /MGA[^.]*Player Protection/i.test(src));
});

/* ════════════════════════════════════════════════════════════════════
 * 9. Vendor-neutrality
 * ════════════════════════════════════════════════════════════════════ */
block('9. Vendor-neutrality', () => {
  const rt = emitAutoplayRuntime(resolveConfig({
    autoplay: { enabled: true, jurisdiction: 'UKGC' },
  }));
  const VENDORS = /\b(igt|pragmatic|megaways|cleopatra|buffalo|netent|microgaming|lightning\s*link|sweet\s*bonanza)\b/i;
  t('9.1 runtime vendor-neutral', !VENDORS.test(rt));
});

console.log('');
console.log(`  pass: ${pass}   fail: ${fail}`);
process.exit(fail > 0 ? 1 : 0);
