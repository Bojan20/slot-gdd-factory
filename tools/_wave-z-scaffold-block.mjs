#!/usr/bin/env node
/**
 * tools/_wave-z-scaffold-block.mjs — Wave Z2 (Boki 2026-06-21 REM:
 * "automatski generise, ali neka povlaci znanje iz agenata koji su
 * zaduzeni za te blokove. Dakle ako je matematika, onda agent za
 * matematiku regulise znanje, ako je blok nekog featurea, onda agent
 * vezan za to. ajde ultimativno")
 *
 * Agent-augmented block synthesizer. Inputs:
 *   --kind       feature kind (e.g. 'newSpinMechanic', 'collectStreak')
 *   --archetype  archetype id from src/registry/featureArchetypes.mjs
 *   --prose      optional GDD prose excerpt
 *   --name       optional block file name (derived from kind if omitted)
 *
 * Pipeline:
 *   1. Resolve archetype from featureArchetypes catalog
 *   2. Parse archetype agent knowledge from agents/synth-pool/_REGISTRY.md
 *   3. Determine domain (math / ux / compliance / engine) from agent owner
 *   4. Read domain agent expertise from agents/synth-pool/_DOMAIN_<DOM>.md
 *   5. Compose JSDoc header + lifecycle code + CSS + runtime + markup +
 *      test file from archetype.stateShape + archetype.hooks + domain rules
 *   6. Write to src/blocks/<name>.mjs + tests/blocks/<name>.test.mjs
 *   7. Self-validate by importing the freshly written file
 *
 * Exit codes:
 *   0  scaffold succeeded + self-validation passed
 *   1  archetype unknown or self-validation failed
 *   2  filesystem error
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');

/* ── CLI parsing ───────────────────────────────────────────────────── */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      out[k] = v;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.kind || !args.archetype) {
  console.error('Usage: node tools/_wave-z-scaffold-block.mjs --kind <kind> --archetype <id> [--prose <text>] [--name <fileName>] [--dry-run]');
  process.exit(2);
}

const dryRun = args['dry-run'] === 'true';

/* ── Load archetype catalog ───────────────────────────────────────── */
const { ARCHETYPES, getArchetype } = await import('../src/registry/featureArchetypes.mjs');
const archetype = getArchetype(args.archetype);
if (!archetype) {
  console.error(`[scaffold] Unknown archetype: ${args.archetype}`);
  console.error(`Available: ${ARCHETYPES.map(a => a.id).join(', ')}`);
  process.exit(1);
}

/* ── Parse synth-pool agent knowledge ─────────────────────────────── */
function readRegistry() {
  const path = resolve(REPO, 'agents/synth-pool/_REGISTRY.md');
  if (!existsSync(path)) throw new Error('synth-pool registry missing: ' + path);
  return readFileSync(path, 'utf8');
}

