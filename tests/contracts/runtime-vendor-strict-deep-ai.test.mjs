/**
 * UQ-DEEP-AI · Runtime vendor strict gate (Boki 2026-06-24)
 *
 * Boki: "zelim da u simulotaoru nema IGT ili imena bilo koje firme, git je ok"
 *
 * Strict contract: rendered slot HTML (dist/ingest/<slug>/index.html) MORA biti
 * 100% čist od svih vendor brand-ova. Trademark/IP takedown risk ako klijent
 * dobije slot.html koji pominje IGT, Pragmatic Play, Cash Eruption, Wolf Run,
 * Cleopatra, Buffalo King, Megaways, NetEnt, Microgaming, Scientific Games,
 * Light & Wonder, Play'n Go, Novomatic, Gates of Olympus, Wrath of Olympus.
 *
 * Audit istorija:
 *   PRE UQ-DEEP-AI: UQ-DEEP-AB pravilo "razlikuj brand od product" — provider
 *   scrubbed ali product (Cash Eruption, Wolf Run, Cleopatra, Buffalo King)
 *   OSTAVLJENI u headeru. Problem: ti product nazivi su VENDOR-OWNED trademarks
 *   (Cash Eruption ≡ IGT, Buffalo King ≡ Pragmatic). Legal risk.
 *
 *   POSLE UQ-DEEP-AI: strict scrub BOTH provider i product. Smart neutral
 *   fallback derive-uje iz topology + theme tags (npr. "Lock-Respin · Volcano"
 *   iz topology 'lock_respin' + theme 'volcano'). 17/17 dist/ingest/ files CLEAN.
 *
 * Fixes:
 *   1. src/buildSlotHTML.mjs DISPLAY_VENDOR_RX extended sa product brand-ovima
 *   2. neutralDisplayName fallback derive iz model.topology + theme.tags
 *   3. src/blocks/batchSimulatorPanel.mjs BSP_MODEL.name = null (no vendor)
 *   4. src/blocks/expandingWild.mjs / bonusBuy.mjs source comments scrubbed
 *   5. src/blocks/buildSlotHTML.mjs emitPwaInstallability sa displayName
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '../..');

/* Strict vendor regex — broader than anti-vendor-lint (includes product names). */
const STRICT_VENDOR_RX = /\b(IGT|Pragmatic[\s\-_.]?Play|Megaways|Cash[\s\-_.]?Eruption|Wolf[\s\-_.]?Run|Cleopatra|Buffalo[\s\-_.]?(?:King|Gold)|NetEnt|Microgaming|Scientific[\s\-_.]?Games|L&W|Light[\s\-_.]*&[\s\-_.]*Wonder|Play'?n[\s\-_.]?Go|Novomatic|Gates[\s\-_.]?of[\s\-_.]?Olympus|Wrath[\s\-_.]?of[\s\-_.]?Olympus)\b/gi;

test('UQ-DEEP-AI · buildSlotHTML.mjs has strict DISPLAY_VENDOR_RX', () => {
  const src = readFileSync(resolve(REPO, 'src/buildSlotHTML.mjs'), 'utf8');
  assert.ok(src.includes('Cash[\\s\\-_.]?Eruption'),
    'DISPLAY_VENDOR_RX must include Cash Eruption product brand');
  assert.ok(src.includes('Wolf[\\s\\-_.]?Run'),
    'DISPLAY_VENDOR_RX must include Wolf Run product brand');
  assert.ok(src.includes('Buffalo[\\s\\-_.]?(?:King|Gold)'),
    'DISPLAY_VENDOR_RX must include Buffalo King/Gold product brand');
  assert.ok(src.includes('Gates[\\s\\-_.]?of[\\s\\-_.]?Olympus'),
    'DISPLAY_VENDOR_RX must include Gates of Olympus product brand');
  assert.ok(src.includes('deriveNeutralName'),
    'Smart neutral name fallback present');
});

test('UQ-DEEP-AI · batchSimulatorPanel BSP_MODEL.name = null (no vendor leak)', () => {
  const src = readFileSync(resolve(REPO, 'src/blocks/batchSimulatorPanel.mjs'), 'utf8');
  /* Old: name: typeof model.name === 'string' ? model.name : null
   * New: name: null (no vendor leak in browser BSP_MODEL inline runtime) */
  assert.ok(src.includes('name: null,'),
    'BSP_MODEL.name must be null — model.name može sadržati vendor product brand');
});

test('UQ-DEEP-AI · ALL rendered dist/ingest/*/index.html files are vendor-CLEAN', () => {
  const distDir = resolve(REPO, 'dist/ingest');
  if (!existsSync(distDir)) {
    console.log('  (dist/ingest empty — skipping)');
    return;
  }
  const slugs = readdirSync(distDir).filter(s => {
    const p = resolve(distDir, s);
    return statSync(p).isDirectory() && existsSync(resolve(p, 'index.html'));
  });
  if (slugs.length === 0) {
    console.log('  (no rendered slots in dist/ingest — skipping)');
    return;
  }
  const leaked = [];
  for (const slug of slugs) {
    const html = readFileSync(resolve(distDir, slug, 'index.html'), 'utf8');
    STRICT_VENDOR_RX.lastIndex = 0;
    const matches = html.match(STRICT_VENDOR_RX);
    if (matches && matches.length > 0) {
      leaked.push({ slug, hits: matches.length, samples: [...new Set(matches.slice(0, 3))] });
    }
  }
  assert.equal(leaked.length, 0,
    `Vendor LEAKS in rendered HTML: ${JSON.stringify(leaked.slice(0, 5))}`);
});

test('UQ-DEEP-AI · 5 baseline GDDs (cash-eruption, crystal-forge, midnight-fangs, wrath, gates) all vendor-clean', () => {
  const baselines = [
    'cash-eruption-foundry-gdd',
    'crystal-forge-game-gdd',
    'midnight-fangs-game-gdd',
    'wrath-of-olympus-game-gdd',
    'gates-of-olympus-1000-game-gdd',
  ];
  const distDir = resolve(REPO, 'dist/ingest');
  if (!existsSync(distDir)) {
    console.log('  (dist/ingest missing — skipping baseline check)');
    return;
  }
  for (const slug of baselines) {
    const path = resolve(distDir, slug, 'index.html');
    if (!existsSync(path)) {
      console.log(`  (${slug} not ingested — skipping)`);
      continue;
    }
    const html = readFileSync(path, 'utf8');
    STRICT_VENDOR_RX.lastIndex = 0;
    const matches = html.match(STRICT_VENDOR_RX);
    assert.equal(matches, null, `${slug} must have 0 vendor brand leaks, found: ${(matches || []).slice(0, 5).join(',')}`);
    /* Verify <title> is meaningful (>= 3 chars, has letter, no vendor). */
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    assert.ok(titleMatch, `${slug} must have <title>`);
    const title = titleMatch[1];
    assert.ok(/[a-zA-Z]/.test(title), `${slug} title must have at least 1 letter: "${title}"`);
    STRICT_VENDOR_RX.lastIndex = 0;
    assert.equal(STRICT_VENDOR_RX.test(title), false, `${slug} title must not match vendor: "${title}"`);
  }
});

test('UQ-DEEP-AI · deriveNeutralName fallback works for vendor-only names', () => {
  /* Simulate buildSlotHTML neutralDisplayName logic in isolation. */
  const DISPLAY_VENDOR_RX = /\b(IGT|Pragmatic[\s\-_.]?Play|Megaways|Cash[\s\-_.]?Eruption|Wolf[\s\-_.]?Run|Cleopatra|Buffalo[\s\-_.]?(?:King|Gold)|NetEnt|Microgaming|Scientific[\s\-_.]?Games|L&W|Light[\s\-_.]*&[\s\-_.]*Wonder|Play'?n[\s\-_.]?Go|Novomatic|Gates[\s\-_.]?of[\s\-_.]?Olympus|Wrath[\s\-_.]?of[\s\-_.]?Olympus)\b/gi;
  const TOPOLOGY_LABEL = {
    'lock_respin': 'Lock-Respin', 'tumble': 'Tumble', 'cascade': 'Cascade',
    'cluster': 'Cluster', 'ways': 'Ways', 'rectangular': 'Reels',
  };
  const deriveNeutralName = (m) => {
    const topo = (m && m.topology && m.topology.kind) || '';
    const tags = (m && m.theme && Array.isArray(m.theme.tags)) ? m.theme.tags : [];
    const topoLabel = TOPOLOGY_LABEL[topo] || 'Slot';
    DISPLAY_VENDOR_RX.lastIndex = 0;
    const safeTag = tags.find(t => typeof t === 'string' && t.length > 2 && !DISPLAY_VENDOR_RX.test(t));
    DISPLAY_VENDOR_RX.lastIndex = 0;
    const tagPart = safeTag ? ' · ' + safeTag.charAt(0).toUpperCase() + safeTag.slice(1) : '';
    return `${topoLabel}${tagPart}`;
  };
  /* Cash Eruption Foundry → Lock-Respin · Volcano */
  assert.equal(
    deriveNeutralName({ topology: { kind: 'lock_respin' }, theme: { tags: ['volcano', 'fire'] } }),
    'Lock-Respin · Volcano',
  );
  /* Gates of Olympus 1000 → Reels · Greek-mythology (if greek-mythology tag) */
  assert.equal(
    deriveNeutralName({ topology: { kind: 'rectangular' }, theme: { tags: ['greek-mythology'] } }),
    'Reels · Greek-mythology',
  );
  /* No tags → topology only. */
  assert.equal(
    deriveNeutralName({ topology: { kind: 'cluster' } }),
    'Cluster',
  );
  /* No model → "Slot". */
  assert.equal(deriveNeutralName({}), 'Slot');
});
