# Vendor Patent Corpus · Slot Mechanic Patent Reverse Engineering

> **Scope:** internal research-pool material for `FeatureArchitect` and `SlotSageV2` agents.
> **Vendor names are permitted in this file only** because the file never ships to a game-facing artefact (GDD, PAR sheet, capsule, marketing one-pager). Every game-facing output MUST use the vendor-neutral mapping in **§16**.
> **Honesty contract:** any claim that cannot be verified against a real filing is marked `[claim summary unverified]`. Any patent number that cannot be confirmed is marked `[Patent: unknown — needs lookup]`. Agents reading this file MUST refuse hallucinated coverage.
> **Audio carve-out:** per `rule_audio_off_until_asked`, no audio-system patents (Howler, mixing, ducking, voice) are catalogued here, even where vendors hold them.
> **No RTP leakage:** no actual RTP percentages from patent specifications are reproduced.

---

## Table of Contents

| §  | Title                                                       | Block-kind anchor              |
|:--:|:------------------------------------------------------------|:-------------------------------|
| 1  | Patent Methodology                                          | n/a                            |
| 2  | Big Time Gaming · Megaways                                  | `variableWays`                 |
| 3  | Aristocrat · Lightning Link / Hyperlink                     | `holdAndRespin`                |
| 4  | IGT · MultiWay Xtra / Stinkin' Rich                         | `multiwayStack`                |
| 5  | Scientific Games · Stepper / Reel Power                     | `allWaysEvaluator`             |
| 6  | WMS · Adaptive Gaming / Personality Game                    | `adaptiveFeatureTrigger`       |
| 7  | NetEnt · Cluster Pays                                       | `clusterPays`                  |
| 8  | Yggdrasil · Drop Engine / Multifly                          | `cascadeEngine`                |
| 9  | Relax Gaming · Dream Drop / Money Train Bonus               | `progressiveDropJackpot`       |
| 10 | Wazdan · Hold the Jackpot                                   | `bonusOrbCollect`              |
| 11 | Stake Engine (provably-fair RNG)                            | `provablyFairRng`              |
| 12 | Evolution · Slingo (bingo-slot fusion)                      | `bingoSlotFusion`              |
| 13 | Lock & Win / Hold & Win generic                             | `lockAndRespinGeneric`         |
| 14 | Patent Expiration Timeline                                  | n/a                            |
| 15 | Clean-Room Implementation Guide                             | n/a                            |
| 16 | Vendor-Neutral Glossary Mapping                             | n/a                            |
| 17 | Citation Index                                              | n/a                            |

---

## 1. Patent Methodology

A slot patent is a legal document, not an engineering spec. The four parts agents must distinguish:

| Part            | What it contains                                                                                                              | Weight for reverse engineering |
|:----------------|:------------------------------------------------------------------------------------------------------------------------------|:-------------------------------|
| Claims          | The numbered list at the end. **Legally binding scope.** Every word matters; "comprising" vs "consisting of" changes scope.   | 90 % — read first              |
| Specification   | Background, summary, detailed description. Often contains broader language than claims actually cover.                        | 50 % — context for claims      |
| Drawings        | Figures, flowcharts, screen layouts. Useful for visualising claimed mechanics.                                                | 40 % — supports specification  |
| Prior art cites | References to earlier patents/papers. Tells you what the examiner believed was novel vs. obvious.                             | 30 % — narrows actual novelty  |

### 1.1 Reading the Claim Hierarchy

Patents use independent and dependent claims:

| Claim type   | Pattern                                                                  | What to extract                                                                 |
|:-------------|:-------------------------------------------------------------------------|:--------------------------------------------------------------------------------|
| Independent  | "A gaming machine comprising: a) … b) … c) …"                            | The minimum set of features that together infringe. Each `a/b/c` is a limitation. |
| Dependent    | "The gaming machine of claim 1, wherein the symbol stack is variable."   | Narrows the parent. Only matters if you implement the parent.                   |

**Reverse-engineering rule:** if your block omits **even one limitation** of an independent claim, you don't infringe that claim. A claim is an AND-of-limitations, not an OR.

### 1.2 Patent Databases

| Database         | URL pattern                                              | Best for                                  | Free? |
|:-----------------|:---------------------------------------------------------|:------------------------------------------|:------|
| USPTO Patent FT  | `patft.uspto.gov` (legacy) / `ppubs.uspto.gov`           | US grants and applications                | Yes   |
| EPO Espacenet    | `worldwide.espacenet.com`                                | EP + family lookup + English abstracts    | Yes   |
| Google Patents   | `patents.google.com`                                     | Full-text search across jurisdictions     | Yes   |
| IP Australia     | `auspat.ipaustralia.gov.au`                              | AU grants (Aristocrat lives here)         | Yes   |
| IPONZ NZ         | `app.iponz.govt.nz/app/Extra/Default.aspx`               | NZ grants (Big Time Gaming Megaways)      | Yes   |
| WIPO PATENTSCOPE | `patentscope.wipo.int`                                   | PCT applications + multi-jurisdiction     | Yes   |
| CIPO Canada      | `ised-isde.canada.ca/cipo/client/cps`                    | Canadian grants                           | Yes   |

### 1.3 Extracting the "Actual Invention"

Steps the `FeatureArchitect` agent should follow:

1. Read claim 1. Underline every limitation (a, b, c, …).
2. Read the abstract — it usually contains a plain-English summary of claim 1.
3. Read the "Summary of Invention" section in the spec — finds the problem the inventor claims to have solved.
4. Read prior art citations and skim the cited patents' abstracts — narrows what the examiner believed was new.
5. Identify which limitation is the **inventive step**. Often only one limitation is genuinely new; the rest is conventional slot architecture.
6. Map the inventive step to a `slot-gdd-factory` block-kind. The rest is generic engine plumbing already present in the factory.

### 1.4 Mapping a Patent Claim to a Block-Kind

| Patent claim language                                                  | Likely block-kind                                | Lifecycle hooks involved                      |
|:-----------------------------------------------------------------------|:-------------------------------------------------|:----------------------------------------------|
| "variable number of symbols per reel"                                  | `variableWays`                                   | `preSpin`, `onSpinResult`                     |
| "symbol locked on grid for subsequent re-spins"                        | `holdAndRespin`                                  | `onSpinResult`, `preSpin` (re-spin)           |
| "ways-to-win computed across reels including symbol stacks"            | `multiwayStack`                                  | `onSpinResult`                                |
| "connected group of N or more matching symbols pays"                   | `clusterPays`                                    | `onSpinResult`, `onTumbleStep`                |
| "winning symbols removed and replaced with cascading symbols"          | `cascadeEngine`                                  | `onTumbleStep`                                |
| "progressive jackpot pool incremented by player wagers"                | `progressiveDropJackpot`                         | `onSpinResult`, `postSpin`                    |
| "bonus orbs accumulated until threshold triggers feature"              | `bonusOrbCollect`                                | `onSpinResult`, `onFsTrigger`                 |
| "cryptographic seed verified by player after spin"                     | `provablyFairRng`                                | `preSpin`, `postSpin`                         |
| "grid evaluated as bingo card with daubed cells"                       | `bingoSlotFusion`                                | `onSpinResult`                                |

### 1.5 Honesty Calibration

A patent number does not mean infringement. A patent number means a published, examined claim set. The agent must:

- Refuse to assert coverage by patent number alone.
- Always cite `[Patent: <jurisdiction> <number>]` in the form `[Patent: NZ 716804]` or `[Patent: US 9633511]`.
- Mark `[claim summary unverified]` when the agent has not personally confirmed the wording.
- Mark `[Patent: unknown — needs lookup]` when the family is known but the specific number is not in the agent's training.
- Never invent a patent number.

---

## 2. Big Time Gaming · Megaways (variable-ways engine)

**Vendor:** Big Time Gaming (generic: variable-ways engine).
**Block-kind impacted:** `variableWays`.

### 2.1 Patent Timeline

| Event                          | Date                | Notes                                                                          |
|:-------------------------------|:--------------------|:-------------------------------------------------------------------------------|
| NZ application filed           | 2014                | First-of-family, jurisdiction strategically chosen for cost/speed.             |
| NZ grant                       | 2016                | `[Patent: NZ 716804]` issued.                                                  |
| Licensing programme begins     | ~2016               | 1.5 % revenue-share standard rate (industry-reported).                         |
| AU national-phase / variants   | 2015–2017           | AU family member `[Patent: unknown — needs lookup]`.                           |
| Expiration                     | June 2024           | 10-year NZ term from filing. Industry pivot wave begins.                       |

The NZ patent `[Patent: NZ 716804]` is the canonical Megaways filing. Its expiration in June 2024 is the single most important event in modern slot-mechanic IP because it released a heavily-licensed pattern back into the commons.

### 2.2 Original Claims (summary)

`[claim summary unverified — recommend Espacenet lookup before code emits these in a GDD]`

The independent claim covers, in essence:

| Limitation | Language gist                                                                              |
|:-----------|:-------------------------------------------------------------------------------------------|
| a          | A gaming machine with a plurality of reels.                                                |
| b          | Each reel has a **variable** number of symbol positions per spin (e.g. 2–7).               |
| c          | Ways-to-win calculated as the product of symbol counts across reels (e.g. 2·3·4·5·6·7).    |
| d          | A horizontal "carriage" reel above the main reels containing additional symbol positions.  |
| e          | A re-spin or feature trigger based on the variable configuration.                          |

Dependent claims commonly add:
- Mystery symbol expansion.
- Cascading wins (tumble after a paid line).
- Unlimited multiplier in a free-spins feature.

### 2.3 Scope: variable-ways count per spin

The legally distinctive element is the **per-spin variability** of symbol positions, producing a per-spin ways count that varies between bounds. A 6-reel layout with 2..7 positions yields a max of 117,649 ways (7^6).

A clean-room implementation must:

| Element                                  | Safe?                                                  | Reasoning                                                                |
|:-----------------------------------------|:-------------------------------------------------------|:-------------------------------------------------------------------------|
| Fixed-positions ways engine              | Yes                                                    | Pre-dates patent (IGT 243-ways).                                         |
| Variable-positions ways engine, post-expiration | Yes (post-June 2024)                            | Patent expired.                                                          |
| Calling it "Megaways" without license    | No                                                     | Trademark, separate from patent.                                         |
| Calling it "variable-ways" / "shifting-ways" | Yes                                                | Generic descriptive term.                                                |
| Carriage reel above main reels           | Was patented, now expired                              | Implementation OK; naming differs.                                       |

### 2.4 Mystery Symbol Expansion

A mystery symbol is a placeholder that, when revealed, transforms into a chosen "regular" symbol — usually one symbol per spin for the whole reelset.

