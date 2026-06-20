#!/usr/bin/env node
/**
 * tools/_wave-f7-smoke.mjs
 *
 * Wave F7 — Regulator cert sweep smoke (HX1-HX6 + 4 new locales).
 *
 * Checks:
 *  1. Each new gate emits runtime ONLY when jurisdiction matches.
 *  2. Each new gate emits ZERO bytes when jurisdiction is null/unrelated.
 *  3. Each new gate emits the canonical __XX_*__ window flags it advertises.
 *  4. Each new gate emits the documented HookBus audit events.
 *  5. New locale files exist and have valid JSON.
 *  6. buildSlotHTML.mjs imports all 6 new gates.
 *
 * Exit 0 = all pass, 1 = any fail.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const REPO = resolve(__dirname, '..');

const GATES = [
  {
    id: 'HX1',  module: 'src/blocks/ukgcComplianceGate.mjs',
    emitFn: 'emitUkgcComplianceGateRuntime', resolveFn: 'resolveConfig',
    jurisdiction: 'UK', wrongJur: 'DE',
    expectFlags: ['__UK_MIN_SPIN_MS__', '__UK_RTP_DISCLOSURE_REQUIRED__', '__UK_GAMSTOP_CHECK_REQUIRED__'],
    expectEvents: ['onUkRtsSpinPaceEnforced', 'onGamStopCheckRequired'],
  },
  {
    id: 'HX2',  module: 'src/blocks/swedenComplianceGate.mjs',
    emitFn: 'emitSwedenComplianceGateRuntime', resolveFn: 'resolveConfig',
    jurisdiction: 'SE', wrongJur: 'UK',
    expectFlags: ['__SE_MIN_SPIN_MS__', '__SE_AUTOPLAY_BANNED__', '__SE_SPELPAUS_CHECK_REQUIRED__'],
    expectEvents: ['onSeMinSpinPaceEnforced', 'onSeSpelpausCheckRequired'],
  },
  {
    id: 'HX3',  module: 'src/blocks/denmarkComplianceGate.mjs',
    emitFn: 'emitDenmarkComplianceGateRuntime', resolveFn: 'resolveConfig',
    jurisdiction: 'DK', wrongJur: 'IT',
    expectFlags: ['__DK_REALITY_CHECK_MS__', '__DK_LOSS_LIMIT_REQUIRED__', '__DK_ROFUS_CHECK_REQUIRED__'],
    expectEvents: ['onDkRealityCheckEnforced', 'onDkRofusCheckRequired'],
  },
  {
    id: 'HX4',  module: 'src/blocks/belgiumComplianceGate.mjs',
    emitFn: 'emitBelgiumComplianceGateRuntime', resolveFn: 'resolveConfig',
    jurisdiction: 'BE', wrongJur: 'FR',
    expectFlags: ['__BE_EPIS_CHECK_REQUIRED__', '__BE_UNDER21_WEEKLY_CAP_EUR__', '__BE_COOLING_OFF_REQUIRED__'],
    expectEvents: ['onBeEpisCheckRequired', 'onBeUnder21CapEnforced'],
  },
  {
    id: 'HX5',  module: 'src/blocks/switzerlandComplianceGate.mjs',
    emitFn: 'emitSwitzerlandComplianceGateRuntime', resolveFn: 'resolveConfig',
    jurisdiction: 'CH', wrongJur: 'ES',
    expectFlags: ['__CH_WHITELIST_REQUIRED__', '__CH_REALITY_CHECK_MS__', '__CH_CANTON_RESTRICTION__'],
    expectEvents: ['onChWhitelistRequired', 'onChCantonRestrictionEnforced'],
  },
  {
    id: 'HX6',  module: 'src/blocks/romaniaComplianceGate.mjs',
    emitFn: 'emitRomaniaComplianceGateRuntime', resolveFn: 'resolveConfig',
    jurisdiction: 'RO', wrongJur: 'NL',
    expectFlags: ['__RO_WIN_TAX_PCT__', '__RO_LIMITS_REQUIRED__', '__RO_HANDPAY_THRESHOLD_RON__'],
    expectEvents: ['onRoWinTaxDisclosureEnforced', 'onRoHandpayThresholdEnforced'],
  },
];

const NEW_LOCALES = ['sv', 'da', 'de', 'nl'];

async function main() {
  let pass = 0, fail = 0;
  const failures = [];

  /* 1-4. Per-gate runtime emit checks */
  for (const g of GATES) {
    const mod = await import(resolve(REPO, g.module));
    const emitFn = mod[g.emitFn];
    const resolveFn = mod[g.resolveFn];

    /* Auto-enable when jurisdiction matches */
    const cfgOn = resolveFn({ regulator: { profile: g.jurisdiction } });
    const runtimeOn = emitFn(cfgOn);
    /* Auto-disabled (0 bytes) when jurisdiction is wrong */
    const cfgOff = resolveFn({ regulator: { profile: g.wrongJur } });
    const runtimeOff = emitFn(cfgOff);

    if (cfgOn.enabled) pass++; else { fail++; failures.push(`${g.id} not auto-enabled for ${g.jurisdiction}`); }
    if (!cfgOff.enabled) pass++; else { fail++; failures.push(`${g.id} wrongly enabled for ${g.wrongJur}`); }

    if (runtimeOn && runtimeOn.length > 100) pass++;
    else { fail++; failures.push(`${g.id} runtime emit suspiciously short: ${runtimeOn.length}b`); }

    if (runtimeOff === '') pass++; else { fail++; failures.push(`${g.id} runtime NOT 0-byte for wrong jurisdiction (${runtimeOff.length}b)`); }

    for (const flag of g.expectFlags) {
      if (runtimeOn.includes(flag)) pass++;
      else { fail++; failures.push(`${g.id} runtime missing flag ${flag}`); }
    }

    for (const ev of g.expectEvents) {
      if (runtimeOn.includes(ev)) pass++;
      else { fail++; failures.push(`${g.id} runtime missing HookBus event ${ev}`); }
    }
  }

  /* 5. Locale files exist + parse-able */
  for (const lang of NEW_LOCALES) {
    try {
      const txt = await readFile(resolve(REPO, `i18n/${lang}.json`), 'utf8');
      const j = JSON.parse(txt);
      if (j.source_locale === lang) pass++;
      else { fail++; failures.push(`${lang}.json source_locale !== ${lang}`); }
    } catch (e) {
      fail++; failures.push(`locale ${lang}.json missing/invalid: ${e.message}`);
    }
  }

  /* 6. buildSlotHTML imports + emits all 6 */
  const builder = await readFile(resolve(REPO, 'src/buildSlotHTML.mjs'), 'utf8');
  for (const g of GATES) {
    if (builder.includes(g.emitFn)) pass++;
    else { fail++; failures.push(`buildSlotHTML missing emit call for ${g.id} (${g.emitFn})`); }
  }

  console.log('═══ Wave F7 smoke ═══');
  console.log('  total checks:', pass + fail);
  console.log('  pass        :', pass);
  console.log('  fail        :', fail);
  if (failures.length) {
    console.log('');
    console.log('FAILING:');
    for (const f of failures) console.log('  ✗ ' + f);
  } else {
    console.log('  ✅ all checks pass');
  }

  console.log('');
  console.log('Coverage summary:');
  console.log('  EU-5 baseline       : DE · NL · EU(AI Act) · FR · IT · ES (6 existing)');
  console.log('  Wave F7 +6 markets  : UK · SE · DK · BE · CH · RO');
  console.log('  TOTAL jurisdictions : 12 (+ central jurisdictionGate)');
  console.log('  Locales             : en (existing) + sv · da · de · nl (Wave F7 seeded)');
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