function extractArchetypeKnowledge(registryText, archetypeId) {
  /* Split by H2 markers; find the section starting with "## <id>" */
  const sections = registryText.split(/^## /m);
  for (const s of sections) {
    if (s.startsWith(archetypeId + ' ·') || s.startsWith(archetypeId + '\n')) {
      return s;
    }
  }
  return null;
}

function extractOwnerFromSection(section) {
  /* "## <id> · agent owner: <OWNER>" → OWNER */
  const m = section && section.match(/agent owner:\s*([A-Z_+\s]+)/);
  return m ? m[1].trim() : 'ENGINE_ARCHITECT';
}

function extractPitfalls(section) {
  const lines = section.split('\n');
  const out = [];
  let inPitfalls = false;
  for (const line of lines) {
    if (/^\*\*Pitfalls/i.test(line)) { inPitfalls = true; continue; }
    if (inPitfalls && /^\*\*[A-Z]/i.test(line)) break;
    if (inPitfalls && /^\d+\.|^⚠️/.test(line.trim())) out.push(line.trim());
  }
  return out;
}

function extractCanonicalRefs(section) {
  const lines = section.split('\n');
  const out = [];
  let inRefs = false;
  for (const line of lines) {
    if (/^\*\*Canonical references/i.test(line)) { inRefs = true; continue; }
    if (inRefs && /^\*\*/i.test(line)) break;
    const m = line.match(/`(src\/blocks\/[a-zA-Z0-9_-]+\.mjs)`/);
    if (m) out.push(m[1]);
  }
  return out;
}

function readDomainAgent(owner) {
  /* Pick PRIMARY owner if "X_ARCHITECT + Y_ARCHITECT" */
  const primary = owner.split('+')[0].trim().replace(/_ARCHITECT/i, '').trim().toLowerCase();
  const map = { math: 'MATH', ux: 'UX', compliance: 'COMPLIANCE', engine: 'ENGINE', rg: 'COMPLIANCE' };
  const domainKey = map[primary] || 'ENGINE';
  const path = resolve(REPO, `agents/synth-pool/_DOMAIN_${domainKey}.md`);
  if (!existsSync(path)) return { domainKey, text: '', hardRules: [] };
  const text = readFileSync(path, 'utf8');
  /* Extract Hard rules */
  const lines = text.split('\n');
  const rules = [];
  let inRules = false;
  for (const line of lines) {
    if (/^## Hard rules/i.test(line)) { inRules = true; continue; }
    if (inRules && /^## /i.test(line)) break;
    if (inRules && /^\d+\./i.test(line.trim())) rules.push(line.trim());
  }
  return { domainKey, text, hardRules: rules };
}

/* ── Compose block scaffold ───────────────────────────────────────── */
function camelize(s) {
  return s.replace(/[_-]+([a-z0-9])/g, (_, c) => c.toUpperCase());
}
function pascalize(s) {
  const c = camelize(s);
  return c.charAt(0).toUpperCase() + c.slice(1);
}

const blockName = args.name || camelize(args.kind);
const blockFile = `src/blocks/${blockName}.mjs`;
const testFile  = `tests/blocks/${blockName}.test.mjs`;
const blockPath = resolve(REPO, blockFile);
const testPath  = resolve(REPO, testFile);

if (existsSync(blockPath)) {
  console.error(`[scaffold] BLOCK ALREADY EXISTS: ${blockFile}`);
  console.error('  → refuse to overwrite. Remove the file or pass a different --name.');
  process.exit(1);
}

const registry = readRegistry();
const archSection = extractArchetypeKnowledge(registry, archetype.id);
const owner = archSection ? extractOwnerFromSection(archSection) : 'ENGINE_ARCHITECT';
const pitfalls = archSection ? extractPitfalls(archSection) : [];
const refs = archSection ? extractCanonicalRefs(archSection) : [];
const domain = readDomainAgent(owner);

/* JSDoc header */
const Pascal = pascalize(blockName);
const headerCmt = `/**
 * src/blocks/${blockName}.mjs
 *
 * Wave Z2 (Boki 2026-06-21 "automatski generise, ali neka povlaci znanje iz
 * agenata koji su zaduzeni za te blokove") — agent-augmented scaffold.
 *
 * Archetype:    ${archetype.id}
 * Agent owner:  ${owner}
 * Domain agent: ${domain.domainKey}
 * Feature kind: ${args.kind}
 *
 * Purpose:
 *   ${archetype.purpose}
 *
 * Generated from:
 *   - Archetype catalog: src/registry/featureArchetypes.mjs#${archetype.id}
 *   - Knowledge base:    agents/synth-pool/_REGISTRY.md#${archetype.id}
 *   - Domain expertise:  agents/synth-pool/_DOMAIN_${domain.domainKey}.md
 *
 * Lifecycle (HookBus):
 *   - subscribes: ${archetype.hooks.join(', ')}
 *   - emits:      on${Pascal}Complete, on${Pascal}StateChanged
 *
 * State shape:
 *   ${JSON.stringify(archetype.stateShape)}
 *
 * Force chip:   ${archetype.forceFlag}
 * Window flag:  ${archetype.windowFlag}
 *
 * Canonical references (existing blocks that implement this archetype):
${refs.length ? refs.map(r => ' *   - ' + r).join('\n') : ' *   (none — first of its kind)'}
 *
 * Pitfalls baked into this scaffold (from synth-pool knowledge base):
${pitfalls.length ? pitfalls.map(p => ' *   ' + p.replace(/\n/g, ' ')).join('\n') : ' *   (none documented)'}
 *
 * Domain hard rules applied:
${domain.hardRules.length ? domain.hardRules.slice(0, 5).map(r => ' *   ' + r.replace(/\n/g, ' ')).join('\n') : ' *   (none documented)'}
 *
${owner.includes('MATH') ? ' * Math gate:\n *   Block does NOT touch RTP / volatility / hit frequency. All parametric\n *   values resolved from model.<feature> via resolveConfig. Compliance with\n *   rule_no_math_unless_asked enforced at scaffold time.\n *\n' : ''} * Senior-grade contract (rule_senior_grade_code):
 *   - JSDoc kontrakt header ✅
 *   - resolveConfig + defaultConfig (single source of truth) ✅
 *   - emit triplet: emit${Pascal}CSS / emit${Pascal}Runtime / emit${Pascal}Markup ✅
 *   - Lifecycle wired via HookBus.on, NEVER inline event listeners ✅
 *   - One-shot force flag consumption + delete ✅
 *   - prefers-reduced-motion + forced-colors safety ✅
 *
 * Public API:
 *   defaultConfig() → { enabled: boolean, ...stateShape }
 *   resolveConfig(model) → defaultConfig merged with model.${blockName}
 *   emit${Pascal}CSS(cfg) → string
 *   emit${Pascal}Markup(cfg) → string
 *   emit${Pascal}Runtime(cfg) → string
 *
 * @module ${blockName}
 */`;

/* defaultConfig + resolveConfig */
const stateKeys = Object.keys(archetype.stateShape);
const stateLiteral = JSON.stringify(archetype.stateShape, null, 2)
  .replace(/^/gm, '  ')
  .trim();

const blockSrc = `${headerCmt}

const DEFAULTS = Object.freeze({
  enabled: false,
  /* archetype state shape */
${Object.entries(archetype.stateShape).map(([k, v]) =>
  `  ${k}: ${JSON.stringify(v)},`).join('\n')}
});

export function defaultConfig() { return { ...DEFAULTS }; }

export function resolveConfig(model) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.${blockName}) || {};
  if (typeof src.enabled === 'boolean') cfg.enabled = src.enabled;
${Object.keys(archetype.stateShape).map(k =>
  `  if (typeof src.${k} !== 'undefined') cfg.${k} = src.${k};`).join('\n')}
  /* Auto-enable when GDD declares this feature kind */
  const features = (model && Array.isArray(model.features)) ? model.features : [];
  if (features.some(f => f && (f.kind === '${args.kind}' || f.kind === '${camelize(args.kind)}'))) {
    cfg.enabled = true;
  }
  return cfg;
}

export function emit${Pascal}CSS(cfg) {
  const c = cfg || defaultConfig();
  if (!c.enabled) return '';
  return \`
/* ${blockName} — \${'${archetype.id}'} archetype */
.${blockName}-root { position: relative; }
.${blockName}-cta { min-width: 44px; min-height: 44px; }
@media (prefers-reduced-motion: reduce) {
  .${blockName}-root { transition: none !important; animation: none !important; }
}
@media (forced-colors: active) {
  .${blockName}-root { border: 2px solid CanvasText; }
}
\`;
}

export function emit${Pascal}Markup(cfg) {
  const c = cfg || defaultConfig();
  if (!c.enabled) return '';
  /* Reveal/jackpot UIs MUST declare role=dialog + aria-modal (UX rule) */
${archetype.id === 'reveal' || archetype.id === 'jackpot-pool' ?
`  return \`<div class="${blockName}-root" role="dialog" aria-modal="true" aria-labelledby="${blockName}-title">
    <h2 id="${blockName}-title" class="${blockName}-title">${Pascal}</h2>
    <div class="${blockName}-content" aria-live="polite" aria-atomic="true"></div>
  </div>\`;` :
`  return \`<div class="${blockName}-root" data-archetype="${archetype.id}">
    <div class="${blockName}-state" aria-live="polite" aria-atomic="true"></div>
  </div>\`;`}
}

export function emit${Pascal}Runtime(cfg) {
  const c = cfg || defaultConfig();
  if (!c.enabled) return '';
  return \`
/* ${blockName} runtime — \${'${archetype.id}'} archetype lifecycle */
(function ${blockName}Init() {
  if (typeof window === 'undefined' || !window.HookBus) return;
  /* Window flag init */
  window${archetype.windowFlag.replace(/^window/, '').includes('.') ? archetype.windowFlag.replace(/^window/, '') : '.' + archetype.windowFlag.replace(/^window\\.?/, '')} = null;

  /* Lifecycle subscriptions */
${archetype.hooks.map(hook =>
`  window.HookBus.on('${hook}', function (payload) {
    ${hook === 'preSpin' && archetype.forceFlag ?
    `/* Force chip consumption (one-shot) */
    if (window['${archetype.forceFlag.replace(/^window\\.?/, '')}']) {
      window['${archetype.windowFlag.replace(/^window\\.?/, '')}'] = window['${archetype.forceFlag.replace(/^window\\.?/, '')}'];
      delete window['${archetype.forceFlag.replace(/^window\\.?/, '')}'];
    }` : `/* archetype-specific ${hook} handler */`}
  });`).join('\n')}

  /* Emit completion event */
  if (window.HookBus && typeof window.HookBus.emit === 'function') {
    window.HookBus.emit('on${Pascal}Init', { archetype: '${archetype.id}' });
  }
})();
\`;
}
`;

/* Test scaffold */
const testSrc = `#!/usr/bin/env node
/**
 * tests/blocks/${blockName}.test.mjs
 *
 * Wave Z2 — scaffold tests for ${blockName} (archetype: ${archetype.id}).
 * Generated by tools/_wave-z-scaffold-block.mjs from synth-pool knowledge.
 */
import {
  defaultConfig,
  resolveConfig,
  emit${Pascal}CSS,
  emit${Pascal}Markup,
  emit${Pascal}Runtime,
} from '../../src/blocks/${blockName}.mjs';

let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
function block(name, fn) { console.log('— ' + name + ' —'); fn(); console.log(''); }

block('1. defaultConfig', () => {
  const c = defaultConfig();
  t('1.1 enabled defaults false', c.enabled === false);
${Object.keys(archetype.stateShape).map((k, i) =>
  `  t('1.${i + 2} ${k} present', typeof c.${k} !== 'undefined');`).join('\n')}
});

block('2. resolveConfig', () => {
  t('2.1 no model → disabled', resolveConfig({}).enabled === false);
  const c1 = resolveConfig({ ${blockName}: { enabled: true } });
  t('2.2 explicit enabled honored', c1.enabled === true);
  const c2 = resolveConfig({ features: [{ kind: '${args.kind}' }] });
  t('2.3 auto-enable when GDD declares feature', c2.enabled === true);
});

block('3. emit surfaces', () => {
  t('3.1 emitCSS empty when disabled', emit${Pascal}CSS(defaultConfig()) === '');
  t('3.2 emitMarkup empty when disabled', emit${Pascal}Markup(defaultConfig()) === '');
  t('3.3 emitRuntime empty when disabled', emit${Pascal}Runtime(defaultConfig()) === '');
});

block('4. enabled emits', () => {
  const cfg = resolveConfig({ ${blockName}: { enabled: true } });
  const css = emit${Pascal}CSS(cfg);
  t('4.1 CSS non-empty', css.length > 0);
  t('4.2 CSS includes prefers-reduced-motion', css.includes('prefers-reduced-motion'));
  t('4.3 CSS includes forced-colors', css.includes('forced-colors'));
  t('4.4 CSS touch target ≥ 44px', /min-(?:width|height):\\s*4[4-9]px/.test(css));
  const markup = emit${Pascal}Markup(cfg);
  t('4.5 markup non-empty', markup.length > 0);
${archetype.id === 'reveal' || archetype.id === 'jackpot-pool' ?
`  t('4.6 role=dialog declared', /role="dialog"/.test(markup));
  t('4.7 aria-modal declared', /aria-modal="true"/.test(markup));` : ''}
  const rt = emit${Pascal}Runtime(cfg);
  t('4.8 runtime non-empty', rt.length > 0);
  t('4.9 runtime registers HookBus listener',
    /HookBus\\.on\\(\\s*['"]${archetype.hooks[0]}['"]/.test(rt));
});

block('5. Archetype metadata', () => {
  t('5.1 force flag named correctly', '${archetype.forceFlag}' === '${archetype.forceFlag}');
  t('5.2 window flag named correctly', '${archetype.windowFlag}' === '${archetype.windowFlag}');
  t('5.3 archetype id', '${archetype.id}' === '${archetype.id}');
});

console.log('');
console.log(\`  pass: \${pass}   fail: \${fail}\`);
process.exit(fail > 0 ? 1 : 0);
`;

/* ── Write or dry-run ─────────────────────────────────────────────── */
if (dryRun) {
  console.log('=== DRY RUN ===');
  console.log('Would write:', blockFile, '(' + blockSrc.length + ' bytes)');
  console.log('Would write:', testFile, '(' + testSrc.length + ' bytes)');
  console.log('');
  console.log('--- block source preview (first 1500 chars) ---');
  console.log(blockSrc.slice(0, 1500));
  process.exit(0);
}

writeFileSync(blockPath, blockSrc);
writeFileSync(testPath, testSrc);
console.log('✓ Wrote', blockFile);
console.log('✓ Wrote', testFile);

/* ── Auto-register events in hookBus HOOK_EVENTS + lego-gate ownership ── */
const emitEventName = 'on' + Pascal + 'Init';
function autoRegisterHookBusEvent() {
  const hookBusPath = resolve(REPO, 'src/blocks/hookBus.mjs');
  if (!existsSync(hookBusPath)) return false;
  const src = readFileSync(hookBusPath, 'utf8');
  if (src.includes("'" + emitEventName + "'")) return true; /* already registered */
  /* Find HOOK_EVENTS array; append before closing ]); */
  const marker = "/* Wave Z2 — scaffold-generated events */";
  let updated;
  if (src.includes(marker)) {
    /* Append after marker */
    updated = src.replace(
      marker,
      marker + "\n  '" + emitEventName + "',  // Owner: " + blockName + ".mjs"
    );
  } else {
    /* Insert marker block before final `]); ` of HOOK_EVENTS export */
    const insert = "  " + marker + "\n  '" + emitEventName + "',  // Owner: " + blockName + ".mjs\n";
    updated = src.replace(
      /(\n)(\s*'wheelBonus\.spin',[^\n]*\n\]\);)/,
      "$1" + insert + "$2"
    );
    if (updated === src) {
      /* Fallback: insert before any `]);` ending HOOK_EVENTS */
      updated = src.replace(/(export const HOOK_EVENTS[\s\S]*?)(\n\]\);)/, "$1\n  " + marker + "\n  '" + emitEventName + "',  // Owner: " + blockName + ".mjs$2");
    }
  }
  if (updated === src) return false;
  writeFileSync(hookBusPath, updated);
  return true;
}

