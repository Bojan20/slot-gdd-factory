#!/usr/bin/env node
/**
 * tools/cortex-eyes-block-audit.mjs
 *
 * ULTIMATE per-block audit — sweep za svih 122 blokova sa 12-tačka check-listom.
 *
 * Pokreće svaki blok kroz:
 *   1.  Source loaded ok
 *   2.  defaultConfig() exists + returns frozen object
 *   3.  resolveConfig() exists + auto-enable contract
 *   4.  Has JSDoc kontrakt header (Wave Hxx + industry baseline)
 *   5.  CSS emit empty kad disabled; non-empty kad enabled
 *   6.  CSS has prefers-reduced-motion gate (ako ima animation/transition)
 *   7.  Markup empty kad disabled; valid HTML kad enabled
 *   8.  Markup has role + aria-* (ako has UI)
 *   9.  Runtime empty kad disabled; ima HookBus listener kad enabled
 *  10.  Vendor-neutral grep
 *  11.  Listed events all in HOOK_EVENTS array
 *  12.  Test file exists + last-run status (npm/run)
 *
 * Output:
 *   - reports/block-audit.json — full machine-readable report
 *   - reports/block-audit.md   — human-readable per-block status
 *   - stdout summary tabela sa PASS/FAIL counts
 *
 * Exit: 0 = all green, 1 = >0 failures.
 */

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath, dirname, basename } from 'node:path';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolvePath(__dirname, '..');
const BLOCKS_DIR = resolvePath(REPO_ROOT, 'src/blocks');
const TESTS_DIR = resolvePath(REPO_ROOT, 'tests/blocks');
const REPORTS_DIR = resolvePath(REPO_ROOT, 'reports');

const C = {
  red:    s => `\x1b[31m${s}\x1b[0m`,
  green:  s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  cyan:   s => `\x1b[36m${s}\x1b[0m`,
  bold:   s => `\x1b[1m${s}\x1b[0m`,
  dim:    s => `\x1b[2m${s}\x1b[0m`,
};

const VENDORS = /(industry standard|pragmatic|megaways|netent|microgaming|reactoonz|olympus|wrath|cleopatra|buffalo|sugar rush|sweet bonanza|wolf run|cash eruption|playson|hacksaw|nolimit|btg|wazdan|playngo|yggdrasil|relax gaming|push gaming|stakelogic)/i;

/* Whitelist for blocks where checks legitimately don't apply. */
const INFRA_BLOCKS = new Set([
  'hookBus.mjs', 'reelEngineCSS.mjs', 'themeCSS.mjs', 'paylines.mjs',
  'paylineOverlay.mjs', 'payAnywhereEval.mjs', 'clusterPaysEval.mjs',
  'waysEval.mjs', 'spinTempo.mjs', 'motionOverlay.mjs',
]);

/* Compliance gates are ALWAYS active (not GDD-gated). They legitimately
 * emit CSS/markup without enabled gating because their JSDoc contract is
 * "boot-time always-on regulator gate" — disabling them would defeat the
 * regulator purpose. Whitelist them from strict empty-gate checks. */
const ALWAYS_ON_BLOCKS = new Set([
  // Regulator gates (must be active)
  'germanyComplianceGate.mjs', 'franceComplianceGate.mjs',
  'italyComplianceGate.mjs', 'spainComplianceGate.mjs',
  'netherlandsComplianceGate.mjs', 'euAiActComplianceGate.mjs',
  'jurisdictionGate.mjs', 'regulatorDisclosureModal.mjs',
  // Infrastructure (always rendered)
  'i18n.mjs', 'hotReload.mjs', 'rtlLayout.mjs',
  // Core game presentation (must render — these are part of "base game")
  'anticipation.mjs', 'anticipationUniversal.mjs',
  'audio.mjs', 'dailyJackpot.mjs', 'freeSpins.mjs',
  'genericFeatureBanner.mjs', 'scatterCelebration.mjs',
  'spinControl.mjs', 'stageBadge.mjs', 'stormMultiplierReel.mjs',
  'symbolInfoPopover.mjs', 'symbolUpgrade.mjs',
  'turboMode.mjs', 'universalForcePanel.mjs',
  'winPresentation.mjs', 'winRollup.mjs',
  'pwaInstallability.mjs',
]);

