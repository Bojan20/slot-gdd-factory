#!/usr/bin/env node
/**
 * tests/blocks/_germanyIndexedDbSweep.test.mjs
 *
 * W58.J-DE.3 — §6e dopuna: IndexedDB sweep.
 *
 * W58.J-DE shipped the §6e (Speicherverbot) localStorage + sessionStorage
 * sweep. Real-world game state increasingly lives in IndexedDB (autosave
 * blobs, paytable caches, larger feature checkpoints), so a complete §6e
 * implementation must also clear matching IDB databases at boot.
 *
 * This test pins:
 *   1. Source documentation (header references W58.J-DE.3 dopuna)
 *   2. Runtime: IDB branch wrapped in typeof indexedDB !== 'undefined' guard
 *   3. Runtime: modern path uses indexedDB.databases() + deleteDatabase
 *   4. Runtime: fallback path attempts deleteDatabase per SGF prefix
 *   5. Sole-owner emit onIndexedDbCleared with full payload contract
 *   6. Behavioural sandbox covering the prefix-match predicate
 *   7. LEGO ownership matrix
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
function block(name, fn) { console.log('— ' + name + ' —'); fn(); console.log(''); }

const here = dirname(fileURLToPath(import.meta.url));
const srcPath = resolve(here, '../../src/blocks/germanyComplianceGate.mjs');
const src = readFileSync(srcPath, 'utf8');
const legoSrc = readFileSync(resolve(here, '../../tools/lego-gate.mjs'), 'utf8');

const mod = await import('../../src/blocks/germanyComplianceGate.mjs');
const { emitGermanyComplianceGateRuntime, resolveConfig, STATE_CLEAR_PREFIXES } = mod;

const enabledRt = emitGermanyComplianceGateRuntime(
  resolveConfig({ regulator: { profile: 'DE' } })
);
const clearOffRt = emitGermanyComplianceGateRuntime(
  resolveConfig({ regulator: { profile: 'DE' }, germanyComplianceGate: { clearOnBoot: false } })
);

/* ════════════════════════════════════════════════════════════════════
 * 1. Source documentation
 * ════════════════════════════════════════════════════════════════════ */
block('1. Source documentation', () => {
  t('1.1 Header notes W58.J-DE.3 dopuna',
    /W58\.J-DE\.3/.test(src));
  t('1.2 Header references IndexedDB explicitly',
    /IndexedDB/.test(src));
  t('1.3 Header references indexedDB.databases() API',
    /indexedDB\.databases\(\)/.test(src));
  t('1.4 Header notes deleteDatabase path',
    /deleteDatabase/.test(src));
  t('1.5 Header notes onIndexedDbCleared as distinct audit event',
    /onIndexedDbCleared/.test(src));
});

/* ════════════════════════════════════════════════════════════════════
 * 2. Runtime — IDB branch SSR-safe guard
 * ════════════════════════════════════════════════════════════════════ */
block('2. IDB branch SSR-safe guard', () => {
  t('2.1 typeof window.indexedDB !== undefined guard',
    /typeof\s+window\.indexedDB\s*!==\s*['"]undefined['"]/.test(enabledRt));
  t('2.2 IDB branch is INSIDE the if (CLEAR_ON_BOOT) block',
    /if\s*\(\s*CLEAR_ON_BOOT[\s\S]+window\.indexedDB[\s\S]+\}\s*\}\s*\)\s*\(\s*\)/.test(enabledRt));
  t('2.3 clearOnBoot=false → IDB branch suppressed',
    !/typeof\s+window\.indexedDB[\s\S]+_idbAttempt/.test(clearOffRt) ||
    /CLEAR_ON_BOOT\s*=\s*false/.test(clearOffRt));
});

/* ════════════════════════════════════════════════════════════════════
 * 3. Runtime — modern path uses .databases() + deleteDatabase
 * ════════════════════════════════════════════════════════════════════ */