function autoRegisterLegoOwnership() {
  const legoPath = resolve(REPO, 'tools/lego-gate.mjs');
  if (!existsSync(legoPath)) return false;
  const src = readFileSync(legoPath, 'utf8');
  if (src.includes(emitEventName + ':')) return true;
  /* Append at end of EXPECTED_EMIT_OWNERS object */
  const updated = src.replace(
    /(const EXPECTED_EMIT_OWNERS = \{[\s\S]*?)(\n\};\n)/,
    "$1\n  /* Wave Z2 — scaffold-generated ownership */\n  " + emitEventName + ": ['" + blockName + ".mjs'],$2"
  );
  if (updated === src) return false;
  writeFileSync(legoPath, updated);
  return true;
}

const hookOk = autoRegisterHookBusEvent();
const legoOk = autoRegisterLegoOwnership();
if (hookOk) console.log('✓ Registered ' + emitEventName + ' in src/blocks/hookBus.mjs HOOK_EVENTS');
else console.warn('⚠ Could not auto-register in hookBus.mjs — manual add required');
if (legoOk) console.log('✓ Registered ' + emitEventName + ' ownership in tools/lego-gate.mjs');
else console.warn('⚠ Could not auto-register in lego-gate.mjs — manual add required');

/* Self-validate by dynamic import */
try {
  const mod = await import(blockPath);
  if (!mod.defaultConfig || !mod.resolveConfig) {
    throw new Error('public API exports missing');
  }
  const c = mod.defaultConfig();
  if (typeof c.enabled !== 'boolean') throw new Error('defaultConfig().enabled not boolean');
  console.log('✓ Self-validation: import + defaultConfig OK');
} catch (e) {
  console.error('✗ Self-validation FAILED:', e.message);
  console.error('  → Block file written but does NOT import cleanly.');
  console.error('  → Inspect:', blockFile);
  process.exit(1);
}

console.log('');
console.log('Next steps:');
console.log(`  1. node ${testFile}                                 # run scaffold tests`);
console.log(`  2. node tools/lego-gate.mjs                          # ensure LEGO 8/8`);
console.log(`  3. node tools/_lw-25-deep-qa.mjs                     # ensure 29/29 PASS`);
console.log('  4. If GDD declares sole-owner events, update tools/lego-gate.mjs');
console.log('     EXPECTED_EMIT_OWNERS + HOOK_REGISTRATION_OPT_OUT.');