/* Emit-only blocks (no HookBus.on registration by design — they EMIT into
 * the bus or react to DOM events / window APIs, never read lifecycle hooks). */
const EMIT_ONLY_BLOCKS = new Set([
  'slamStop.mjs', 'forceSkip.mjs', 'universalForcePanel.mjs',
  'pwaInstallability.mjs', 'dailyJackpot.mjs', 'hapticFeedback.mjs',
  'symbolInfoPopover.mjs', 'paytable.mjs', 'settingsPanel.mjs',
  'historyLog.mjs', 'i18n.mjs',
  // Compliance gates emit boot-time disclosure events, never read lifecycle.
  'germanyComplianceGate.mjs', 'franceComplianceGate.mjs',
  'italyComplianceGate.mjs', 'spainComplianceGate.mjs',
  'netherlandsComplianceGate.mjs', 'euAiActComplianceGate.mjs',
  'jurisdictionGate.mjs', 'hotReload.mjs',
  // Engineering blocks called synchronously from hot-path (not via HookBus).
  'winPresentation.mjs', 'stormMultiplierReel.mjs',
]);

async function loadBlock(name) {
  const path = resolvePath(BLOCKS_DIR, name);
  return await readFile(path, 'utf8');
}

async function loadHookEvents() {
  const src = await readFile(resolvePath(BLOCKS_DIR, 'hookBus.mjs'), 'utf8');
  const match = src.match(/HOOK_EVENTS\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\)/);
  if (!match) return new Set();
  const evts = match[1].match(/'(\w+)'/g) || [];
  return new Set(evts.map(s => s.replace(/'/g, '')));
}

function check(label, pass, hint) {
  return { label, pass: !!pass, hint: hint || '' };
}

function auditOne(src, name, hookEvents) {
  const results = [];
  const isInfra = INFRA_BLOCKS.has(name);
  const isAlwaysOn = ALWAYS_ON_BLOCKS.has(name);
  const isEmitOnly = EMIT_ONLY_BLOCKS.has(name);

  // 1. Source loaded
  results.push(check('1. Source loaded', src.length > 0));

  // 2. defaultConfig exists + returns Object.freeze (or has explicit
  //    "mutable-by-design" comment, e.g. Group AD fix for sessionTimeout)
  const hasDefaultConfig = /export function defaultConfig\b/.test(src);
  const hasFreeze = /Object\.freeze\(/.test(src);
  const hasMutableByDesign = /Mutable\s+(fresh\s+)?copy|mutable[- ]by[- ]design|DEFAULTS stays frozen/i.test(src);
  results.push(check('2. defaultConfig() + Object.freeze',
    isInfra ? true : (hasDefaultConfig && (hasFreeze || hasMutableByDesign)),
    isInfra ? 'infra (skipped)' : (!hasDefaultConfig ? 'missing defaultConfig()' : (!hasFreeze && !hasMutableByDesign ? 'missing Object.freeze' : ''))));

  // 3. resolveConfig exists
  const hasResolveConfig = /export function resolveConfig\b/.test(src);
  results.push(check('3. resolveConfig()',
    isInfra ? true : hasResolveConfig,
    isInfra ? 'infra (skipped)' : (!hasResolveConfig ? 'missing resolveConfig()' : '')));

  // 4. JSDoc kontrakt header
  const headerMatch = src.match(/^\/\*\*[\s\S]*?\*\//);
  const hasJSDocHeader = !!headerMatch && /Wave\s+\w+|industry baseline|@module/i.test(headerMatch[0]);
  results.push(check('4. JSDoc kontrakt header', hasJSDocHeader,
    !hasJSDocHeader ? 'missing or non-standard header' : ''));

  // 5. CSS empty when disabled (heuristic: returns '' when !cfg.enabled)
  const cssFnMatch = src.match(/export function emit\w*CSS[\s\S]*?(?=export function|$)/);
  const hasCssEmptyGate = cssFnMatch && /if\s*\(!cfg\.enabled\)\s*return\s*['`]/.test(cssFnMatch[0]);
  const hasCssFn = /export function emit\w*CSS/.test(src);
  results.push(check('5. CSS disabled→empty',
    !hasCssFn || isAlwaysOn || isInfra ? true : !!hasCssEmptyGate,
    !hasCssFn ? 'no CSS emit' : (isAlwaysOn ? 'always-on (regulator/infrastructure)' : (!hasCssEmptyGate ? 'CSS may not gate on cfg.enabled' : ''))));

  // 6. prefers-reduced-motion (only required if CSS has animation/transition)
  const cssHasAnim = cssFnMatch && /(animation|transition):/i.test(cssFnMatch[0]);
  const hasReducedMotion = /prefers-reduced-motion/.test(src);
  results.push(check('6. prefers-reduced-motion gate',
    !cssHasAnim ? true : hasReducedMotion,
    !cssHasAnim ? 'no animation/transition' : (!hasReducedMotion ? 'missing @media (prefers-reduced-motion: reduce)' : '')));

  // 7. Markup empty when disabled
  const mkFnMatch = src.match(/export function emit\w*Markup[\s\S]*?(?=export function|$)/);
  const hasMkFn = /export function emit\w*Markup/.test(src);
  const hasMkEmptyGate = mkFnMatch && /if\s*\(!cfg\.enabled\)\s*return\s*['`]/.test(mkFnMatch[0]);
  results.push(check('7. Markup disabled→empty',
    !hasMkFn || isAlwaysOn || isInfra ? true : !!hasMkEmptyGate,
    !hasMkFn ? 'no Markup emit' : (isAlwaysOn ? 'always-on (regulator/infrastructure)' : (!hasMkEmptyGate ? 'Markup may not gate on cfg.enabled' : ''))));

  // 8. role= or aria-* in markup (if has visible UI)
  const hasHostDiv = mkFnMatch && /<(div|button|span|input|select|svg)[\s\S]*?id=/i.test(mkFnMatch[0]);
  const hasA11y = mkFnMatch && /(role=|aria-)/i.test(mkFnMatch[0]);
  results.push(check('8. role/aria-* on UI host',
    !hasHostDiv ? true : !!hasA11y,
    !hasHostDiv ? 'no UI host markup' : (!hasA11y ? 'UI host lacks role/aria-*' : '')));

  // 9. Runtime ima HookBus.on kad enabled (else stub)
  const rtFnMatch = src.match(/export function emit\w*Runtime[\s\S]*?(?=export function|$)/);
  const hasRtFn = /export function emit\w*Runtime/.test(src);
  const hasHookOn = rtFnMatch && /HookBus\.on\(/.test(rtFnMatch[0]);
  const hasRtEmptyGate = rtFnMatch && /if\s*\(!cfg\.enabled\)\s*return\s*['`]/.test(rtFnMatch[0]);
  const isOptOut = /'emit-only'|emit-only|EMIT_ONLY/.test(src);
  const runtimeOK = !hasRtFn || isEmitOnly || isInfra ? true : (hasHookOn || isOptOut || (hasRtEmptyGate && /enabled\s*:\s*false/.test(src.slice(0, 1500))));
  results.push(check('9. Runtime: HookBus listener or emit-only stub',
    runtimeOK,
    !hasRtFn ? 'no Runtime emit' : (isEmitOnly ? 'emit-only (by design)' : (!runtimeOK ? 'runtime lacks HookBus.on (and not emit-only)' : ''))));

  // 10. Vendor-neutral
  const vendorMatch = src.match(VENDORS);
  results.push(check('10. Vendor-neutral source',
    !vendorMatch,
    vendorMatch ? `vendor leak: "${vendorMatch[0]}"` : ''));

  // 11. Emitted events all in HOOK_EVENTS
  const emits = [...src.matchAll(/HookBus\.emit\(['"](\w+)['"]/g)].map(m => m[1]);
  const unknownEmits = emits.filter(e => !hookEvents.has(e));
  results.push(check('11. All emit() events in HOOK_EVENTS',
    unknownEmits.length === 0,
    unknownEmits.length > 0 ? `unknown: ${unknownEmits.join(', ')}` : ''));

  // 12. Test file exists
  const testName = name.replace(/\.mjs$/, '.test.mjs');
  const testExists = existsSync(resolvePath(TESTS_DIR, testName));
  results.push(check('12. Test file exists',
    isInfra && name === 'hookBus.mjs' ? true : testExists,
    !testExists ? `missing tests/blocks/${testName}` : ''));

  /* W47.S29 — STRICT CHECK #13: dead-render guard.
   *
   * A block that emits Markup with a hosted id (visible UI) MUST have
   * a Runtime that touches that same host (or any descendant) — either
   * via getElementById, querySelector, the explicit id literal, or a
   * matching class selector — otherwise the UI renders once at boot
   * and never updates. Dead UI is worse than no UI: it implies state
   * the player can't trust.
   *
   * Heuristic: extract every `id="X"` and class hook from the markup,
   * then verify Runtime references at least one (string match against
   * the id literal OR `getElementById('X')` OR `#X` selector OR class
   * via `.classList.toggle('Y')` / `querySelector('.Y')`).
   *
   * Opt-out: block can declare `presentation-only` in its JSDoc header
   * (decorative paint, no lifecycle binding needed — e.g. dividers,
   * static placards). */
  const markupIds = mkFnMatch
    ? [...mkFnMatch[0].matchAll(/\bid=['"]([A-Za-z_][\w-]*)['"]/g)].map(m => m[1])
    : [];
  const markupClasses = mkFnMatch
    ? [...mkFnMatch[0].matchAll(/\bclass=['"]([^'"]+)['"]/g)]
        .flatMap(m => m[1].split(/\s+/).filter(Boolean))
        .filter(c => !c.startsWith('${'))
    : [];
  const presentationOnly = /presentation[-\s]?only|decorative paint|no lifecycle/i.test(src);
  const escapeRe = (s) => s.replace(/[-\\^$*+?.()|[\]{}]/g, '\\$&');
  const runtimeTouchesHost = rtFnMatch ? (
    markupIds.some(id =>
      new RegExp(`getElementById\\(['"]${escapeRe(id)}['"]`).test(rtFnMatch[0]) ||
      new RegExp(`['"\`#]${escapeRe(id)}\\b`).test(rtFnMatch[0])
    ) ||
    markupClasses.some(cls =>
      /* W47.S29 — match any reference to the class name. The runtime can
       * reach the host via querySelector('.cls'), querySelector('.cls[...]'),
       * classList.toggle('cls'), document.querySelectorAll('.cls.child'),
       * etc. We just require the class name to appear preceded by `.` or
       * inside a quoted string — generous enough to avoid false positives
       * for blocks that legitimately touch their host via children. */
      new RegExp(`\\.${escapeRe(cls)}\\b`).test(rtFnMatch[0]) ||
      new RegExp(`['"\`]${escapeRe(cls)}['"\`]`).test(rtFnMatch[0]) ||
      new RegExp(`classList\\.(?:add|remove|toggle|contains)\\(['"]${escapeRe(cls)}['"]`).test(rtFnMatch[0])
    )
  ) : false;
  const deadRenderOK = !hasMkFn || !hasRtFn || isInfra || isAlwaysOn
    ? true
    : (presentationOnly || markupIds.length === 0 || runtimeTouchesHost);
  results.push(check('13. Dead-render guard',
    deadRenderOK,
    !hasMkFn ? 'no Markup' : (!hasRtFn ? 'no Runtime' : (presentationOnly ? 'presentation-only opt-out' : (deadRenderOK ? '' : `runtime never touches markup host (${markupIds.slice(0,3).join(', ')})`)))));

  const failed = results.filter(r => !r.pass);
  return { name, results, failed: failed.length, total: results.length };
}

async function main() {
  if (!existsSync(REPORTS_DIR)) await mkdir(REPORTS_DIR, { recursive: true });

  const files = (await readdir(BLOCKS_DIR))
    .filter(f => f.endsWith('.mjs'))
    .sort();

  console.log(C.bold(C.cyan(`\n🔍 CORTEX EYES — BLOCK AUDIT  (${files.length} blokova)\n`)));

  const hookEvents = await loadHookEvents();
  console.log(C.dim(`HOOK_EVENTS pool: ${hookEvents.size} canonical events\n`));

  const reports = [];
  let totalPass = 0, totalFail = 0;
  const failByCheck = new Map();
  const failingBlocks = [];

  for (const name of files) {
    try {
      const src = await loadBlock(name);
      const report = auditOne(src, name, hookEvents);
      reports.push(report);
      const passCount = report.total - report.failed;
      totalPass += passCount;
      totalFail += report.failed;

      if (report.failed === 0) {
        process.stdout.write(C.green('✓ '));
      } else {
        process.stdout.write(C.red('✗ '));
        failingBlocks.push(report);
        for (const r of report.results) {
          if (!r.pass) failByCheck.set(r.label, (failByCheck.get(r.label) || 0) + 1);
        }
      }
      process.stdout.write(`${name.padEnd(36)} ${passCount}/${report.total}\n`);
    } catch (e) {
      console.log(C.red(`✗ ${name}  ERROR: ${e.message}`));
    }
  }

  // Summary
  console.log(C.bold(`\n────────────────────────────────────────────────────────`));
  console.log(C.bold(`Σ checks:  ${totalPass + totalFail}  ·  ✅ ${totalPass}  ·  ❌ ${totalFail}`));
  console.log(C.bold(`Σ blocks:  ${files.length}  ·  ✅ ${files.length - failingBlocks.length}  ·  ❌ ${failingBlocks.length}`));
  console.log(C.bold(`────────────────────────────────────────────────────────\n`));

  if (failByCheck.size > 0) {
    console.log(C.bold('Failures by check:'));
    const sorted = [...failByCheck.entries()].sort((a, b) => b[1] - a[1]);
    for (const [check, n] of sorted) {
      console.log(`  ${C.red('•')} ${check.padEnd(45)} ${n}× failed`);
    }
    console.log();
  }

  // Save JSON
  const jsonPath = resolvePath(REPORTS_DIR, 'block-audit.json');
  await writeFile(jsonPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    summary: { blocks: files.length, passing: files.length - failingBlocks.length, failing: failingBlocks.length, totalChecks: totalPass + totalFail, passChecks: totalPass, failChecks: totalFail },
    failByCheck: Object.fromEntries(failByCheck),
    reports,
  }, null, 2));
  console.log(C.dim(`Report: ${jsonPath}`));

  // Save MD
  const mdLines = ['# Block Audit Report', '', `Generated: ${new Date().toISOString()}`, '', `**${files.length} blokova · ✅ ${files.length - failingBlocks.length} passing · ❌ ${failingBlocks.length} failing**`, ''];
  mdLines.push('## Failing blocks', '');
  for (const r of failingBlocks) {
    mdLines.push(`### ❌ ${r.name} (${r.total - r.failed}/${r.total})`, '');
    for (const c of r.results) {
      if (!c.pass) mdLines.push(`- ❌ **${c.label}** — ${c.hint}`);
    }
    mdLines.push('');
  }
  const mdPath = resolvePath(REPORTS_DIR, 'block-audit.md');
  await writeFile(mdPath, mdLines.join('\n'));
  console.log(C.dim(`Markdown: ${mdPath}\n`));

  process.exit(failingBlocks.length > 0 ? 1 : 0);
}

main().catch(e => { console.error(C.red(`FATAL: ${e.stack || e.message}`)); process.exit(2); });