block('3. Modern path: .databases() enumeration', () => {
  t('3.1 Checks typeof window.indexedDB.databases === function',
    /typeof\s+window\.indexedDB\.databases\s*===\s*['"]function['"]/.test(enabledRt));
  t('3.2 Enumerates database list via .databases().then()',
    /window\.indexedDB\.databases\(\)/.test(enabledRt) &&
    /listP\s*&&\s*typeof\s+listP\.then/.test(enabledRt));
  t('3.3 Iterates the returned list array',
    /for\s*\([\s\S]{0,80}list\.length/.test(enabledRt));
  t('3.4 Calls _idbPrefixMatches on each entry name',
    /_idbPrefixMatches\(list\[\w+\]\.name\)/.test(enabledRt));
  t('3.5 Deletes via window.indexedDB.deleteDatabase(name)',
    /window\.indexedDB\.deleteDatabase\(/.test(enabledRt));
  t('3.6 Awaits Promise.all of deletions',
    /Promise\.all\(deletions\)/.test(enabledRt));
});

/* ════════════════════════════════════════════════════════════════════
 * 4. Runtime — fallback path for older browsers
 * ════════════════════════════════════════════════════════════════════ */
block('4. Fallback path: best-effort delete-by-prefix-name', () => {
  t('4.1 _idbAttemptFallback function declared',
    /_idbAttemptFallback\s*=\s*function/.test(enabledRt));
  t('4.2 Fallback attempts deleteDatabase on each PREFIX entry',
    /for\s*\([\s\S]{0,80}PREFIXES\.length[\s\S]{0,200}_idbDelete\(PREFIXES\[/.test(enabledRt));
  t('4.3 Fallback uses Promise.all across prefix attempts',
    /_idbAttemptFallback[\s\S]{0,800}Promise\.all\(deletions\)/.test(enabledRt));
  t('4.4 Fallback triggers when .databases() promise rejects',
    /listP\.then\([\s\S]{0,2000}function\s*\(\s*\)\s*\{[\s\S]{0,200}_idbAttemptFallback/.test(enabledRt));
  t('4.5 _idbDelete wraps deleteDatabase in Promise with onsuccess/onerror/onblocked',
    /onsuccess[\s\S]{0,150}resolve/.test(enabledRt) &&
    /onerror[\s\S]{0,150}resolve/.test(enabledRt) &&
    /onblocked[\s\S]{0,150}resolve/.test(enabledRt));
});

/* ════════════════════════════════════════════════════════════════════
 * 5. Sole-owner emit onIndexedDbCleared
 * ════════════════════════════════════════════════════════════════════ */
block('5. Sole-owner emit + payload contract', () => {
  t('5.1 emit onIndexedDbCleared',
    /HookBus\.emit\(\s*['"]onIndexedDbCleared['"]/.test(enabledRt));
  t('5.2 emit gated on HookBus + emit fn check',
    /window\.HookBus[\s\S]{0,200}typeof\s+window\.HookBus\.emit[\s\S]{0,200}onIndexedDbCleared/.test(enabledRt));
  t('5.3 Payload includes jurisdiction',
    /onIndexedDbCleared[\s\S]{0,500}jurisdiction:/.test(enabledRt));
  t('5.4 Payload includes prefixesCleared (fresh slice)',
    /onIndexedDbCleared[\s\S]{0,500}prefixesCleared:\s*PREFIXES\.slice\(\)/.test(enabledRt));
  t('5.5 Payload includes count (deleted DB count)',
    /onIndexedDbCleared[\s\S]{0,500}count:/.test(enabledRt));
  t('5.6 Payload cites DE-GluStV-2021-§6e rule',
    /onIndexedDbCleared[\s\S]{0,500}DE-GluStV-2021-§6e/.test(enabledRt));
  t('5.7 Emit wrapped in try/catch (audit must never throw)',
    /try\s*\{[\s\S]{0,400}onIndexedDbCleared[\s\S]{0,400}\}\s*catch/.test(enabledRt));
  t('5.8 Emit fires AFTER Promise resolution (count is accurate)',
    /Promise\.all\(deletions\)\.then\(function\s*\(\s*results\s*\)[\s\S]{0,500}_idbFinalize\(ok\)/.test(enabledRt));
});

/* ════════════════════════════════════════════════════════════════════
 * 6. Behavioural sandbox — prefix-match predicate
 * ════════════════════════════════════════════════════════════════════ */
block('6. Prefix-match predicate sandbox', () => {
  /* Re-implement the predicate. A DB name matches iff its name starts
   * with one of the SGF prefixes. */
  function matches(name, prefixes) {
    if (typeof name !== 'string') return false;
    for (var i = 0; i < prefixes.length; i++) {
      if (name.indexOf(prefixes[i]) === 0) return true;
    }
    return false;
  }
  const P = STATE_CLEAR_PREFIXES.slice();

  t('6.1 __SLOT_main_session matches __SLOT_',  matches('__SLOT_main_session', P) === true);
  t('6.2 __FS_intro_state matches __FS_',        matches('__FS_intro_state', P) === true);
  t('6.3 __HW_orb_lock matches __HW_',           matches('__HW_orb_lock', P) === true);
  t('6.4 __BB_plant matches __BB_',              matches('__BB_plant', P) === true);
  t('6.5 __RC_timer matches __RC_',              matches('__RC_timer', P) === true);
  t('6.6 __BG_jackpot matches __BG_',            matches('__BG_jackpot', P) === true);
  t('6.7 operator_session NO match (no SGF prefix)',
    matches('operator_session', P) === false);
  t('6.8 SLOT_no_prefix NO match (missing leading __)',
    matches('SLOT_no_prefix', P) === false);
  t('6.9 prefix-substring-not-at-start NO match',
    matches('xx__SLOT_xx', P) === false);
  t('6.10 non-string DB name NO match',           matches(null, P) === false);
  t('6.11 number DB name NO match',               matches(42, P) === false);
});

/* ════════════════════════════════════════════════════════════════════
 * 7. LEGO contracts
 * ════════════════════════════════════════════════════════════════════ */
block('7. LEGO contracts', () => {
  t('7.1 onIndexedDbCleared owner declared: germanyComplianceGate.mjs',
    /onIndexedDbCleared:\s*\[\s*['"]germanyComplianceGate\.mjs['"]\s*\]/.test(legoSrc));
  t('7.2 W58.J-DE.3 marker comment in lego-gate.mjs',
    /W58\.J-DE\.3/.test(legoSrc));
  t('7.3 IndexedDB / IDB citation in lego-gate.mjs',
    /IndexedDB|IDB/.test(legoSrc));
});

/* ════════════════════════════════════════════════════════════════════
 * 8. Honest scope
 * ════════════════════════════════════════════════════════════════════ */
block('8. Honest scope', () => {
  t('8.1 Source notes async branch does NOT block boot',
    /async/i.test(src) && /(does not await|never block|never blocks|don[\'t]?\s*await|do\s+not\s+await|DO\s+NOT\s+await)/i.test(src));
  t('8.2 Source notes browser-compat fallback (older Safari / FF < 126)',
    /(Safari|Firefox|older browser)/i.test(src));
  t('8.3 Source notes count fires AFTER promise resolution',
    /AFTER the Promise chain resolves/i.test(src));
});

console.log('');
console.log(`  pass: ${pass}   fail: ${fail}`);
process.exit(fail > 0 ? 1 : 0);
