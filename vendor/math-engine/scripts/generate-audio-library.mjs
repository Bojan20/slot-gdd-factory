#!/usr/bin/env node
/**
 * generate-audio-library.mjs — CORTI 200.8 Production.
 *
 * Generates 60+ audio cue placeholder files + a library.json catalog.
 * Real audio sample bytes are NOT shipped — instead each file is a
 * 1-line text stub that documents the cue. The runtime audio engine
 * falls back to a Web-Audio synth when the cue's .mp3 is absent
 * (existing CORTI 200.2 behaviour) so this layout works in dev/CI
 * without binary assets.
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO_ROOT  = resolve(__dirname, '..');
const OUT_DIR    = resolve(REPO_ROOT, 'web/studio/audio');

const DRY_RUN = process.argv.includes('--dry-run');

const CUES = [
  // Spin variations (10)
  { id: 'spin-classic',     tier: 'spin', duration: 1.2 },
  { id: 'spin-rapid',       tier: 'spin', duration: 0.6 },
  { id: 'spin-luxe',        tier: 'spin', duration: 1.5 },
  { id: 'spin-mystery',     tier: 'spin', duration: 1.8 },
  { id: 'spin-cosmic',      tier: 'spin', duration: 1.4 },
  { id: 'spin-megaways',    tier: 'spin', duration: 1.3 },
  { id: 'spin-cluster',     tier: 'spin', duration: 1.2 },
  { id: 'spin-bonus',       tier: 'spin', duration: 1.6 },
  { id: 'spin-fs',          tier: 'spin', duration: 1.0 },
  { id: 'spin-jackpot',     tier: 'spin', duration: 2.0 },

  // Reel stop variations (10)
  { id: 'reel-stop-soft',   tier: 'stop', duration: 0.3 },
  { id: 'reel-stop-hard',   tier: 'stop', duration: 0.4 },
  { id: 'reel-stop-chime',  tier: 'stop', duration: 0.5 },
  { id: 'reel-stop-thud',   tier: 'stop', duration: 0.3 },
  { id: 'reel-stop-click',  tier: 'stop', duration: 0.2 },
  { id: 'reel-stop-bell',   tier: 'stop', duration: 0.6 },
  { id: 'reel-stop-burst',  tier: 'stop', duration: 0.4 },
  { id: 'reel-stop-quick',  tier: 'stop', duration: 0.2 },
  { id: 'reel-stop-anchor', tier: 'stop', duration: 0.5 },
  { id: 'reel-stop-deep',   tier: 'stop', duration: 0.4 },

  // Win cues (10)
  { id: 'win-small',        tier: 'win',  duration: 0.8 },
  { id: 'win-medium',       tier: 'win',  duration: 1.2 },
  { id: 'win-big',          tier: 'win',  duration: 2.0 },
  { id: 'win-mega',         tier: 'win',  duration: 2.5 },
  { id: 'win-epic',         tier: 'win',  duration: 3.5 },
  { id: 'win-jackpot',      tier: 'win',  duration: 4.0 },
  { id: 'win-cascade',      tier: 'win',  duration: 1.5 },
  { id: 'win-line',         tier: 'win',  duration: 0.9 },
  { id: 'win-cluster',      tier: 'win',  duration: 1.4 },
  { id: 'win-way',          tier: 'win',  duration: 1.0 },

  // FS cues (10)
  { id: 'fs-intro',         tier: 'fs',   duration: 2.5 },
  { id: 'fs-outro',         tier: 'fs',   duration: 2.0 },
  { id: 'fs-spin',          tier: 'fs',   duration: 1.2 },
  { id: 'fs-mult-up',       tier: 'fs',   duration: 0.6 },
  { id: 'fs-mult-max',      tier: 'fs',   duration: 1.5 },
  { id: 'fs-retrigger',     tier: 'fs',   duration: 1.8 },
  { id: 'fs-sticky',        tier: 'fs',   duration: 0.7 },
  { id: 'fs-expand',        tier: 'fs',   duration: 0.9 },
  { id: 'fs-counter',       tier: 'fs',   duration: 0.4 },
  { id: 'fs-final',         tier: 'fs',   duration: 2.2 },

  // H&W cues (10)
  { id: 'hw-orb-land',      tier: 'hw',   duration: 0.6 },
  { id: 'hw-row-complete',  tier: 'hw',   duration: 1.5 },
  { id: 'hw-col-complete',  tier: 'hw',   duration: 1.5 },
  { id: 'hw-full-grid',     tier: 'hw',   duration: 3.0 },
  { id: 'hw-payout',        tier: 'hw',   duration: 1.8 },
  { id: 'hw-jackpot-tier',  tier: 'hw',   duration: 2.0 },
  { id: 'hw-trigger',       tier: 'hw',   duration: 1.2 },
  { id: 'hw-respin',        tier: 'hw',   duration: 0.8 },
  { id: 'hw-reset',         tier: 'hw',   duration: 0.6 },
  { id: 'hw-final-payout',  tier: 'hw',   duration: 2.5 },

  // Cascade cues (10)
  { id: 'cascade-phase-1',  tier: 'cascade', duration: 0.5 },
  { id: 'cascade-phase-2',  tier: 'cascade', duration: 0.6 },
  { id: 'cascade-phase-3',  tier: 'cascade', duration: 0.7 },
  { id: 'cascade-phase-4',  tier: 'cascade', duration: 0.8 },
  { id: 'cascade-phase-5',  tier: 'cascade', duration: 0.9 },
  { id: 'cascade-chain',    tier: 'cascade', duration: 1.0 },
  { id: 'cascade-explosion',tier: 'cascade', duration: 1.5 },
  { id: 'cascade-mult-up',  tier: 'cascade', duration: 0.5 },
  { id: 'cascade-mult-max', tier: 'cascade', duration: 1.2 },
  { id: 'cascade-tumble',   tier: 'cascade', duration: 0.8 },

  // UI cues (10)
  { id: 'ui-click',         tier: 'ui',   duration: 0.1 },
  { id: 'ui-hover',         tier: 'ui',   duration: 0.05 },
  { id: 'ui-error',         tier: 'ui',   duration: 0.4 },
  { id: 'ui-success',       tier: 'ui',   duration: 0.5 },
  { id: 'ui-notification',  tier: 'ui',   duration: 0.6 },
  { id: 'ui-confirm',       tier: 'ui',   duration: 0.3 },
  { id: 'ui-cancel',        tier: 'ui',   duration: 0.3 },
  { id: 'ui-bet-up',        tier: 'ui',   duration: 0.2 },
  { id: 'ui-bet-down',      tier: 'ui',   duration: 0.2 },
  { id: 'ui-cashout',       tier: 'ui',   duration: 1.0 },
];

function placeholderContent(cue) {
  return [
    `; CORTI 200.8 audio cue placeholder`,
    `; id: ${cue.id}`,
    `; tier: ${cue.tier}`,
    `; duration_s: ${cue.duration}`,
    `; format: mp3 (replace with real ≤200 KB MP3 for production)`,
    `; fallback: Web-Audio synth tone (createAudioEngine().preloadDefaults())`,
  ].join('\n') + '\n';
}

function writeIfChanged(absPath, content) {
  mkdirSync(dirname(absPath), { recursive: true });
  let prevSame = false;
  if (existsSync(absPath)) {
    try { prevSame = readFileSync(absPath, 'utf8') === content; } catch {}
  }
  if (!prevSame) writeFileSync(absPath, content);
}

function main() {
  console.log(`[audio-lib] generator boot — DRY_RUN=${DRY_RUN}`);
  const cuesDir = resolve(OUT_DIR, 'cues');
  for (const cue of CUES) {
    const txt = placeholderContent(cue);
    if (!DRY_RUN) writeIfChanged(resolve(cuesDir, `${cue.id}.cue.txt`), txt);
  }
  const library = {
    schema_version: '1.0.0',
    generated_by: 'scripts/generate-audio-library.mjs',
    total: CUES.length,
    tiers: ['spin', 'stop', 'win', 'fs', 'hw', 'cascade', 'ui'],
    cues: CUES.map((c) => ({
      id: c.id,
      tier: c.tier,
      duration_s: c.duration,
      file_placeholder: `cues/${c.id}.cue.txt`,
      file_runtime: `cues/${c.id}.mp3`,
    })),
  };
  const libPath = resolve(OUT_DIR, 'library.json');
  const libJson = JSON.stringify(library, null, 2) + '\n';
  if (!DRY_RUN) writeIfChanged(libPath, libJson);
  console.log(`[audio-lib] done — ${CUES.length} audio cues + library.json`);
}

main();