| Element                  | Patent coverage gist                                                              | Safe to clone?                          |
|:-------------------------|:----------------------------------------------------------------------------------|:----------------------------------------|
| Mystery placeholder      | Generic, pre-existing prior art (e.g. older IGT mystery wilds).                   | Yes.                                    |
| One-symbol-per-spin reveal | Covered as a dependent claim in the Megaways family.                            | Post-expiration: yes.                   |
| Mystery as a wild        | Pre-existing; not unique to Megaways.                                            | Yes.                                    |

### 2.5 License History

Big Time Gaming licensed Megaways broadly through ReelPlay (Australia). Public figures suggest:

| Licensee (examples)            | Approximate era      | Note                                              |
|:-------------------------------|:---------------------|:--------------------------------------------------|
| Blueprint Gaming                | 2017+                | Genie Jackpots Megaways; very early licensee.     |
| Pragmatic Play                  | 2020+                | Big Bass Megaways title.                          |
| Red Tiger / NetEnt              | 2018+                | Multiple branded titles.                          |
| Kalamba / iSoftBet              | 2019+                | Smaller catalog.                                  |
| Stakelogic / others             | 2019+                | Niche titles.                                     |

Licensing fee structure: ~1.5 % of GGR (revenue share). `[claim summary unverified — figure from industry reporting, not from the patent itself.]`

### 2.6 Post-Expiration Impact

Since June 2024:

