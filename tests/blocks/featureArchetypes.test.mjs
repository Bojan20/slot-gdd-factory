#!/usr/bin/env node
/**
 * tests/blocks/featureArchetypes.test.mjs
 *
 * Wave Z — Feature Archetype Library tests.
 */
import { ARCHETYPES, ARCHETYPE_COUNT, suggestArchetype, getArchetype, findUnknownFeatures }
  from '../../src/registry/featureArchetypes.mjs';

let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
function block(name, fn) { console.log('— ' + name + ' —'); fn(); console.log(''); }

block('1. Catalog shape', () => {
  t('1.1 ARCHETYPE_COUNT ≥ 15', ARCHETYPE_COUNT >= 15);
  t('1.2 ARCHETYPES frozen', Object.isFrozen(ARCHETYPES));
  for (const a of ARCHETYPES) {
    t(`1.archetype "${a.id}" has all required fields`,
      a.id && a.purpose && a.intentRegex instanceof RegExp &&
      Array.isArray(a.hooks) && a.forceFlag && a.windowFlag &&
      a.stateShape && Array.isArray(a.examples));
  }
});

block('2. suggestArchetype — exact example', () => {
  const r = suggestArchetype('stickyWild');
  t('2.1 stickyWild → sticky-state', r && r.archetype.id === 'sticky-state');
  t('2.2 confidence ≥ 0.85', r && r.confidence >= 0.85);

  const r2 = suggestArchetype('walkingWild');
  t('2.3 walkingWild → movement', r2 && r2.archetype.id === 'movement');

  const r3 = suggestArchetype('bonusPick');
  t('2.4 bonusPick → reveal', r3 && r3.archetype.id === 'reveal');

  const r4 = suggestArchetype('jackpotLadderRooms');
  t('2.5 jackpotLadderRooms → ladder', r4 && r4.archetype.id === 'ladder');

  const r5 = suggestArchetype('tumble');
  t('2.6 tumble → cascade-collapse', r5 && r5.archetype.id === 'cascade-collapse');
});

block('3. suggestArchetype — intent regex against prose', () => {
  const r1 = suggestArchetype('unknown_thing_v3', 'Player collects 6 coin symbols to fill the meter');
  t('3.1 prose with "collects ... fill" → accumulator',
    r1 && r1.archetype.id === 'accumulator');

  const r2 = suggestArchetype('foo_bar', 'symbol walks left one reel per spin');
  t('3.2 prose with "walks left" → movement',
    r2 && r2.archetype.id === 'movement');

  const r3 = suggestArchetype('mystery_v2');
  t('3.3 kind containing "mystery" → spawn',
    r3 && r3.archetype.id === 'spawn');
});

block('4. suggestArchetype — no match', () => {
  const r = suggestArchetype('totally_unrelated_widget_xyz_42', '');
  t('4.1 no match returns null', r === null);
  t('4.2 empty kind returns null', suggestArchetype('', '') === null);
  t('4.3 non-string returns null', suggestArchetype(null) === null);
});

block('5. getArchetype lookup', () => {
  t('5.1 getArchetype("sticky-state") returns object',
    !!(getArchetype('sticky-state') && getArchetype('sticky-state').id === 'sticky-state'));
  t('5.2 getArchetype("nonexistent") returns null',
    getArchetype('nonexistent') === null);
});

block('6. findUnknownFeatures — model scan', () => {
  const catalogFks = new Set(['freeSpins', 'holdAndWin', 'tumble']);
  const model = {
    __activeFeatures__: [
      { kind: 'freeSpins' },
      { kind: 'holdAndWin' },
      { kind: 'newExperimentalMechanic' },
      { kind: 'stickyWild' },
    ],
  };
  const unknown = findUnknownFeatures(model, catalogFks);
  t('6.1 returns 2 unknown', unknown.length === 2);
  const kinds = unknown.map(u => u.kind);
  t('6.2 includes newExperimentalMechanic', kinds.includes('newExperimentalMechanic'));
  t('6.3 includes stickyWild', kinds.includes('stickyWild'));
  const stickySug = unknown.find(u => u.kind === 'stickyWild');
  t('6.4 stickyWild gets archetype suggestion',
    stickySug && stickySug.suggestion && stickySug.suggestion.archetype.id === 'sticky-state');
});

block('7. Coverage of 15 canonical archetypes', () => {
  const expectedIds = [
    'sticky-state', 'accumulator', 'ladder', 'reveal', 'spawn',
    'expand-direction', 'movement', 'linked-region', 'meter-charging',
    'aux-reel', 'trigger-then-respin', 'cascade-collapse',
    'count-to-trigger', 'boost-multiplier', 'jackpot-pool',
  ];
  for (const id of expectedIds) {
    t(`7.archetype "${id}" present`, !!getArchetype(id));
  }
});

console.log('');
console.log(`  pass: ${pass}   fail: ${fail}`);
process.exit(fail > 0 ? 1 : 0);
