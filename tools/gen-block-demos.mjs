#!/usr/bin/env node
/**
 * tools/gen-block-demos.mjs
 *
 * Wave Z phase 2 — Per-block live demo generator.
 *
 * For each LEGO block in src/blocks/, generates a minimal slot HTML where
 * THAT block is force-enabled with default config. The Block Playground
 * (blocks/index.html) embeds this demo via <iframe> so trigger presets
 * fire into the demo's HookBus, exercising the block in real isolation.
 *
 * Output: blocks/demos/<blockName>.html (one per block)
 *
 * Idempotent — safe to re-run after every block addition.
 */
import { readdir, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve as resolvePath, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGDD } from '../src/parser.mjs';
import { buildSlotHTML } from '../src/buildSlotHTML.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolvePath(__dirname, '..');
const BLOCKS_DIR = resolvePath(REPO_ROOT, 'src/blocks');
const DEMOS_DIR = resolvePath(REPO_ROOT, 'blocks/demos');

const C = {
  green: s => `\x1b[32m${s}\x1b[0m`,
  cyan: s => `\x1b[36m${s}\x1b[0m`,
  red: s => `\x1b[31m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`,
  dim: s => `\x1b[2m${s}\x1b[0m`,
};

/* Skip infra/CSS-only blocks that have no UI surface to demo. */
const SKIP = new Set([
  'hookBus.mjs', 'reelEngineCSS.mjs', 'themeCSS.mjs',
  'paylineOverlay.mjs', 'paylines.mjs', 'spinTempo.mjs',
  'motionOverlay.mjs', 'payAnywhereEval.mjs',
  'clusterPaysEval.mjs', 'waysEval.mjs',
]);

/* Minimal baseline GDD (rectangular 5×3 with 1 FS feature) — keeps
 * generated HTML small while still exercising lifecycle. */
function baseGDD(blockName) {
  return `# Demo Slot
## Topology
| Reels | 5 |
| Rows  | 3 |
| Paylines | 10 |

## Symbols
### Tier HP
| H1 | 1000 |
| H2 | 500  |

### Tier MP
| M1 | 100 |
| M2 | 50  |

### Tier LP
| L1 | 20 |
| L2 | 10 |

### Specials
- W Wild
- S Scatter

## Features
- Free Spins: 3 scatters → 10 spins
- Lightning multiplier
`;
}

function injectBlockEnable(model, blockName) {
  // Force enable the target block via model.<blockName> = { enabled: true }
  const key = blockName.replace(/\.mjs$/, '');
  if (!model[key]) model[key] = {};
  if (typeof model[key] === 'object') model[key].enabled = true;
}

function wrapDemoHTML(slotHTML, blockName) {
  // Add a minimal indicator banner so a tester sees WHICH block is demoed.
  const tag = `<div id="__demoTag"
    style="position:fixed;top:8px;left:50%;transform:translateX(-50%);
           z-index:9999;background:rgba(10,20,40,0.85);color:#ffd84d;
           padding:4px 12px;border-radius:999px;font:600 11px system-ui;
           letter-spacing:1px;pointer-events:none;text-transform:uppercase">
    BLOCK DEMO · ${blockName.replace(/\.mjs$/, '')}
  </div>`;
  return slotHTML.replace(/<body([^>]*)>/, `<body$1>\n${tag}\n`);
}

async function main() {
  if (!existsSync(DEMOS_DIR)) await mkdir(DEMOS_DIR, { recursive: true });
  const files = (await readdir(BLOCKS_DIR)).filter(f => f.endsWith('.mjs')).sort();

  console.log(C.bold(C.cyan(`\n🧩 Wave Z.2 — Per-block Demo Generator\n`)));
  console.log(C.dim(`Total: ${files.length} blocks (${files.length - SKIP.size} demoable)\n`));

  let ok = 0, skip = 0, fail = 0;
  for (const name of files) {
    if (SKIP.has(name)) { skip++; continue; }
    try {
      const baseModel = parseGDD(baseGDD(name));
      injectBlockEnable(baseModel, name);
      const html = buildSlotHTML(baseModel);
      const final = wrapDemoHTML(html, name);
      await writeFile(resolvePath(DEMOS_DIR, name.replace(/\.mjs$/, '.html')), final);
      ok++;
      if (ok <= 5 || ok % 25 === 0) {
        process.stdout.write(C.green(`✓ ${name}`) + '\n');
      }
    } catch (e) {
      fail++;
      console.log(C.red(`✗ ${name}: ${e.message.slice(0, 80)}`));
    }
  }
  console.log(C.bold(`\n────────────────────────────────────`));
  console.log(C.bold(`Generated: ${ok}  ·  Skipped: ${skip}  ·  Failed: ${fail}`));
  console.log(C.bold(`────────────────────────────────────`));
  console.log(C.dim(`Demos: ${DEMOS_DIR}/\n`));
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error(C.red(`FATAL: ${e.stack || e.message}`)); process.exit(2); });