1. Studios no longer pay revenue share for variable-ways.
2. Major studios announced own variable-ways engines (e.g., Pragmatic's continued "Megaways"-branded output continues via license carry-over agreements; smaller studios released "Wayways", "Megareels", and "Shifting Ways" derivatives `[claim summary unverified — observed in market, not catalogued]`).
3. Trademark on the **word** "Megaways" remains with Big Time Gaming. Cloning the engine is now safe; cloning the brand is not.

### 2.7 Cross-Vendor Implementations

| Studio          | Title (example)                  | Same engine? | Notes                                                          |
|:----------------|:---------------------------------|:-------------|:---------------------------------------------------------------|
| ReelPlay        | Megaclusters (e.g. Atomic Slot Lab) | No (fusion) | Cluster pays fused with shifting grid.                         |
| Pragmatic Play  | Big Bass Megaways                  | Yes (license)| 117,649 ways, official Megaways license.                       |
| Blueprint        | Genie Jackpots Megaways            | Yes (license)| Early-era licensee.                                            |
| Stakelogic       | "Megaways" lookalikes              | Effectively yes | Operated under license while patent active.                  |
| iSoftBet         | Multiple                           | Yes (license)| 2019–2024.                                                     |

### 2.8 Implementation Skeleton (clean-room)

```js
// src/blocks/variableWays.mjs  — pseudo-skeleton, no game-specific branches
export default {
  kind: 'variableWays',
  init(gdd) {
    return {
      minPerReel: gdd.variableWays.min ?? 2,
      maxPerReel: gdd.variableWays.max ?? 7,
      reels: gdd.reels.length,
    };
  },
  preSpin(ctx) {
    const counts = ctx.reels.map(r =>
      ctx.rng.intInclusive(this.minPerReel, this.maxPerReel)
    );
    ctx.set('variableWays.counts', counts);
    ctx.set('variableWays.ways', counts.reduce((a, b) => a * b, 1));
  },
  onSpinResult(ctx) {
    ctx.emit('waysCount', ctx.get('variableWays.ways'));
  },
};
```

The skeleton above does not include the carriage reel or the cascading multiplier — those are dependent-claim features and should be separate blocks (`carriageReel`, `unlimitedMultiplier`) to keep LEGO modularity.

### 2.9 Open Questions for Counsel

| Question                                                                                  | Why it matters                                                            |
|:------------------------------------------------------------------------------------------|:--------------------------------------------------------------------------|
| Are there NZ continuation or divisional filings still active?                              | A divisional could extend coverage by 1–4 years.                          |
| Has Big Time Gaming filed a post-grant family covering "Megaways Megaclusters"?            | Combined features may have unexpired coverage.                            |
| What is the trademark status of "Megaways" in EU vs. US vs. AU?                            | Brand vs. mechanic distinction.                                           |

---

## 3. Aristocrat · Lightning Link / Hyperlink (hold-and-respin progressive)

**Vendor:** Aristocrat (generic: hold-and-respin progressive).
**Block-kind impacted:** `holdAndRespin`.

### 3.1 Patent Family

| Filing                           | Status                | Notes                                                            |
|:---------------------------------|:----------------------|:-----------------------------------------------------------------|
| `[Patent: AU 2014203832]`        | Granted               | Australian root; Aristocrat home jurisdiction.                   |
| `[Patent: US 9633511]`           | Granted, 2017         | US national-phase. Hold-and-respin claims.                       |
| `[Patent: US 9165433]` (related) | Granted               | Earlier Hyperlink-style claim. `[claim summary unverified]`      |
| EP family                        | `[Patent: unknown — needs lookup]` | Likely an EPO equivalent exists.                       |

### 3.2 Claim Cluster (a) Collect-Respins

| Limitation gist                                                                                       | Inventive? |
|:------------------------------------------------------------------------------------------------------|:-----------|
| Bonus-trigger requires N or more "collect orbs" landing simultaneously (often 6 of 15 positions).     | Yes (combined with respin).      |
| Triggering orbs lock in their landed positions for the duration of the feature.                       | Yes.                              |
| Player is granted a fixed number of re-spins (commonly 3).                                            | Partial — fixed-count respins are old. |
| Each newly landed orb resets the re-spin counter to maximum.                                          | Yes — key inventive step.         |

### 3.3 Claim Cluster (b) Jackpot Pooling

| Limitation gist                                                                                       | Inventive? |
|:------------------------------------------------------------------------------------------------------|:-----------|
| Multiple terminals contribute to a common progressive pool.                                           | Old (1990s).                      |
| Pool is partitioned across multiple tiers (mini/minor/major/grand).                                   | Old (1990s).                      |
| Tier assignment occurs at orb-reveal time, not at bonus-trigger time.                                 | Partial.                          |
| Pool seeded by mandatory wager contribution per spin.                                                 | Old.                              |

### 3.4 Claim Cluster (c) Progressive Ladder

The mini/minor/major/grand ladder pattern is old prior art (IGT MegaJackpots, WMS, late 1990s). Aristocrat's defensible scope is the **combination** of ladder + collect-orbs + reset-respins.

### 3.5 Claim Cluster (d) Re-Spin Trigger Condition

| Limitation gist                                                                                       | Patent scope?                                              |
|:------------------------------------------------------------------------------------------------------|:-----------------------------------------------------------|
| 6 or more orbs on 5x3 grid triggers feature.                                                          | The **number 6** is not patented. The **combination** is.  |
| Trigger uses a dedicated symbol distinct from regular pays.                                           | Generic prior art.                                         |
| Trigger condition evaluated independently of paylines.                                                | Generic prior art.                                         |

### 3.6 Lock-and-Respin Generic Pattern

A lock-and-respin pattern is generic and pre-existing (IGT held earlier patents on hold-and-spin from the early 2000s). The Aristocrat patents do **not** cover lock-and-respin generically. They cover specific combinations with the collect/orb mechanic, reset-on-land, and tier-ladder reveal.

### 3.7 Defensible vs. Inventive Scope

| Element                                | Aristocrat scope?       | Clean-room safe?                  |
|:---------------------------------------|:------------------------|:----------------------------------|
| Generic hold-and-respin                | Out of scope            | Yes.                              |
| Tier-ladder mini/minor/major/grand     | Out of scope (prior art)| Yes.                              |
| Orb-collect with reset-on-land respin  | In scope                | High risk while patent active.    |
| Cross-terminal pool                    | Out of scope (prior art)| Yes.                              |
| Reveal mini/minor/major/grand at end   | In scope (combined)     | Risk if combined with orb-collect.|

### 3.8 Vendor-Neutral Implementation

```js
// src/blocks/holdAndRespin.mjs — generic respin block
export default {
  kind: 'holdAndRespin',
  init(gdd) {
    return {
      triggerCount: gdd.holdAndRespin.triggerCount ?? 6,
      initialRespins: gdd.holdAndRespin.initialRespins ?? 3,
      resetOnLand: gdd.holdAndRespin.resetOnLand ?? true,
      tiers: gdd.holdAndRespin.tiers ?? ['mini', 'minor', 'major', 'grand'],
    };
  },
  onSpinResult(ctx) {
    const orbs = ctx.symbolsOfKind('collectOrb');
    if (orbs.length >= this.triggerCount) {
      ctx.enterFeature('holdAndRespin', { lockedPositions: orbs });
    }
  },
  // … etc. Avoid combining "reset on land" + "tier reveal" without legal review.
};
```

### 3.9 Industry Adoption Pattern

| Studio                  | Hold-and-respin product       | Aristocrat similarity?                              |
|:------------------------|:------------------------------|:----------------------------------------------------|
| Pragmatic Play          | Money Train series (Relax)    | Different — bonus game, not respin-orb.             |
| Wazdan                  | Hold the Jackpot              | Very similar — see §10.                             |
| Endorphina / others     | Hold/respin clones            | Varies; rely on generic respin not orb-reset.       |
| 1×2 Network / Reflex    | Lock-and-spin titles          | Generally avoid reset-on-land.                      |

### 3.10 Open Questions for Counsel

| Question                                                              | Why it matters                                                            |
|:----------------------------------------------------------------------|:--------------------------------------------------------------------------|
| Has Aristocrat filed continuations narrowing/widening collect claims? | Could extend protection to ~2034.                                         |
| AU vs. US scope differences?                                          | US claims sometimes broader after RCE.                                    |
| Is the "reset on land" limitation novel against pre-2010 prior art?   | Determines true inventive scope.                                          |

---

## 4. IGT · MultiWay Xtra / Stinkin' Rich expansion

**Vendor:** IGT (generic: multi-symbol-per-reel ways evaluator).
**Block-kind impacted:** `multiwayStack`.

### 4.1 Patent Family

| Filing                            | Status   | Notes                                                                  |
|:----------------------------------|:---------|:-----------------------------------------------------------------------|
| `[Patent: US 6997804]`            | Granted  | Multi-way evaluation engine.                                            |
| `[Patent: US 7014557]`            | Granted  | Related ways-evaluation claim set.                                      |
| EP family                         | `[Patent: unknown — needs lookup]` | EP equivalents likely exist.                                |

### 4.2 Claim Summary

`[claim summary unverified — recommend USPTO PPUBS direct lookup before quoting in any external doc]`

In essence:

| Limitation gist                                                                                             |
|:------------------------------------------------------------------------------------------------------------|
| Multiple visible symbol positions per reel (stack), e.g., 3–4 positions.                                    |
| For each pay-symbol, count occurrences per reel.                                                            |
| Ways-to-win = product of per-reel occurrence counts across consecutive reels starting from reel 1.          |
| Award proportional to ways-count × per-symbol pay × bet-multiplier.                                          |
| (Dependent) Wild symbols substitute and multiply the count contribution.                                    |

### 4.3 Classic 243-ways vs. MultiWay Xtra

The classic 243-ways evaluator (3 positions per reel, 5 reels, 3^5 = 243 ways) pre-dates the MultiWay Xtra family and is generally considered prior art / generic.

MultiWay Xtra's distinguishing element is the **multi-symbol contribution per reel** with **stack-aware payout calculation** rather than positional payline matching.

| Engine               | Reel positions | Max ways                | Patent scope                  |
|:---------------------|:---------------|:------------------------|:------------------------------|
| Classic 243-ways     | 3              | 243                     | Generic — old prior art.      |
| 1024-ways            | 4              | 1024                    | Generic — old prior art.      |
| MultiWay Xtra        | 4              | 1024 (with stacking math)| IGT family in §4.1.          |
| Megaways (BTG)       | 2..7 variable  | 117,649                 | Separate family — see §2.     |

### 4.4 Stack-Based Payout Calculation

The IGT engine multiplies the **count of matching symbols on each reel** rather than awarding one win per payline. This dramatically changes presentation:

- Multiple wins per reel-strip rather than per-line.
- "Each way" of a pay is counted separately and summed.
- Display of "ways won" rather than "lines won".

### 4.5 Where IGT Licenses vs. Independent Invention

IGT broadly licenses MultiWay Xtra for land-based products. Online catalogues commonly avoid the patent by:

- Implementing 243/1024-ways (generic) and skipping stack-aware multipliers.
- Implementing variable-ways (Megaways family) and licensing/using-after-expiration.
- Avoiding marketing names ("MultiWay", "Xtra").

### 4.6 Vendor-Neutral Implementation

```js
// src/blocks/multiwayStack.mjs — generic ways-with-stack
export default {
  kind: 'multiwayStack',
  init(gdd) {
    return { reels: gdd.reels.length, posPerReel: gdd.reels[0].positions };
  },
  onSpinResult(ctx) {
    const grid = ctx.grid;
    const pays = [];
    for (const symKind of ctx.paySymbols) {
      let waysCount = 1;
      let stop = false;
      for (let r = 0; r < this.reels && !stop; r++) {
        const count = grid[r].filter(s => s === symKind || ctx.isWild(s)).length;
        if (count === 0) { stop = true; waysCount = 0; }
        else waysCount *= count;
      }
      if (waysCount > 0) pays.push({ symKind, ways: waysCount });
    }
    ctx.set('multiwayStack.pays', pays);
  },
};
```

This implementation uses ways-product math — the same arithmetic used by the generic 243-ways engine. The patent-distinguishing element (stack-aware bet-multiplier interplay) is intentionally omitted.

### 4.7 Open Questions for Counsel

| Question                                                                       | Why it matters                                          |
|:-------------------------------------------------------------------------------|:--------------------------------------------------------|
| Has US 6997804 entered terminal disclaimer territory with later IGT filings?   | Would reset expiration.                                 |
| What is the EPO family member number?                                          | EU market exposure.                                     |
| Does "stack" include 2x1 mega-symbols, or only 3+ positions?                   | Determines whether mega-symbol layouts infringe.        |

---

## 5. Scientific Games · Stepper / Reel Power

**Vendor:** Scientific Games / Light & Wonder (generic: all-ways evaluator with adjacency).
**Block-kind impacted:** `allWaysEvaluator`.

### 5.1 Patent Family

| Filing                              | Status               | Notes                                                |
|:------------------------------------|:---------------------|:-----------------------------------------------------|
| Reel Power family                   | `[Patent: unknown — needs lookup]` | Originated with Aristocrat then licensed/cross-pollinated. |
| Stepper evaluation patents          | `[claim summary unverified]`       | Multi-line vs. all-ways distinctions.       |

### 5.2 Multi-Line vs. All-Ways

| Approach        | Win condition                                                            | Patent landscape                                 |
|:----------------|:-------------------------------------------------------------------------|:-------------------------------------------------|
| Multi-line      | Symbols match across a fixed payline pattern (e.g., V-shape, zig-zag).   | Generic prior art (pre-1990s).                   |
| All-ways        | Any path left-to-right through one symbol per reel counts.               | Generic prior art (1990s).                       |
| Reel-power      | Active reels rather than lines; player buys reels.                       | Vendor-specific marketing; mechanic is old.      |
| Adjacent-ways   | Wins only along adjacent rows.                                           | Vendor-specific tweaks; rarely patented broadly. |

### 5.3 Adjacent-Ways vs. All-Ways

| Variant            | Adjacency required?                          | Common max ways    |
|:-------------------|:---------------------------------------------|:-------------------|
| All-ways           | No — any row position counts.                 | 243, 1024.         |
| Adjacent-ways      | Row position must match across reels.         | Smaller (e.g., 45).|
| Diagonal-only      | Diagonal-row positions only.                  | Niche.             |

### 5.4 Anchoring vs. Floating Wilds

| Wild behaviour          | Patent scope (generic studio)                   | Risk                              |
|:------------------------|:------------------------------------------------|:----------------------------------|
| Static wild             | None.                                            | Safe.                             |
| Expanding wild          | Some vendor-specific patents.                    | Low.                              |
| Walking/floating wild   | Sticky between spins, common but some claims.    | Medium (check vendor IP).         |
| Anchored wild reel      | Reel-wide wild held in place; old prior art.     | Safe.                             |

### 5.5 Vendor-Neutral Implementation

```js
// src/blocks/allWaysEvaluator.mjs
export default {
  kind: 'allWaysEvaluator',
  init(gdd) {
    return {
      adjacency: gdd.allWays.adjacency ?? 'none', // 'none' | 'row' | 'diagonal'
    };
  },
  onSpinResult(ctx) {
    // generic all-ways product; adjacency is a config toggle, not a separate block
    // …
  },
};
```

---

## 6. WMS · Adaptive Gaming / Personality Game

**Vendor:** WMS / Light & Wonder (generic: player-profile-driven feature trigger).
**Block-kind impacted:** `adaptiveFeatureTrigger`.

### 6.1 Patent Family

| Filing                                  | Status                                  | Notes                                                  |
|:----------------------------------------|:----------------------------------------|:-------------------------------------------------------|
| Adaptive Gaming family (WMS)            | `[Patent: unknown — needs lookup]`      | Mid-2000s filings.                                     |
| Personality Game family                 | `[claim summary unverified]`            | Player-profile heuristics drive feature pacing.        |

### 6.2 Player Profile-Driven Feature Triggering

The concept: the machine identifies behavioural profile cues (bet size variance, spin tempo, near-miss reactions) and adjusts feature exposure accordingly. The patents reportedly cover:

| Limitation gist                                                                                  |
|:-------------------------------------------------------------------------------------------------|
| Track behavioural metric per session.                                                            |
| Classify player into one of N profile buckets.                                                   |
| Modify trigger probability or pacing within the configured RTP envelope.                          |
| Persist profile across sessions linked to a loyalty card identifier.                              |

### 6.3 Compulsive Gambling Regulator Overlap

Most jurisdictions blocked WMS/SG from deploying adaptive triggering in production because:

- **UKGC** regulations require RTP and feature probabilities be **independent of player identity**.
- **MGA** similar.
- **NJ DGE** treats variable per-player odds as material adverse.
- **AU** state regulators (NSW, VIC) explicitly forbid identity-conditioned outcomes.

Result: even where granted, these patents are largely unusable in regulated markets. They live on as defensive IP.

### 6.4 Implementation Guidance

**Do not implement player-profile-driven outcome math.** Adaptive presentation (skinning, theming, banner pacing) is acceptable. Outcome-affecting adaptation is not.

| Allowed                                                       | Forbidden                                                              |
|:--------------------------------------------------------------|:-----------------------------------------------------------------------|
| Banner/animation pacing tied to spin tempo.                   | Trigger probability tied to player profile.                            |
| UI theme variation per loyalty tier.                          | RTP variation per player.                                              |
| Bonus offer surfaced based on session length (CRM-level).      | In-game outcome math conditioned on identity.                          |

---

## 7. NetEnt · Cluster Pays family

**Vendor:** NetEnt (generic: cluster-connected-component evaluator).
**Block-kind impacted:** `clusterPays`.

### 7.1 Patent Family

| Filing                                | Status                                  | Notes                                                  |
|:--------------------------------------|:----------------------------------------|:-------------------------------------------------------|
| Cluster Pays origination              | `[Patent: unknown — needs lookup]`      | Mid-2010s EU + US filings.                             |
| Cluster + cascading combo claims      | `[claim summary unverified]`            | Combined claim sets typical.                           |

### 7.2 Cluster Identification Algorithm

The defining algorithm: a connected-component (flood-fill) scan over the grid identifying groups of N or more matching adjacent symbols. Generic implementation:

```js
function findClusters(grid, minSize) {
  const visited = Array.from({length: grid.length}, () =>
    new Array(grid[0].length).fill(false));
  const clusters = [];
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[0].length; c++) {
      if (visited[r][c] || !grid[r][c]) continue;
      const symbol = grid[r][c];
      const stack = [[r, c]];
      const member = [];
      while (stack.length) {
        const [cr, cc] = stack.pop();
        if (cr < 0 || cc < 0 || cr >= grid.length || cc >= grid[0].length) continue;
        if (visited[cr][cc] || grid[cr][cc] !== symbol) continue;
        visited[cr][cc] = true;
        member.push([cr, cc]);
        stack.push([cr+1, cc], [cr-1, cc], [cr, cc+1], [cr, cc-1]);
      }
      if (member.length >= minSize) clusters.push({ symbol, member });
    }
  }
  return clusters;
}
```

The flood-fill itself is textbook computer science (decades pre-dates any slot patent) and is **not** patentable in isolation. The patentable element is the **combination** of:

- Cluster evaluation on a slot grid.
- Cluster size threshold for pay.
- Removal of cluster members and cascading replacement.
- Per-cluster multiplier persistence.

### 7.3 Avalanche-Triggered Cluster Re-Evaluation

After a paid cluster, members are removed and the column collapses. The grid is re-evaluated; new clusters may form; the process repeats until no clusters remain.

| Step               | Description                                                              |
|:-------------------|:-------------------------------------------------------------------------|
| Pay clusters       | Identify and pay all clusters ≥ minSize.                                 |
| Remove members     | Set member cells empty.                                                  |
| Collapse           | Drop existing symbols down to fill empty cells.                          |
| Refill             | New symbols drop into the top of each column.                            |
| Re-evaluate        | Loop until no new clusters.                                              |

This is a `cascadeEngine` interaction with a `clusterPays` evaluator. In `slot-gdd-factory`, these should be **two separate blocks**, not one combined block, to satisfy LEGO-modularity.

### 7.4 Cascading Multiplier Per Cluster

A multiplier increment per cascade or per cluster paid. This is a **separate inventive step** in some NetEnt families. Implementation should be a `cascadeMultiplier` block, not bundled into `clusterPays`.

### 7.5 Differentiation from Big Time Gaming's Pre-Cluster Pays

BTG's "Bonanza" and similar predate NetEnt's cluster patents in some respects but are evaluated as ways-based with cascades, not connected-component matching. The legal distinction matters:

| Vendor    | Mechanic           | Evaluator type             | Patent landscape                            |
|:----------|:-------------------|:---------------------------|:--------------------------------------------|
| BTG        | Megaways           | Variable ways (product)    | NZ 716804, expired 2024 (§2).              |
| NetEnt     | Cluster Pays       | Connected components       | Active family (§7).                         |
| Yggdrasil  | Cluster + drop     | Connected components       | Yggdrasil family (§8).                      |
| ELK Studios| Cluster + AvalonX  | Connected components       | Separate ELK filings `[unknown — lookup]`.  |

---

## 8. Yggdrasil · Drop Engine / Multifly

**Vendor:** Yggdrasil (generic: column-pack cascading engine).
**Block-kind impacted:** `cascadeEngine`.

### 8.1 Patent Family

| Filing                              | Status                              | Notes                                                  |
|:------------------------------------|:------------------------------------|:-------------------------------------------------------|
| Drop Engine family                  | `[Patent: unknown — needs lookup]`  | EU filings primary.                                    |
| Multifly multiplier-persistence     | `[claim summary unverified]`        | Multiplier ladder per cascade.                         |

### 8.2 Symbol-Drop Physics

Two competing physics models:

| Model            | Behaviour                                                              | Vendor association             |
|:-----------------|:-----------------------------------------------------------------------|:-------------------------------|
| Tetris-style     | Symbols fall position-by-position; gaps fill upward.                   | Generic / NetEnt cluster.       |
| Column-pack      | Entire column collapses; new symbols enter from top in bulk.           | Yggdrasil drop engine.         |
| Anchored cascade | Some symbols (wilds, mystery) remain locked while others drop.         | Various vendors.               |
| Vertical-shift   | Symbols slide rather than fall (presentation effect).                  | Cosmetic; no patent.           |

The Yggdrasil drop family allegedly distinguishes on the column-pack timing model. Tetris-style drop is generic and pre-dates the family.

### 8.3 Multiplier Persistence Across Cascades

In Multifly-style implementations, a multiplier counter persists and increments per cascade, often capped per session or per spin. Implementation:

```js
// src/blocks/cascadeMultiplier.mjs
export default {
  kind: 'cascadeMultiplier',
  init(gdd) {
    return {
      ladder: gdd.cascadeMultiplier.ladder ?? [1, 2, 3, 5, 10, 25],
      resetOn: gdd.cascadeMultiplier.resetOn ?? 'spinEnd',
    };
  },
  onTumbleStep(ctx) {
    const idx = Math.min(ctx.tumbleIndex, this.ladder.length - 1);
    ctx.set('multiplier', this.ladder[idx]);
  },
  postSpin(ctx) {
    if (this.resetOn === 'spinEnd') ctx.set('multiplier', this.ladder[0]);
  },
};
```

### 8.4 Free-Spin Persistence

In some Yggdrasil titles, the multiplier persists across the free-spins feature. This is a `featureMultiplierPersist` configuration on the same block, not a separate block.

### 8.5 Differentiation from NetEnt Cluster + Cascade

| Element             | NetEnt cluster + avalanche      | Yggdrasil drop engine                  |
|:--------------------|:--------------------------------|:---------------------------------------|
| Evaluation          | Connected components.           | Often line- or way-based.              |
| Drop physics        | Tetris-style.                   | Column-pack.                           |
| Multiplier scope    | Per cluster + per cascade.      | Per cascade, persistent in FS.         |
| Patent overlap?     | Different claim families.       | Different claim families.              |

---

## 9. Relax Gaming · Dream Drop / Money Train Bonus

**Vendor:** Relax Gaming (generic: progressive-drop jackpot + bonus-game).
**Block-kind impacted:** `progressiveDropJackpot`, `bonusGame`.

### 9.1 Patent Family

| Filing                                  | Status                              | Notes                                                  |
|:----------------------------------------|:----------------------------------------|:--------------------------------------------------|
| Dream Drop progressive family            | `[Patent: unknown — needs lookup]`      | Likely MGA-aligned EU filings.                    |
| Money Train Bonus mechanic               | `[claim summary unverified]`            | Bonus + persistent symbols.                       |

### 9.2 Progressive Jackpot Tier Patents

Tiered progressive pools are generic prior art. The Dream Drop family allegedly distinguishes on:

| Limitation gist                                                                                |
|:-----------------------------------------------------------------------------------------------|
| Multi-tier pool fed by per-spin contribution.                                                  |
| Tier reveal contingent on bonus trigger AND tier ladder progression mini→...→mega.            |
| Cross-game pool (multiple game IDs feed same pool).                                            |
| Triggering mechanic uses dedicated symbol distinct from regular bonus.                         |

The cross-game pool is the most defensible inventive step. Generic per-game tiered jackpots are old prior art (IGT MegaJackpots, WMS, etc.).

### 9.3 Bonus-Buy + Jackpot Interaction

In Money Train-style titles, the bonus-buy option permits entering the bonus game directly. The interplay with jackpot pool contributions is allegedly within scope:

| Element                                            | Patent scope?         | Risk                                       |
|:---------------------------------------------------|:----------------------|:-------------------------------------------|
| Bonus-buy in slots generally                       | Generic prior art.    | Safe.                                      |
| Bonus-buy with jackpot pool eligibility            | Possibly in scope.    | Medium.                                    |
| Tier reveal animation                              | Cosmetic.             | Safe.                                      |

### 9.4 Multi-Instance Jackpot Pooling

A single pool feeding multiple game IDs is generic in physical land-based MegaJackpots networks. For online, the implementation pattern is a server-side pool service consumed by each game RGS instance. Patent coverage focuses on the in-game presentation, not the back-end pool architecture.

### 9.5 Vendor-Neutral Implementation

```js
// src/blocks/progressiveDropJackpot.mjs
export default {
  kind: 'progressiveDropJackpot',
  init(gdd) {
    return {
      tiers: gdd.progressiveDrop.tiers ?? ['mini', 'minor', 'major', 'mega', 'grand'],
      contributionRate: gdd.progressiveDrop.contributionRate, // per spin
    };
  },
  postSpin(ctx) {
    // contribute to pool via RGS service (external)
    ctx.rgs.contribute(this.contributionRate * ctx.bet);
  },
  onSpinResult(ctx) {
    if (ctx.matches('jackpotTrigger')) {
      const tier = ctx.rng.pickTier(this.tiers);
      ctx.awardJackpot(tier);
    }
  },
};
```

---

## 10. Wazdan · Hold the Jackpot

**Vendor:** Wazdan (generic: bonus-orb collect with tier-jackpot reveal).
**Block-kind impacted:** `bonusOrbCollect`.

### 10.1 Patent Family

| Filing                                    | Status                              | Notes                                                  |
|:------------------------------------------|:------------------------------------|:-------------------------------------------------------|
| Hold the Jackpot family                   | `[Patent: unknown — needs lookup]`  | Wazdan EU filings.                                     |
| Frozen-reel bonus trigger                 | `[claim summary unverified]`        | Trigger pattern overlap with §3.                       |

### 10.2 Bonus-Orb Collect

Bonus orbs accumulate during a respin feature; values revealed on each orb sum at feature end. This pattern overlaps heavily with Aristocrat Lightning Link (§3). Wazdan's defensible scope is narrower because Aristocrat's family generally has priority.

### 10.3 Tier-Based Jackpot Reveal

The mini/minor/major/grand ladder is generic prior art. The reveal animation and the orb-value mapping are cosmetic.

### 10.4 Frozen-Reel Bonus Trigger

A specific variant: rather than orb-collect, certain reels freeze when triggering symbols land, and respins occur on the unfrozen reels. This is implementable as a `frozenReelRespin` block.

```js
// src/blocks/frozenReelRespin.mjs
export default {
  kind: 'frozenReelRespin',
  init(gdd) {
    return {
      triggerSymbol: gdd.frozenReelRespin.triggerSymbol,
      respinCount: gdd.frozenReelRespin.respinCount ?? 3,
    };
  },
  onSpinResult(ctx) {
    const triggeringReels = ctx.reelsContaining(this.triggerSymbol);
    if (triggeringReels.length >= 2) {
      ctx.freeze(triggeringReels);
      ctx.enterRespin(this.respinCount);
    }
  },
};
```

---

## 11. Stake Engine (provably-fair RNG)

**Vendor:** Stake.com / Stake Engine (generic: client-seed + server-seed + nonce hash chain).
**Block-kind impacted:** `provablyFairRng`.

### 11.1 Patent Family

| Filing                                | Status                              | Notes                                                  |
|:--------------------------------------|:------------------------------------|:-------------------------------------------------------|
| Provably-fair hash chain              | `[Patent: unknown — needs lookup]`  | Patent landscape unsettled; some defensive filings.    |
| Client-seed disclosure variants       | `[claim summary unverified]`        | Specific UI flows have patent claims.                  |

### 11.2 Cryptographic RNG Architecture

The provably-fair scheme:

| Step | Action                                                                            |
|:-----|:----------------------------------------------------------------------------------|
| 1    | Server commits a hash of a server-seed to the player.                             |
| 2    | Player supplies (or receives a default) client-seed.                              |
| 3    | Each spin uses a monotonically increasing nonce.                                  |
| 4    | RNG output = `HMAC-SHA256(server_seed, client_seed || ":" || nonce)`.            |
| 5    | At seed rotation, the server reveals the prior seed; player verifies the hash commit. |

### 11.3 Regulator vs. Provably-Fair Compatibility

| Regulator       | Provably-fair acceptable?       | Notes                                                          |
|:----------------|:--------------------------------|:---------------------------------------------------------------|
| UKGC            | Conditional                     | Requires certified RNG; provably-fair on top is acceptable.    |
| MGA             | Conditional                     | Audit trail must match.                                        |
| Curacao         | Yes                             | Curacao-friendly to provably-fair from inception.              |
| NJ DGE          | Generally no                    | Must use approved RNG provider.                                |
| AU state regs   | No                              | Not currently accepted.                                        |

### 11.4 Implementation Skeleton

```js
// src/blocks/provablyFairRng.mjs
import { hmac } from 'node:crypto';
export default {
  kind: 'provablyFairRng',
  init(gdd) {
    return {
      hashFn: 'HMAC-SHA256',
      rotateAfterSpins: gdd.provablyFairRng.rotateAfter ?? 1000,
    };
  },
  preSpin(ctx) {
    const message = `${ctx.session.clientSeed}:${ctx.session.nonce}`;
    const hash = hmac('sha256', ctx.session.serverSeed)
      .update(message)
      .digest('hex');
    ctx.set('rng.seed', hash);
    ctx.session.nonce += 1;
  },
  postSpin(ctx) {
    if (ctx.session.nonce >= this.rotateAfterSpins) {
      ctx.session.revealServerSeed();
      ctx.session.rotateServerSeed();
    }
  },
};
```

### 11.5 Hash Chain Design

The hash chain is **not** patented in its generic form (HMAC-SHA256 with seed and nonce is generic crypto). Vendor-specific patents claim narrower UI flows (e.g., the moment of commitment, the seed-rotation UI). Generic implementation is safe.

---

## 12. Evolution · Slingo (bingo-slot fusion)

**Vendor:** Evolution / Slingo Originals (generic: bingo-slot fusion evaluator).
**Block-kind impacted:** `bingoSlotFusion`.

### 12.1 Patent Family

| Filing                                | Status                              | Notes                                                  |
|:--------------------------------------|:------------------------------------|:-------------------------------------------------------|
| Slingo origination marks              | `[Patent: unknown — needs lookup]`  | US, UK, EU marks.                                      |
| 5x5 grid bingo evaluation             | `[claim summary unverified]`        | Specific to Slingo.                                    |

### 12.2 5x5 Grid Evaluation

The classic Slingo grid: a 5x5 bingo card. Each spin drops a single 1x5 row from a reel-strip; numbers matching uncovered cells daub them. Lines (horizontal, vertical, diagonal) pay according to the paytable.

| Element              | Patent scope?                  | Implementation                                  |
|:---------------------|:-------------------------------|:------------------------------------------------|
| Bingo card daubing   | Bingo prior art (very old).    | Safe.                                           |
| Reel-driven daubing  | Slingo combination.            | Trademark and patent scope.                     |
| 1x5 strip per spin   | Slingo-specific.               | Trademark and patent scope.                     |
| Multi-line bingo pay | Generic.                       | Safe.                                           |

### 12.3 Joker Substitutions

A Joker symbol daubs any cell in its column. A Super Joker daubs any cell.

| Joker variant   | Generic prior art?             | Vendor-specific?                                |
|:----------------|:-------------------------------|:------------------------------------------------|
| Column joker    | Bingo prior art.               | Cosmetic.                                       |
| Super joker     | Combined with respin claims.   | Some scope under Slingo.                        |

### 12.4 Free-Spin Retrigger

A "free spin" in Slingo context is additional reel drops, often awarded by reaching a line on the prize ladder. Implementation:

```js
// src/blocks/bingoSlotFusion.mjs
export default {
  kind: 'bingoSlotFusion',
  init(gdd) {
    return {
      gridSize: gdd.bingoSlot.gridSize ?? [5, 5],
      retriggerLadder: gdd.bingoSlot.retriggerLadder ?? [],
    };
  },
  preSpin(ctx) {
    const strip = ctx.rng.drawStripFromReel(this.gridSize[0]);
    ctx.set('bingo.currentStrip', strip);
  },
  onSpinResult(ctx) {
    const strip = ctx.get('bingo.currentStrip');
    for (let c = 0; c < strip.length; c++) {
      const number = strip[c];
      ctx.daubColumn(c, number); // marks any matching cell in column c
    }
    ctx.evaluateLines();
    const ladderLevel = ctx.getLadderLevel();
    if (this.retriggerLadder.includes(ladderLevel)) {
      ctx.awardFreeSpin();
    }
  },
};
```

### 12.5 Trademark vs. Patent

"Slingo" is a registered trademark. Cloning the **word** Slingo is forbidden. Cloning the mechanic — bingo card daubed by reel-row reveal — has narrower patent exposure. Vendors typically license the brand rather than rebuild.

---

## 13. Lock & Win / Hold & Win Generic Patterns

**Vendor:** none — generic mechanic (generic: hold-and-respin generic).
**Block-kind impacted:** `lockAndRespinGeneric`.

### 13.1 Pre-2014 Prior Art

Hold-and-respin patterns have multiple prior art roots:

| Source                                  | Approximate date      | Description                                          |
|:----------------------------------------|:----------------------|:-----------------------------------------------------|
| Land-based "hold" buttons               | 1970s–80s (UK AWP)    | Player presses "hold" to lock a reel.                |
| IGT respin variants                     | Early 2000s           | Mystery feature lock-and-respin.                     |
| Konami respin variants                  | Mid-2000s             | Trigger-symbol lock with respin counter.             |
| WMS respin variants                     | Mid-2000s             | Various lock-and-spin themes.                        |
| Aristocrat Lightning Link               | 2014+                 | The specific orb-collect + reset-on-land pattern.    |

### 13.2 Why No Single Vendor Owns the Generic Pattern

The generic pattern — "lock symbols, respin remaining reels, award based on locked symbols" — predates modern patent filings and is broadly recognised as prior art. Vendor patents target **specific** combinations (reset-on-land, orb-collect, tier-reveal) rather than the generic pattern.

### 13.3 Implementation Skeleton

```js
// src/blocks/lockAndRespinGeneric.mjs
export default {
  kind: 'lockAndRespinGeneric',
  init(gdd) {
    return {
      triggerKind: gdd.lockAndRespin.triggerKind,
      respinCount: gdd.lockAndRespin.respinCount ?? 3,
      resetOnLand: false, // OFF by default — avoid Aristocrat overlap unless explicitly licensed
    };
  },
  onSpinResult(ctx) {
    const lockSymbols = ctx.symbolsOfKind(this.triggerKind);
    if (lockSymbols.length >= 3) {
      ctx.lock(lockSymbols);
      ctx.enterRespin(this.respinCount);
    }
  },
  preSpin(ctx) {
    if (ctx.inRespin) {
      const newLocks = ctx.newlyLandedOfKind(this.triggerKind);
      if (newLocks.length > 0) {
        ctx.lock(newLocks);
        if (this.resetOnLand) ctx.resetRespinCounter();
      }
    }
  },
};
```

### 13.4 Configuration vs. Patent Risk

| Config flag           | Default                  | Activating = patent risk?                                |
|:----------------------|:-------------------------|:---------------------------------------------------------|
| `resetOnLand`         | `false`                  | `true` → Aristocrat overlap.                             |
| `tierReveal`          | `false`                  | `true` → Aristocrat overlap if combined with orb-collect.|
| `crossTerminalPool`   | `false`                  | `true` → Relax / Aristocrat overlap.                     |
| `orbCollectValueSum`  | `false`                  | `true` → Aristocrat overlap.                             |

`FeatureArchitect` should refuse to enable flags that, in combination, reproduce a vendor-patented claim set unless explicit licence is recorded in the GDD.

---

## 14. Patent Expiration Timeline

> All entries below are **best-effort** based on public records and industry reporting. `[claim summary unverified]` for any with that marker. Counsel verification required before publishing externally.

| §   | Patent number              | Filed   | Granted | Expires (est.) | Affected vendor      | Jurisdiction | Block kind impacted        | Verified? |
|:----|:---------------------------|:--------|:--------|:---------------|:---------------------|:-------------|:---------------------------|:----------|
| 2   | `[Patent: NZ 716804]`      | 2014    | 2016    | June 2024 (EXPIRED) | Big Time Gaming  | NZ           | `variableWays`             | Yes — well documented industry-wide |
| 3   | `[Patent: AU 2014203832]`  | 2014    | 2016+   | ~2034          | Aristocrat           | AU           | `holdAndRespin`            | `[unverified]` |
| 3   | `[Patent: US 9633511]`     | ~2013   | 2017    | ~2033          | Aristocrat           | US           | `holdAndRespin`            | `[unverified]` |
| 3   | `[Patent: US 9165433]`     | ~2013   | 2015    | ~2033          | Aristocrat           | US           | `holdAndRespin`            | `[unverified]` |
| 4   | `[Patent: US 6997804]`     | ~2002   | 2006    | ~2022 (EXPIRED) | IGT                 | US           | `multiwayStack`            | `[unverified]` |
| 4   | `[Patent: US 7014557]`     | ~2003   | 2006    | ~2023 (EXPIRED) | IGT                 | US           | `multiwayStack`            | `[unverified]` |
| 5   | `[Patent: unknown — needs lookup]` | — | — | — | Scientific Games / Aristocrat | — | `allWaysEvaluator` | `[unverified]` |
| 6   | `[Patent: unknown — needs lookup]` | — | — | — | WMS / Light & Wonder | — | `adaptiveFeatureTrigger`   | `[unverified]` |
| 7   | `[Patent: unknown — needs lookup]` | — | — | — | NetEnt              | EU           | `clusterPays`              | `[unverified]` |
| 8   | `[Patent: unknown — needs lookup]` | — | — | — | Yggdrasil           | EU           | `cascadeEngine`            | `[unverified]` |
| 9   | `[Patent: unknown — needs lookup]` | — | — | — | Relax Gaming        | EU           | `progressiveDropJackpot`   | `[unverified]` |
| 10  | `[Patent: unknown — needs lookup]` | — | — | — | Wazdan              | EU           | `bonusOrbCollect`          | `[unverified]` |
| 11  | `[Patent: unknown — needs lookup]` | — | — | — | Stake               | various      | `provablyFairRng`          | `[unverified]` |
| 12  | `[Patent: unknown — needs lookup]` | — | — | — | Slingo Originals    | US/UK        | `bingoSlotFusion`          | `[unverified]` |

### 14.1 Term Calculation Caveats

- US utility patents: 20 years from earliest non-provisional filing, subject to Patent Term Adjustment (PTA) and Patent Term Extension (PTE).
- AU standard patents: 20 years from filing.
- AU innovation patents (now closed for new filings): 8 years.
- NZ patents: 20 years from filing, conditioned on annuity payment.
- EP: 20 years from filing per national EP designation; annuities required per state.

The factory should treat the expiration column as **indicative only**. Counsel must verify annuity payments and any PTE before declaring a patent free-of-coverage.

### 14.2 Expiration-Triggered Market Events

| Year    | Event (likely)                                                                                |
|:--------|:----------------------------------------------------------------------------------------------|
| 2022    | Some early IGT MultiWay patents enter end-of-term.                                            |
| 2023    | IGT US 7014557 likely expired.                                                                |
| 2024 H1 | **Big Time Gaming NZ 716804 expires (June 2024).** Major industry pivot.                       |
| 2025–28 | NetEnt cluster family early members likely approach expiration.                                |
| 2030+   | Aristocrat Lightning Link family early members approach expiration.                            |

---

## 15. Clean-Room Implementation Guide

> For each numbered patent area, the table below summarises what `FeatureArchitect` can safely emit into a GDD without licence, what it must omit, and where counsel review is mandatory.

### 15.1 §2 Big Time Gaming · Megaways

| Element                                            | Safe?                          | Notes                                                          |
|:---------------------------------------------------|:-------------------------------|:---------------------------------------------------------------|
| Variable per-reel symbol count                     | Yes (post-June 2024)           | Patent expired.                                                |
| Carriage reel above main reels                     | Yes (post-June 2024)           | Patent expired.                                                |
| Mystery symbol with one-spin reveal                | Yes                            | Generic prior art.                                             |
| Unlimited multiplier in feature                    | Conditional                    | Combine with cascadeMultiplier; verify Yggdrasil family scope. |
| Brand "Megaways"                                   | No                             | Trademark separate.                                            |

### 15.2 §3 Aristocrat · Lightning Link

| Element                                            | Safe?                          | Notes                                                          |
|:---------------------------------------------------|:-------------------------------|:---------------------------------------------------------------|
| Generic hold-and-respin                            | Yes                            | Old prior art.                                                 |
| Orb-collect symbol pattern                         | Conditional (counsel)          | Combined with reset-on-land = high risk.                       |
| Reset-on-land respin counter                       | No                             | Core inventive step; avoid.                                    |
| Tier-ladder reveal (mini/minor/major/grand)        | Conditional                    | Combined with orb-collect = high risk.                         |
| Cross-terminal jackpot pool                        | Yes                            | Old prior art (IGT MegaJackpots-era).                          |

### 15.3 §4 IGT · MultiWay Xtra

| Element                                            | Safe?                          | Notes                                                          |
|:---------------------------------------------------|:-------------------------------|:---------------------------------------------------------------|
| 243-ways evaluator                                 | Yes                            | Generic prior art.                                             |
| 1024-ways evaluator                                | Yes                            | Generic prior art.                                             |
| Stack-aware ways product (no bet multiplier link)  | Yes                            | Generic.                                                       |
| Stack-aware bet-multiplier interplay               | Conditional (counsel)          | Specific to MultiWay Xtra; some patents may have expired.      |
| Brand "MultiWay Xtra"                              | No                             | Trademark separate.                                            |

### 15.4 §5 Scientific Games · Stepper

| Element                                            | Safe?                          | Notes                                                          |
|:---------------------------------------------------|:-------------------------------|:---------------------------------------------------------------|
| All-ways evaluator                                 | Yes                            | Generic.                                                       |
| Adjacent-ways evaluator                            | Conditional                    | Adjacent variant has some vendor IP overlap.                   |
| Anchored wild reel                                 | Yes                            | Generic.                                                       |
| Reel-power "buy a reel" feature                    | Conditional                    | Marketing trademark; mechanic generic.                         |

### 15.5 §6 WMS · Adaptive Gaming

| Element                                            | Safe?                          | Notes                                                          |
|:---------------------------------------------------|:-------------------------------|:---------------------------------------------------------------|
| Player-profile outcome conditioning                | No (regulator)                 | Banned in regulated markets; do not implement.                 |
| Player-profile UI/presentation conditioning        | Yes                            | Cosmetic only.                                                 |
| CRM-driven offer surfacing                         | Yes (out of game)              | Belongs to platform CRM, not game block.                       |

### 15.6 §7 NetEnt · Cluster Pays

| Element                                            | Safe?                          | Notes                                                          |
|:---------------------------------------------------|:-------------------------------|:---------------------------------------------------------------|
| Connected-component cluster evaluator              | Conditional (counsel)          | Generic algorithm; vendor patents target combinations.         |
| Cluster + cascade combo                            | Conditional (counsel)          | Likely covered; review required.                               |
| Per-cluster multiplier                             | Conditional                    | Some vendor overlap.                                           |

### 15.7 §8 Yggdrasil · Drop Engine

| Element                                            | Safe?                          | Notes                                                          |
|:---------------------------------------------------|:-------------------------------|:---------------------------------------------------------------|
| Tetris-style symbol drop                           | Yes                            | Generic.                                                       |
| Column-pack timing model                           | Conditional (counsel)          | Yggdrasil distinguishes here.                                  |
| Multiplier persistence in free spins               | Conditional                    | Various vendor overlaps.                                       |

### 15.8 §9 Relax Gaming · Dream Drop

| Element                                            | Safe?                          | Notes                                                          |
|:---------------------------------------------------|:-------------------------------|:---------------------------------------------------------------|
| Single-game tiered jackpot                         | Yes                            | Generic.                                                       |
| Cross-game pooled jackpot                          | Conditional (counsel)          | Patent scope possible; review required.                        |
| Bonus-buy with jackpot eligibility                 | Conditional                    | Specific Relax combinations.                                   |

### 15.9 §10 Wazdan · Hold the Jackpot

| Element                                            | Safe?                          | Notes                                                          |
|:---------------------------------------------------|:-------------------------------|:---------------------------------------------------------------|
| Generic orb-collect                                | Conditional                    | Heavy Aristocrat overlap (§3).                                 |
| Frozen-reel respin                                 | Conditional                    | Specific to Wazdan.                                            |
| Tier reveal                                        | Conditional                    | Generic ladder, specific reveal patterns covered.              |

### 15.10 §11 Stake Engine

| Element                                            | Safe?                          | Notes                                                          |
|:---------------------------------------------------|:-------------------------------|:---------------------------------------------------------------|
| HMAC-SHA256 hash chain RNG                         | Yes                            | Generic crypto.                                                |
| Server-seed commitment UI                          | Conditional                    | Specific UI patents possible.                                  |
| Player-supplied client-seed                        | Yes                            | Generic.                                                       |

### 15.11 §12 Evolution · Slingo

| Element                                            | Safe?                          | Notes                                                          |
|:---------------------------------------------------|:-------------------------------|:---------------------------------------------------------------|
| Bingo card daubing                                 | Yes                            | Generic bingo prior art.                                       |
| Reel-driven daubing on 5x5                         | Conditional (trademark+patent) | Slingo Originals scope; brand is registered.                   |
| Joker substitution                                 | Yes                            | Generic.                                                       |
| Brand "Slingo"                                     | No                             | Trademark separate.                                            |

### 15.12 §13 Lock & Win / Hold & Win Generic

| Element                                            | Safe?                          | Notes                                                          |
|:---------------------------------------------------|:-------------------------------|:---------------------------------------------------------------|
| Generic lock-and-respin                            | Yes                            | Old prior art.                                                 |
| Lock + reset-on-land respin                        | No (Aristocrat overlap)        | Avoid unless licence in place.                                 |
| Lock + tier reveal                                 | Conditional                    | Combined with orb-collect → Aristocrat overlap.                |

### 15.13 When to Consult Counsel

| Trigger condition                                                                       | Action                              |
|:----------------------------------------------------------------------------------------|:------------------------------------|
| GDD asks for a vendor-named mechanic by brand.                                          | Refuse — use generic block kind.    |
| GDD enables `resetOnLand`, `tierReveal`, `crossTerminalPool` flags together.            | Mandatory counsel review.           |
| GDD asks for player-profile-driven outcome conditioning.                                | Refuse — regulator violation.       |
| GDD names "Megaways", "Slingo", "MegaJackpots", "Lightning Link", "Hyperlink", etc.     | Refuse — trademark, even if patent free. |
| GDD asks for cross-game pool with specific tier-reveal sequencing.                      | Counsel review.                     |
| GDD asks for cluster+cascade+per-cluster multiplier combined.                           | Counsel review.                     |

---

## 16. Vendor-Neutral Glossary Mapping

> Every game-facing artefact (GDD body, PAR sheet, capsule, marketing copy) MUST use the right-hand column. The left-hand column may only appear in internal research-pool material like this file.

| # | Vendor term (left = research-pool only)            | Vendor-neutral term (right = game-facing required)                  |
|:--|:---------------------------------------------------|:--------------------------------------------------------------------|
| 1 | Megaways                                            | variable-ways engine                                                |
| 2 | Megaclusters                                        | shifting-cluster engine                                             |
| 3 | Lightning Link                                      | orb-collect hold-and-respin                                         |
| 4 | Hyperlink                                           | linked-progressive hold-and-respin                                  |
| 5 | Hold and Win (Wazdan)                               | bonus-orb collect respin                                            |
| 6 | Cash Eruption                                       | volcanic theme orb-collect (theme-neutral: orb-collect)             |
| 7 | Cash Express                                        | tiered jackpot ladder                                               |
| 8 | Wolf Run                                            | adjacent-ways evaluator                                             |
| 9 | Cleopatra                                           | ancient-Egypt themed (theme-neutral: ancient civilisation theme)    |
| 10| Buffalo                                             | reel-power 1024-ways theme                                          |
| 11| MultiWay Xtra                                       | stack-aware ways evaluator                                          |
| 12| Reel Power                                          | active-reels purchase model                                         |
| 13| Stepper                                             | reel-based all-ways evaluator                                       |
| 14| Adaptive Gaming                                     | player-profile presentation (regulatorily restricted)               |
| 15| Personality Game                                    | player-profile presentation (regulatorily restricted)               |
| 16| Cluster Pays                                        | connected-component evaluator                                       |
| 17| Avalanche                                           | cascading-symbol engine                                             |
| 18| Tumble                                              | cascading-symbol engine                                             |
| 19| Drop Engine                                         | column-pack cascading engine                                        |
| 20| Multifly                                            | per-cascade multiplier ladder                                       |
| 21| Dream Drop                                          | tiered-progressive cross-game jackpot                               |
| 22| Money Train                                         | persistent-symbol bonus game                                        |
| 23| MegaJackpots                                        | linked-network tiered progressive                                   |
| 24| Hold the Jackpot                                    | bonus-orb collect with tier reveal                                  |
| 25| Frozen Wilds                                        | held wild between spins                                             |
| 26| Sticky Wilds                                        | held wild between spins                                             |
| 27| Walking Wilds                                       | translating wild between spins                                      |
| 28| Expanding Wilds                                     | reel-fill wild                                                      |
| 29| Mystery Symbol                                      | placeholder-reveal symbol                                           |
| 30| Mystery Stack                                       | full-reel placeholder reveal                                        |
| 31| Slingo                                              | bingo-slot fusion (mark only — brand restricted)                    |
| 32| Free Spins (when branded)                           | free-spin feature (generic)                                         |
| 33| Bonus Buy                                           | feature purchase                                                    |
| 34| Ante Bet                                            | enhanced-trigger wager option                                       |
| 35| Risk Game                                           | optional gamble                                                     |
| 36| Provably Fair                                       | cryptographically verifiable RNG                                    |
| 37| Stake Engine                                        | client-seed + server-seed + nonce RNG                               |
| 38| Smart Wager                                         | configurable bet builder                                            |
| 39| Big Win Banner                                      | win-tier celebration banner                                         |
| 40| Mega Win / Super Win / Ultra Win                    | win-tier celebration banner (tier name configurable)                |
| 41| Reel Sync                                           | synchronised-reel feature                                           |
| 42| Linked Reels                                        | synchronised-reel feature                                           |
| 43| Colossal Symbols                                    | mega-symbol (2x2 or larger)                                         |
| 44| Mega Symbols                                        | mega-symbol (2x2 or larger)                                         |
| 45| Cascading Wins                                      | cascading-symbol engine                                             |
| 46| Avalanche Multiplier                                | per-cascade multiplier ladder                                       |
| 47| Tumble Multiplier                                   | per-cascade multiplier ladder                                       |
| 48| Mystery Reveal                                      | placeholder-reveal symbol                                           |
| 49| Mystery Stack (BTG)                                 | full-reel placeholder reveal                                        |
| 50| Pots of Gold                                        | tiered-jackpot pots reveal                                          |
| 51| Money Symbol Collect                                | value-on-symbol collect                                             |
| 52| Wheel Bonus                                         | wheel-based bonus pick                                              |
| 53| Pick'em Bonus                                       | pick-bonus mini-game                                                |
| 54| Trail Bonus                                         | path-progression bonus                                              |
| 55| Hi-Lo Gamble                                        | binary-risk gamble round                                            |
| 56| Card Gamble                                         | binary-risk gamble round (cards)                                    |
| 57| Sticky Re-spins                                     | hold-and-respin with held trigger                                   |

> Row count: **57**.

---

## 17. Citation Index

| Patent number / marker            | First cited in section | Lookup hint                                                              |
|:----------------------------------|:-----------------------|:-------------------------------------------------------------------------|
| `[Patent: NZ 716804]`              | §2.1                   | IPONZ: `app.iponz.govt.nz/app/Extra/Default.aspx`; or Espacenet by NZ number. |
| `[Patent: AU 2014203832]`          | §3.1                   | IP Australia AusPat: `auspat.ipaustralia.gov.au`.                        |
| `[Patent: US 9633511]`             | §3.1                   | USPTO PPUBS: `ppubs.uspto.gov`.                                          |
| `[Patent: US 9165433]`             | §3.1                   | USPTO PPUBS.                                                             |
| `[Patent: US 6997804]`             | §4.1                   | USPTO PPUBS.                                                             |
| `[Patent: US 7014557]`             | §4.1                   | USPTO PPUBS.                                                             |
| `[Patent: unknown — needs lookup]` (Scientific Games stepper) | §5.1 | Search Espacenet for assignee "Scientific Games" + "Reel Power".         |
| `[Patent: unknown — needs lookup]` (WMS adaptive)             | §6.1 | Search Espacenet for assignee "WMS Gaming" + "adaptive".                  |
| `[Patent: unknown — needs lookup]` (NetEnt cluster)           | §7.1 | Search Espacenet for assignee "NetEnt" + "cluster".                       |
| `[Patent: unknown — needs lookup]` (Yggdrasil drop)           | §8.1 | Search Espacenet for assignee "Yggdrasil Gaming" + "cascade".             |
| `[Patent: unknown — needs lookup]` (Relax Gaming jackpot)     | §9.1 | Search Espacenet for assignee "Relax Gaming" + "jackpot".                 |
| `[Patent: unknown — needs lookup]` (Wazdan jackpot)           | §10.1| Search Espacenet for assignee "Wazdan" + "jackpot".                       |
| `[Patent: unknown — needs lookup]` (Stake provably-fair)      | §11.1| Search Espacenet for assignee "Stake" + "provably fair" / "verifiable RNG". |
| `[Patent: unknown — needs lookup]` (Slingo)                   | §12.1| Search USPTO + UKIPO for "Slingo".                                        |

### 17.1 Lookup URL Templates

| Database         | URL template                                                                                |
|:-----------------|:--------------------------------------------------------------------------------------------|
| USPTO PPUBS      | `https://ppubs.uspto.gov/pubwebapp/external.html?db=USPAT&q=PN/<number>`                    |
| Espacenet        | `https://worldwide.espacenet.com/patent/search?q=<number>`                                  |
| Google Patents   | `https://patents.google.com/?q=<number>`                                                    |
| IP Australia     | `https://search.ipaustralia.gov.au/patents/`                                                |
| IPONZ NZ         | `https://app.iponz.govt.nz/app/Extra/Default.aspx?r=1`                                      |
| WIPO PATENTSCOPE | `https://patentscope.wipo.int/search/en/result.jsf?query=<number>`                          |

### 17.2 Agent Refusal Protocol

When an agent (FeatureArchitect, SlotSageV2) is asked to confirm patent coverage, it must:

1. Identify the patent number being claimed.
2. Cross-reference §17 for a citation hint.
3. If marked `[Patent: unknown — needs lookup]`, refuse to confirm coverage and emit:
   `"Patent number not in confirmed corpus. Refusing hallucinated coverage. Consult IP counsel."`
4. If marked `[claim summary unverified]`, emit:
   `"Claim summary not yet verified against source. Treat as research-stage only."`
5. If the patent number is confirmed (e.g., `[Patent: NZ 716804]` for Megaways), the agent may state the public, expired status — but never the per-revenue-share licence terms (those are not in the patent).

### 17.3 Update Cadence

This file should be re-verified annually because:

- Continuations and divisionals can extend coverage by years.
- Annuity non-payment can early-terminate coverage.
- New filings appear continually.
- Trademark status changes per jurisdiction.

Next mandatory review: 2027-06-16 (one year from creation).

---

## Appendix A · Block-Kind Cross-Reference

| Block kind                  | Originating §        | Patent risk envelope                                       | LEGO partners                                              |
|:----------------------------|:---------------------|:-----------------------------------------------------------|:-----------------------------------------------------------|
| `variableWays`              | §2                   | Low (expired NZ 716804).                                   | `cascadeEngine`, `unlimitedMultiplier`, `carriageReel`.    |
| `holdAndRespin`             | §3, §13              | High when combined with reset-on-land + tier reveal.       | `bonusOrbCollect`, `progressiveDropJackpot`.               |
| `multiwayStack`             | §4                   | Low to medium (some IGT US patents expired).               | `wildSubstitution`, `cascadeEngine`.                       |
| `allWaysEvaluator`          | §5                   | Low (generic).                                             | `anchoredWildReel`, `adjacencyMode`.                       |
| `adaptiveFeatureTrigger`    | §6                   | Banned in regulated markets.                               | None (do not implement).                                   |
| `clusterPays`               | §7                   | Medium (vendor families active).                           | `cascadeEngine`, `cascadeMultiplier`.                      |
| `cascadeEngine`             | §7, §8               | Low to medium (column-pack model has more risk).           | `clusterPays`, `cascadeMultiplier`.                        |
| `cascadeMultiplier`         | §8                   | Medium (persistence in feature has more risk).             | `cascadeEngine`, `featureMultiplierPersist`.               |
| `progressiveDropJackpot`    | §9                   | Medium (cross-game pool has more risk).                    | `bonusGame`, `tierReveal`.                                 |
| `bonusOrbCollect`           | §10                  | High (Aristocrat overlap).                                 | `holdAndRespin`, `tierReveal`.                             |
| `frozenReelRespin`          | §10                  | Medium.                                                    | `holdAndRespin`.                                           |
| `provablyFairRng`           | §11                  | Low (generic crypto).                                      | Engine-wide; not feature-specific.                         |
| `bingoSlotFusion`           | §12                  | Medium (trademark restricted; mechanic narrower).          | `freeSpinFeature`, `jokerSubstitution`.                    |
| `lockAndRespinGeneric`      | §13                  | Low (only generic features).                               | `tierReveal` (with care).                                  |

---

## Appendix B · Refusal Templates

For agents to use verbatim when handling patent-adjacent requests.

### B.1 Brand-Name Request

```
Refusing: vendor brand name detected in GDD ("<brand>").
Substitute the vendor-neutral equivalent from §16 (vendor-patents-RE.md).
Action: rejected request; suggested replacement = "<neutral term>".
```

### B.2 Combined Flag Request (Aristocrat Overlap)

```
Refusing: requested flag combination reproduces Aristocrat Lightning Link claim scope
(resetOnLand=true AND tierReveal=true AND orb-collect symbol family).
Action: counsel review required before block emit.
```

### B.3 Player-Profile Outcome Conditioning

```
Refusing: requested feature ties outcome math to player profile metric.
Reason: regulator violation (UKGC, MGA, NJ DGE, AU state regs).
Action: emit cosmetic-only variant; outcome math remains identity-independent.
```

### B.4 Unknown Patent Coverage

```
Refusing: requested coverage claim cites patent not in corpus.
Cited number: "<patent>"; corpus status: [Patent: unknown — needs lookup].
Action: rejected hallucinated coverage; recommend USPTO PPUBS / Espacenet lookup.
```

### B.5 Unverified Claim Summary

```
Caution: claim summary marked [claim summary unverified] in corpus.
Action: treat as research-stage only; do not rely on without counsel verification.
```

---

## Appendix C · Patent vs. Trademark vs. Trade-Dress Distinction

| Form           | Protects                                  | Term                       | Mechanism                                       |
|:---------------|:------------------------------------------|:---------------------------|:------------------------------------------------|
| Patent         | Novel, non-obvious invention.             | 20 years (utility).        | Granted by patent office; examined.             |
| Trademark      | Brand name, logo, distinctive identifier. | Indefinite (renewable).    | Registered with brand office; usage-dependent.  |
| Trade dress    | Distinctive look-and-feel.                | Indefinite (renewable).    | Common-law or registered.                       |
| Copyright      | Original creative expression.             | Life + 70 years.           | Automatic at creation.                          |
| Trade secret   | Confidential commercially valuable info.  | Indefinite (kept secret).  | Contract + reasonable secrecy.                  |

For slot mechanic reverse engineering, **patent expiration releases the invention** but **trademark continues to restrict the brand**. Trade dress can also linger; a "Lightning Link"-themed reskin even with all patented features omitted could still draw a trade-dress complaint.

---

## Appendix D · Honesty Calibration Checklist

Before any agent emits a GDD section citing this file, verify:

| # | Check                                                                                          | Pass? |
|:--|:-----------------------------------------------------------------------------------------------|:------|
| 1 | Every patent number cited matches `[Patent: <jurisdiction> <number>]` format.                  | ☐     |
| 2 | No vendor brand name appears in the GDD body (only neutral equivalents).                       | ☐     |
| 3 | No claim summary marked `[claim summary unverified]` is treated as confirmed.                  | ☐     |
| 4 | No `[Patent: unknown — needs lookup]` marker is treated as a real patent number.               | ☐     |
| 5 | No actual RTP percentage from any patent specification appears.                                | ☐     |
| 6 | No audio-system patent is referenced (per `rule_audio_off_until_asked`).                       | ☐     |
| 7 | Refusal templates from Appendix B used verbatim where applicable.                              | ☐     |
| 8 | All combined-flag requests routed through §15 counsel-review matrix.                           | ☐     |
| 9 | Vendor-neutral mapping (§16) consulted on first mention.                                       | ☐     |
| 10| Citation Index (§17) consulted before asserting coverage.                                      | ☐     |

---

## Appendix E · Jurisdictional Risk Matrix

| Market         | High-risk vendor families to avoid replicating in production               | Notes                                              |
|:---------------|:----------------------------------------------------------------------------|:---------------------------------------------------|
| UK             | Aristocrat (active), NetEnt (active), Yggdrasil (active), Relax (active).  | UKGC strict on player-profile patents.             |
| Malta          | Aristocrat, NetEnt, Yggdrasil, Relax.                                       | MGA aligns with UK on profile.                     |
| New Jersey     | All vendor families; strong enforcement.                                    | DGE-approved RNG required.                         |
| Australia      | Aristocrat (home jurisdiction), Light & Wonder.                             | Hardest market for clones.                         |
| Canada (ON)    | Aristocrat, Light & Wonder, IGT.                                            | AGCO-aligned; vendor IP enforced.                  |
| Sweden         | NetEnt (home), Yggdrasil (home).                                            | Spelinspektionen RNG certification required.       |
| Curacao        | Provably-fair acceptable; vendor patent enforcement low.                    | Highest tolerance for clones.                      |

---

## Appendix F · Anti-Pattern Examples

For agent training. Each row is something the agent must **refuse**.

| # | Anti-pattern                                                                                  | Why refused                                                |
|:--|:----------------------------------------------------------------------------------------------|:-----------------------------------------------------------|
| 1 | `if (gameName === 'lightningLinkClone') applyOrbCollect();`                                   | Game-specific code path; violates LEGO-modularity rule.    |
| 2 | Hardcoded "Megaways" brand string in GDD body.                                                | Trademark violation.                                       |
| 3 | Hardcoded 1.5% revenue-share figure in capsule.                                               | Not in patent; from industry reporting; speculative.       |
| 4 | Patent number "US 99999999" cited without source.                                              | Hallucinated coverage; refused per §17.2.                  |
| 5 | RTP percentage extracted from a patent claim and quoted in GDD.                                | Banned per file header.                                    |
| 6 | Player-profile-driven trigger probability adjustment.                                          | Regulator violation; refused per §6.                       |
| 7 | Combining `resetOnLand` + `tierReveal` + `orbCollect` without counsel notice.                 | Aristocrat overlap; refused per §15.2.                     |
| 8 | Brand "Slingo" used in non-licensed clone GDD.                                                 | Trademark violation.                                       |
| 9 | "Cluster pays" used as mechanic name in PAR sheet.                                             | Vendor term; substitute "connected-component evaluator".   |
| 10| "MegaJackpots" used as jackpot name.                                                           | Trademark; substitute "linked-network tiered progressive". |

---

## Appendix G · Internal Block Inventory Sanity Check

This is the list of block kinds referenced by this corpus. If the `slot-gdd-factory` codebase lacks any of these as `src/blocks/<name>.mjs`, that is **not** an error in itself, but the FeatureArchitect agent should flag the gap when a GDD requests the mechanic.

| Block kind                  | Expected file                            | Catalogued in §           |
|:----------------------------|:-----------------------------------------|:--------------------------|
| `variableWays`              | `src/blocks/variableWays.mjs`            | §2                        |
| `holdAndRespin`             | `src/blocks/holdAndRespin.mjs`           | §3, §13                   |
| `multiwayStack`             | `src/blocks/multiwayStack.mjs`           | §4                        |
| `allWaysEvaluator`          | `src/blocks/allWaysEvaluator.mjs`        | §5                        |
| `adaptiveFeatureTrigger`    | (do not implement)                       | §6                        |
| `clusterPays`               | `src/blocks/clusterPays.mjs`             | §7                        |
| `cascadeEngine`             | `src/blocks/cascadeEngine.mjs`           | §7, §8                    |
| `cascadeMultiplier`         | `src/blocks/cascadeMultiplier.mjs`       | §8                        |
| `progressiveDropJackpot`    | `src/blocks/progressiveDropJackpot.mjs`  | §9                        |
| `bonusOrbCollect`           | `src/blocks/bonusOrbCollect.mjs`         | §3, §10                   |
| `frozenReelRespin`          | `src/blocks/frozenReelRespin.mjs`        | §10                       |
| `provablyFairRng`           | `src/blocks/provablyFairRng.mjs`         | §11                       |
| `bingoSlotFusion`           | `src/blocks/bingoSlotFusion.mjs`         | §12                       |
| `lockAndRespinGeneric`      | `src/blocks/lockAndRespinGeneric.mjs`    | §13                       |
| `carriageReel`              | `src/blocks/carriageReel.mjs`            | §2.8 (skeleton note)      |
| `unlimitedMultiplier`       | `src/blocks/unlimitedMultiplier.mjs`     | §2.8 (skeleton note)      |
| `wildSubstitution`          | `src/blocks/wildSubstitution.mjs`        | §4.2 (dependent claim)    |
| `anchoredWildReel`          | `src/blocks/anchoredWildReel.mjs`        | §5.4                      |
| `adjacencyMode`             | `src/blocks/adjacencyMode.mjs`           | §5.3                      |
| `featureMultiplierPersist`  | `src/blocks/featureMultiplierPersist.mjs`| §8.4                      |
| `tierReveal`                | `src/blocks/tierReveal.mjs`              | §10.3                     |
| `jokerSubstitution`         | `src/blocks/jokerSubstitution.mjs`       | §12.3                     |
| `freeSpinFeature`           | `src/blocks/freeSpinFeature.mjs`         | §12.4                     |

---

## Appendix H · Reading Order for New Agents

For new instances of `FeatureArchitect` or `SlotSageV2`:

1. Read §1 (Methodology) — understand the patent reading model.
2. Read §16 (Vendor-Neutral Glossary) — internalise the neutral vocabulary.
3. Read §15 (Clean-Room Guide) — internalise the safe/unsafe matrix.
4. Read §17 (Citation Index) — understand the refusal protocol.
5. Read Appendix B (Refusal Templates) — memorise the verbatim refusals.
6. Read Appendix D (Honesty Checklist) — gate every GDD emit through this.
7. Spot-read §2–§13 by mechanic when a specific GDD requests that mechanic.

This reading order ensures the agent is calibrated for refusal **before** absorbing the specific mechanic detail, reducing the risk that a salient mechanic narrative overrides the calibration.

---

## Appendix I · Versioning

| Version | Date         | Author          | Notes                                                              |
|:--------|:-------------|:----------------|:-------------------------------------------------------------------|
| 0.1     | 2026-06-16   | Corti (Opus 4.7)| Initial corpus emit. Honesty markers heavy; expect external audit. |

---

## Appendix J · Out-of-Scope (intentionally excluded)

| Topic                                                  | Why excluded                                                              |
|:-------------------------------------------------------|:--------------------------------------------------------------------------|
| Howler.js audio routing patents                        | `rule_audio_off_until_asked` in slot-gdd-factory scope.                   |
| Soundtrack mixing patents                              | Same rule.                                                                |
| Voice-acting and dialogue trigger patents              | Same rule.                                                                |
| RTP exact percentages from any spec                    | File header constraint.                                                   |
| Volatility curves from any patent                      | Same; volatility quoted in patents is illustrative, not normative.        |
| Math win-cap clauses                                   | Same.                                                                     |
| Real-cash HUD patents                                  | Out of scope for mechanic reverse engineering; UI shell concern.          |

---

## Appendix K · Glossary of Patent Terms Used Above

| Term                  | Definition                                                                                          |
|:----------------------|:----------------------------------------------------------------------------------------------------|
| Claim                 | A numbered statement at the end of a patent defining the legal scope of the invention.              |
| Independent claim     | A claim that stands alone; defines the broadest scope.                                              |
| Dependent claim       | A claim that references an earlier claim and adds further limitations; narrows scope.               |
| Limitation            | An individual element of a claim (e.g., "wherein the symbol is variable").                          |
| Comprising            | "Including but not limited to" — open-ended; broadens scope.                                        |
| Consisting of         | "Including only" — closed; narrows scope.                                                           |
| Continuation          | A child patent application sharing the parent's specification but with new claims.                  |
| Divisional            | A child patent application carved out of the parent's claims.                                       |
| PTA / PTE             | Patent Term Adjustment / Extension — extra term granted for office delays or regulatory delay.      |
| RCE                   | Request for Continued Examination — restarts examination after final rejection.                     |
| Annuity               | Recurring maintenance fee paid to keep the patent in force; non-payment voids the grant.            |
| Prior art             | Any public knowledge predating the patent's effective filing date.                                  |
| Inventive step        | The element of a claim that goes beyond prior art; required for grant.                              |
| Office action         | An examiner's communication during prosecution (e.g., rejection, allowance).                        |
| Terminal disclaimer   | A statement that a patent expires no later than an earlier related patent; resolves double-patenting.|
| Family                | Related patents sharing a common priority filing; often span multiple jurisdictions.                |
| Priority date         | The earliest filing date claimed by a patent; used to assess novelty.                               |

---

## Appendix L · Notes for SlotSageV2 (sage agent)

SlotSageV2 should consume this corpus differently from FeatureArchitect. Where the architect emits GDD blocks, the sage advises on **mechanic feasibility** and **patent risk** during early scoping.

| Sage prompt pattern                                                                       | Recommended response approach                                                |
|:------------------------------------------------------------------------------------------|:-----------------------------------------------------------------------------|
| "Is this mechanic patented?"                                                              | Cross-reference §2–§13; cite by `[Patent: …]`; mark unverified honestly.     |
| "Can we build a Megaways clone?"                                                          | Yes for mechanic (post-June 2024); no for brand (trademark).                  |
| "What's the risk of player-profile triggering?"                                           | Refuse production use per §6 and Appendix B.3.                                |
| "Can we have a cross-game pooled jackpot?"                                                 | Conditional; counsel review per §15.8.                                        |
| "We want Slingo mechanics, can we?"                                                        | Mechanic narrow; brand registered. License brand or omit brand.               |
| "How safe is cluster pays?"                                                                | Connected-component algorithm generic; combined patterns vendor-claimed.      |
| "Is provably-fair RNG safe?"                                                               | Generic crypto safe; UI flows can have specific patents.                      |
| "What expires soon?"                                                                       | See §14; update annually.                                                     |
| "What's the safe pattern for hold-and-respin?"                                             | §13 generic skeleton with `resetOnLand=false`, `tierReveal=false`.            |
| "Can we use 'Lightning Link' theme?"                                                       | No — trademark and trade-dress restrict; use vendor-neutral orb-collect.      |

---

## Appendix M · Diff vs. industry-standard documents

This corpus differs from typical industry references as follows:

| Industry typical                                              | This corpus                                                                                 |
|:--------------------------------------------------------------|:--------------------------------------------------------------------------------------------|
| Cites patent abstracts without verification.                  | Marks `[claim summary unverified]` for any unverified summary.                              |
| Quotes RTP/volatility from patent specs.                      | Banned per file header.                                                                     |
| Combines patent + trademark + trade-dress under one umbrella. | Explicitly distinguishes per Appendix C.                                                    |
| Uses vendor brand names freely.                               | Forbids in game-facing artefacts; allows only in research-pool (this file).                 |
| Treats audio patents as in-scope.                             | Carved out per `rule_audio_off_until_asked`.                                                |
| Quotes licence revenue-share figures as fact.                 | Marks "industry-reported, not from patent" — speculative.                                   |

---

## End of corpus

This file is research-pool material. It must not ship in any game-facing artefact. Agents consuming it must apply Appendix D before emitting downstream content.
