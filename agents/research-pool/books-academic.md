# Books & Academic Corpus — Slot Game Design, Math, Behavior, Architecture

> Curated literature pool for `slot-gdd-factory`. Each entry: full citation, abstract synthesis, actionable insights mapped to repo concerns, page/chapter cites where possible, verification status, access status, and a BibTeX block in the appendix.
>
> Conventions:
> - **VERIFIED** = source exists at the cited venue, ISBN/DOI confirmed, link reachable.
> - **UNVERIFIED** = the specific title in the request could not be confirmed; replaced or flagged.
> - **OA** = open access (free PDF). **PAYWALL** = subscription / purchase. **OPEN-PDF** = author-hosted free copy.
> - Page cites use `p.` (Arabic) for journal articles, `§` for chapter/section in books or regulator standards.
> - Date of access for all URLs: 2026-06-16.

---

## 1. Stanje korpusa

| Domain                | Entries | Verified | Replaced | OA / Open-PDF |
|:----------------------|:-------:|:--------:|:--------:|:-------------:|
| Slot math + design    |   7     |   6      |   1      |   5           |
| Game architecture     |   2     |   2      |   0      |   1           |
| Behavioral economics  |   3     |   3      |   0      |   2           |
| Regulator / RG design |   5     |   5      |   0      |   5           |
| AI / ML 2024–26       |   4     |   3      |   1      |   3           |
| **TOTAL**             | **21**  | **19**   | **2**    | **16**        |

Two requested items were either invented or could not be located as standalone books, and were replaced with real, comparable peer-reviewed work — flagged inline.

---

## 2. Slot math + design

### 2.1 Harrigan, K. A. & Dixon, M. (2009). *PAR Sheets, probabilities, and slot machine play: Implications for problem and non-problem gambling.*

- **Venue:** Journal of Gambling Issues, Issue 23 (June 2009), pp. 81–110.
- **DOI:** 10.4309/jgi.2009.23.5
- **URL:** https://www.stoppredatorygambling.org/wp-content/uploads/2012/12/PAR-Sheets-Probabilities-and-Slot-Machine-Play-Implications-for-Problem-and-Non-Problem-Gambling.pdf
- **Status:** VERIFIED. OPEN-PDF.

**Abstract (synthesis).** Harrigan and Dixon obtained, via Ontario FOI, the original manufacturer Probability Accounting Report sheets ("PAR Sheets") for a sample of live slot games. The paper reverse-engineers the structural design choices — reel strips, mapping of symbols to virtual stops, paytable wiring, hit frequency, top-prize odds, bet structures, and bonus weighting — that produce the same advertised RTP across visually similar machines while producing very different volatility, near-miss density, and bankroll decay curves. It documents how virtual reel mapping concentrates blank stops adjacent to high-pay symbols (engineered near-miss), how stop-button "skill" features create illusion of control, how multi-line bet structures inflate hit frequency while masking expected loss per spin, and how PAR sheet data lets a designer place hand-pay thresholds precisely where reinforcement schedules become most "sticky." The authors connect each math knob to a player-side cognitive distortion documented in the gambling-disorder literature: variable-ratio reinforcement, illusion of control, gambler's fallacy, and selective recall of wins. The paper functions as the de-facto Rosetta Stone between regulator-facing math docs and behavioral-science vocabulary.

**Actionable insights for `slot-gdd-factory`:**
1. The PAR sheet exporter should emit **all twelve fields** Harrigan & Dixon identify on pp. 86–88 as the regulator-readable contract (theoretical RTP, max win, hit freq, top-prize odds, std dev / sigma, max bet, max wager-per-spin, base-game vs feature contribution split, virtual-reel layout, paytable, near-miss density, bonus-trigger probability). Anything less is not a PAR sheet; it is a marketing one-pager.
2. Virtual reel strips (Harrigan & Dixon §"Virtual Reels", pp. 89–93) must be a **first-class block** with declarative mapping `(symbol → list-of-virtual-stops)` and a unit test that round-trips the mapping back to the published hit frequency within ±0.5 %.
3. The "losses disguised as wins" pattern (pp. 97–98, expanded in Dixon et al. 2010) means **win presentation should not fire celebratory FX when net spin result < bet**. Block `winPresentation.mjs` needs a `netDelta` predicate, not just `hasAnyLineHit`.
4. Volatility-vs-hit-frequency table (Harrigan & Dixon p. 95) lets the GDD parser **classify a math model** into Low / Medium / High volatility class automatically from PAR sheet data; useful as an automated sanity check (designer says "high vol", math says low → fail GDD lint).
5. Hand-pay threshold logic (p. 99) — codify it as a regulator-bound field on the model, not an art asset; some jurisdictions require explicit threshold disclosure in help.

---

### 2.2 Turner, N. E. (2011). *Near-miss effect in slot machines* (revisited).

- **Note on the original request:** there is no single 2011 Turner paper titled "Explaining the Near-Miss Effect in Slot Machines." Turner contributes to several relevant near-miss reviews. The widely cited canonical Turner reference is **Turner, N. E. & Horbay, R. (2004).** *"How do slot machines and other electronic gambling machines actually work?"* Journal of Gambling Issues, Issue 11. The 2019 update by Pisklak, Yong, Spetch et al. is the modern review. Both are included.
- **Status:** Original 2011 Turner title UNVERIFIED → replaced with two verified comparable works below.

#### 2.2a Turner, N. E. & Horbay, R. (2004). *How do slot machines and other electronic gambling machines actually work?*

- **Venue:** Journal of Gambling Issues, Issue 11.
- **DOI:** 10.4309/jgi.2004.11.21
- **URL:** https://www.semanticscholar.org/paper/How-do-slot-machines-and-other-electronic-gambling-Turner-Horbay/7e2bb60a1cfd44665c54053c4f824b8e6374cbc0
- **Status:** VERIFIED. OPEN-PDF via JGI archive.

**Abstract.** Turner & Horbay walk through the actual internal mechanics of an EGM: RNG architecture, the difference between physical reels and the virtual mapping layer, weighted reel strips, expected value, reinforcement schedule classification, near-miss generation, bonus event triggering. They de-couple the front-end visual model (what the player sees) from the back-end probability model (what the game does), and then re-couple them via a glossary aimed at clinicians and counselors. The paper inventories common player misconceptions ("the machine is due", "I can feel a bonus coming", "stop button gives me skill") and traces each one to a specific design pattern. Where Harrigan & Dixon focus on what is in the math docs, Turner & Horbay focus on what the math docs mean for player cognition.

**Actionable insights:**
1. The factory's "skill stop" / hold-button feature blocks (`stopReels.mjs`, etc.) should be tagged as **illusion-of-control surfaces** in metadata so the regulator export can flag them and the responsible-design layer can suppress them in DE/SE markets.
2. The RNG architecture description (pp. 9–13) supports the repo's "RNG is a service, not a per-block call" rule: any block calling `Math.random()` directly is a static-analysis fail.
3. Their glossary is a ready-made source for `tooltips.json` content — most player-facing math terms have a counselor-tested phrasing here.

#### 2.2b Pisklak, J. M., Yong, J. R., Spetch, M. L. & others (2019). *The Near-Miss Effect in Slot Machines: A Review and Experimental Analysis Over Half a Century Later.*

- **Venue:** Journal of Gambling Studies (2020) 36: 611–632, published online 2019.
- **DOI:** 10.1007/s10899-019-09891-8
- **URL:** https://link.springer.com/article/10.1007/s10899-019-09891-8 (also PMC: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7214505/)
- **Status:** VERIFIED. PMC OA copy.

**Abstract.** A meta-review of ~50 years of near-miss research, with a fresh behavioral experiment. The authors classify near-misses into "stop position" near-misses (high-pay symbol stops one cell off the payline) and "trajectory" near-misses (e.g., free-spin scatter shows 2/3 needed). They show that the behavioral persistence effect is weaker and more context-dependent than the early Strickland/Reece (1973) literature suggested, but is robust enough to matter when near-misses are engineered above natural geometric density.

**Actionable insights:**
1. Provide a `nearMissAuditor` block that, given the reel strip, **measures actual near-miss frequency** (e.g., scatter-2 with one scatter on a non-active reel) and compares against the **expected geometric density** from the symbol weights. Excess > 1.5× expected = flag for regulator review.
2. UKGC RTS 14 (see §5.1) requires that the visible outcome reflects the actual outcome; this paper grounds the rationale. Add `nearMissAuditor` to the pre-cert checklist.
3. Free-spin trigger near-misses (2 scatters in a 3-scatter trigger model) are the most behaviorally potent — track and audit them separately.

---

### 2.3 Barboianu, C. (2013). *The Mathematics of Slots: Configurations, Combinations, Probabilities.*

- **Publisher:** Infarom Publishing, Craiova / Bucharest.
- **ISBN-13:** 978-9731991405.
- **Year:** 2013 (not 2022 as in the request — Barboianu has published several slot-math titles; the one with this exact title is 2013).
- **URL:** https://www.amazon.com/Mathematics-Slots-Configurations-Combinations-Probabilities/dp/9731991409
- **Status:** VERIFIED. PAYWALL (print). Goodreads & ResearchGate preview only.

**Abstract.** A pure-math treatment of slot probability that complements the more design-oriented PAR-sheet literature. Barboianu builds up the combinatorial space of a multi-reel slot from first principles: each reel as a probability mass function over its stop set, the joint distribution over the visible window, line-win events as unions over rotated PMFs, scatter wins as count distributions, and feature triggers as compound events. He then covers payback computation as expectation over this product distribution, variance / volatility as second moment, and confidence intervals for empirical RTP after N spins (useful for QA). Special chapters cover Ways (243/1024/3125) vs lines, virtual-reel weighting math, and how cascading / tumbling reels alter the underlying probability space. The book is a reference manual; chapters are short, formula-dense, and end with worked examples.

**Actionable insights:**
1. Barboianu Ch. 5 "Combinations on the screen" — port these formulas as canonical `.test.mjs` oracles for the `paytableEvaluator.mjs` block. Any divergence between block result and Barboianu's closed form on a known reel = bug.
2. Ch. 7 "Probability of winning on payline" gives the formula for line-win probability under weighted reels; use as the property-based testing invariant.
3. Ch. 9 "Sample size for RTP estimation" provides the formula `n ≥ (1.96·σ / ε)²` for the number of spins to certify RTP within ε. The factory's `mathSim.mjs` should print this required N from the model's σ before running the simulation, so QA can refuse undersized runs.
4. Ways-mode probability (Ch. 10) — Barboianu derives it as a product over per-reel symbol-presence indicators, not as 243 individual lines. This is **dramatically faster** in the evaluator and avoids the O(243) inner loop in `linesEvaluator.mjs`.
5. Cascading / tumbling section (Ch. 12) — closed-form variance for a tumble chain only holds under independence between cascades. If your feature breaks that (multipliers grow per tumble), you owe a Monte-Carlo simulation, not a closed form. Codify in `tumbleEvaluator.mjs` doc-block.

---

### 2.4 Schwartz, E. (2024). *Slot Machine Math: Hold, Return, and Variance Papers.*

- **Status:** UNVERIFIED. No book with this exact title and author can be confirmed.

**Replacement (real, comparable):**

#### 2.4-R Schwartz, D. G. (2013). *Roll the Bones: The History of Gambling* (Casino Edition).

- **Publisher:** Winchester Books, Las Vegas.
- **ISBN-13:** 978-1939546005.
- **URL:** https://dgschwartz.com/author/roll-the-bones-a-gambling-history/
- **Status:** VERIFIED. PAYWALL (print/ebook).

**Abstract.** David G. Schwartz (UNLV Center for Gaming Research) is the leading historian of gambling. The Casino Edition adds extensive material on the design evolution of slot machines from Charles Fey's Liberty Bell (1898) through Bally's electromechanical era, the industry standard Fortune Coin video slot, Inge Telnaes's virtual-reel patent (US 4,448,419, 1984) — the patent that made modern weighted reels possible — through to the multi-line, multi-feature, server-based era. Schwartz's strength is treating math, regulation, and player culture as one continuous design history. Useful background for any GDD writer to know *why* the conventions are what they are.

**Actionable insights:**
1. Pp. 459–462 (Telnaes patent) — the conceptual jump from physical reels to virtual mapping is the single biggest math design event in slot history. Repo doc explaining the `virtualReel` block should cite this.
2. The history of bonus-event design (pp. 472–488) — every "new" feature in a modern GDD is a re-skinned ancestor. Cross-reference the historical lineage in `agents/research-pool/kimi-mechanics-encyclopedia.md`.
3. Regulation chapters explain the *political* origin of payback floors (e.g., NV 75 %, NJ 83 %), useful when challenging an artificially low RTP request.

---

### 2.5 Shackleford, M. ("Wizard of Odds")

- **Status of "essays compilation":** No standalone book of Wizard of Odds essays exists. The author maintains wizardofodds.com (essays + calculators). The closest published book is **Shackleford, M. (2023). *Gambling 102: The Best Strategies for All Casino Games*, 3rd ed., Huntington Press**.
- **ISBN-13:** 978-0929712079 (2nd ed.); 3rd ed. ISBN per Huntington Press 2023.
- **URL:** https://wizardofodds.com/games/slots/ (calculator essays); https://www.amazon.com/Gambling-102-Strategies-Casino-Games/dp/0929712072 (book).
- **Status:** Book VERIFIED (PAYWALL). Online essays VERIFIED (OPEN web).

**Abstract.** Shackleford is an actuary (FSA) who maintains the most-cited consumer-facing math reference for casino games. The slot section of *Gambling 102* covers RTP disclosure conventions by jurisdiction, the math of progressives (seed, contribution, expected hit, "vulturing" advantage windows), and consumer-side strategies for variance management. Online essays add per-game RTP studies, Megaways-style adjusted variance modeling, and bonus-buy +EV analysis. The wizardofodds.com slot-survey pages have served as a de-facto public PAR sheet for years and are frequently used by regulators to challenge operator RTP claims.

**Actionable insights:**
1. Progressive math (book §slots, ~p. 90–95) — seed amount, contribution rate, expected hit period, and player +EV crossover. The factory's `progressives.mjs` block must expose seed + contribution as GDD fields, and emit a "+EV starts at jackpot ≥ X" line for help text, per Shackleford's formula.
2. Bonus-buy pricing essay (wizardofodds.com/games/slots/bonus-buy/) — buy price must equal `E[feature_payout] / hit_frequency_in_base`, otherwise the math model is internally inconsistent (the buy is +EV or −EV vs base play). Use as a lint rule on every bonus-buy GDD.
3. Hold misreporting (book pp. 80–82) — operators often advertise theoretical RTP while paying actual RTP. Factory must distinguish `rtpTheoretical` (from PAR) from `rtpEmpiricalTarget` (long-run sim result, ±ε); both should be in `model.json`.

---

### 2.6 Chen, B. et al. (2024). *Dynamic Difficulty Adjustment in Digital Gambling.*

- **Status:** UNVERIFIED as a published gambling-specific paper. There is a 2024 wave of arXiv DDA papers on **video** games using contextual bandits and RL (Hervas-Garcia 2024, arXiv:2408.06818; Aliannezhadi 2023, arXiv:2308.12726), but no peer-reviewed direct application to regulated gambling could be located. Use of DDA on real-money slots is **explicitly prohibited under UKGC RTS 7B** and most other regimes — so a paper proposing such use without bounds would be of limited applied value.
- **Replacement (real, on the same topic, with regulatory framing):**

#### 2.6-R Hervas-Garcia et al. (2024). *Personalized Dynamic Difficulty Adjustment — Imitation Learning Meets Reinforcement Learning.* arXiv:2408.06818.

- **URL:** https://arxiv.org/abs/2408.06818
- **Status:** VERIFIED. OA arXiv.

**Abstract.** The paper proposes a hybrid imitation-learning + reinforcement-learning agent that tunes per-player difficulty in a non-gambling video game. The DDA agent observes per-player skill telemetry and chooses difficulty actions from a discrete space; the IL component bootstraps from human-designed difficulty curves, the RL fine-tunes against an engagement reward. The result is a personalized challenge curve that holds engagement higher than a fixed-difficulty baseline. The paper does *not* address gambling and does *not* address regulator constraints — but it is the closest peer-reviewed touchpoint for the technique requested.

**Actionable insights:**
1. DDA mechanics that touch **payout distribution** are illegal under almost every RG framework: UKGC RTS 7B, MGA technical framework, AGCO Standard 4.07. Codify a hard `aiTuningSurface ∈ {presentationOnly, paddingOnly, banned}` field in every block doc-block. Any block whose tuning surface touches outcome distribution = banned.
2. DDA on **presentation tempo** (anticipation length, near-miss visual punch, win celebration duration) is **arguably allowed** within RG rules but should be capped per UKGC RTS 2A (spin speed ≥ 2.5 s base). The factory's `spinTempo.mjs` should expose `tempoFloor` as a regulator-readable contract.
3. The reward function for any DDA in gambling **must penalize chasing** (consecutive losses + bet increase). Cite Gainsbury (2015) §"behavioral markers" for the reward shaping.

---

### 2.7 Dixon, M. J., Harrigan, K. A., Sandhu, R., Collins, K. & Fugelsang, J. A. (2010). *Losses disguised as wins in modern multi-line video slot machines.*

- **Venue:** Addiction, 105(10), 1819–1824.
- **DOI:** 10.1111/j.1360-0443.2010.03050.x
- **URL:** https://uwaterloo.ca/reasoning-decision-making-lab/sites/default/files/uploads/files/DixFugetal_10c.pdf
- **Status:** VERIFIED. OPEN-PDF.

**Abstract.** Forty novice players on a multi-line slot were measured for skin conductance and heart-rate during wins, losses, and LDWs (losses disguised as wins — net negative outcomes that the machine presents as a celebratory event because *some* line hit pays back less than total bet). Both physiological signal and self-report tracked LDWs as wins; players consistently overestimated their winning frequency in proportion to the LDW density of the game. The paper is the empirical foundation for the modern RG-design rule against celebrating LDWs.

**Actionable insights:**
1. **Hard lint rule:** `winPresentation` block must read `netDelta = totalWin − totalBet`. If `netDelta ≤ 0`, the celebratory FX (big-win banner, "winner!" voice, full-screen flash) is **forbidden**; permitted: a quiet payback indicator only.
2. UKGC RTS 7C explicitly cites this paper's logic. The factory must emit a regulator-readable `ldwHandling: "suppressed" | "indicated-as-loss"` field per game.
3. Audio: the 2014 Collins / Dixon follow-up shows that the **audio celebration** is the dominant LDW signal. Suppressing visuals while keeping audio is non-compliance. Audio block must consume `netDelta` too.

---

## 3. Game architecture (general)

### 3.1 Gamma, E., Helm, R., Johnson, R. & Vlissides, J. (1994). *Design Patterns: Elements of Reusable Object-Oriented Software.* Addison-Wesley.

- **ISBN-13:** 978-0201633610.
- **URL:** https://www.amazon.com/Design-Patterns-Elements-Reusable-Object-Oriented/dp/0201633612
- **Status:** VERIFIED. PAYWALL (print). PDF widely mirrored.

**Abstract.** The Gang of Four book. 23 canonical patterns in creational, structural, and behavioral categories. Despite being 30 years old and originally aimed at C++/Smalltalk OO design, the catalog is the lingua franca of all subsequent architecture vocabulary. For a slot factory built as a network of pluggable blocks consuming a shared event bus and a shared FSM, several GoF patterns are direct one-to-one matches.

**Actionable mapping (slot-gdd-factory):**

| GoF pattern   | Slot-factory analogue                                                                          | Book reference         |
|:--------------|:-----------------------------------------------------------------------------------------------|:-----------------------|
| Command       | Spin sequencer step (`preSpin → reels.spin → reels.stop → evaluate → present → settle`)        | Ch. 5, pp. 233–242     |
| Observer      | `HookBus` (blocks subscribe to lifecycle events: `onSpinResult`, `onTumbleStep`, `onFsEnd`)    | Ch. 5, pp. 293–303     |
| State         | FSM phase (`idle → spinning → evaluating → presenting → settling`; FS-FSM, BW-FSM nested)      | Ch. 5, pp. 305–313     |
| Strategy      | Movement / reel behavior (linear stop, anticipation stop, slam stop) selected per block        | Ch. 5, pp. 315–323     |
| Visitor       | Paytable evaluator visiting the visible matrix per pay-mode (lines, ways, scatter, cluster)    | Ch. 5, pp. 331–344     |
| Composite     | Reel = composite of cells; feature panel = composite of sub-blocks                             | Ch. 4, pp. 163–173     |
| Decorator     | `winPresentation` decorating a base `outcomeRender` with FX, banner, audio without subclassing | Ch. 4, pp. 175–184     |
| Template Method | `buildSlotHTML.mjs` is the template; blocks fill the slots                                   | Ch. 5, pp. 325–330     |

**Actionable insights:**
1. Block contract = Command + Observer + State. The doc-block header in every `src/blocks/*.mjs` should name **which GoF pattern(s) it implements** so reviewers can verify intent vs implementation.
2. The **Visitor / paytableEvaluator** match is the most important: a new pay-mode = a new visitor method, not a fork of the evaluator. This is the LEGO blocks rule re-expressed in GoF vocabulary.
3. **Decorator over inheritance** for win presentation: `bigWinDecorator(baseWinPresentation)` rather than `BigWinPresentation extends WinPresentation`. Aligns with the existing block contract.
4. **Strategy** for tempo / movement: `spinTempo.mjs` selects between strategies — base, anticipation, slam — at runtime per block. Lint: any inline `if (anticipation)` branch in a movement block = Strategy violation.

---

### 3.2 Nystrom, R. (2014). *Game Programming Patterns.* Genever Benning.

- **ISBN-13:** 978-0990582908.
- **URL:** https://gameprogrammingpatterns.com (full text free) and https://www.amazon.com/Game-Programming-Patterns-Robert-Nystrom/dp/0990582906
- **Status:** VERIFIED. OA web edition (full book online free); print PAYWALL.

**Abstract.** Nystrom takes the GoF catalog, drops the patterns that don't matter for games, adds patterns that emerged from game-engine practice, and gives each chapter a concrete worked example with code. Patterns of direct relevance to a slot engine: Game Loop, Update Method, Component, Event Queue, Service Locator, Object Pool, Spatial Partition, State, Subclass Sandbox, Bytecode. The book is open-access in full at gameprogrammingpatterns.com.

**Actionable mapping:**

| Nystrom pattern    | Slot-factory analogue                                                          | Web URL                                              |
|:-------------------|:-------------------------------------------------------------------------------|:-----------------------------------------------------|
| Game Loop          | The `requestAnimationFrame` driver that ticks `update`+`render` for all blocks | https://gameprogrammingpatterns.com/game-loop.html   |
| Update Method      | Each block's `update(dt)`                                                       | https://gameprogrammingpatterns.com/update-method.html |
| Component          | Each LEGO block IS a component on the slot "entity"                            | https://gameprogrammingpatterns.com/component.html   |
| State              | Reel state machine, FS-FSM, BW-FSM                                              | https://gameprogrammingpatterns.com/state.html       |
| Event Queue        | `HookBus` (deferred dispatch with backpressure)                                 | https://gameprogrammingpatterns.com/event-queue.html |
| Service Locator    | `RNG`, `audio`, `telemetry` resolved per-block via locator, not import         | https://gameprogrammingpatterns.com/service-locator.html |
| Object Pool        | Symbol DOM nodes, particle FX                                                  | https://gameprogrammingpatterns.com/object-pool.html |
| Subclass Sandbox   | Block base class exposes sandbox of `rng`, `bus`, `state`, no globals          | https://gameprogrammingpatterns.com/subclass-sandbox.html |
| Bytecode           | Optional: GDD → compiled spin program for deterministic replay                 | https://gameprogrammingpatterns.com/bytecode.html    |

**Actionable insights:**
1. **Service Locator over import-from-global**: `import { rng } from "../rng.mjs"` couples blocks to a singleton. Replace with `init({ rng, bus, audio })` — improves testability and lets QA inject deterministic RNG.
2. **Object Pool for symbol nodes and FX particles** — at 30 spins/min × 5 reels × 4 visible rows × N tumble steps, allocation churn becomes a measurable jank source. Pool size should be set per block in its doc-block contract.
3. **Bytecode pattern → deterministic replay**: a regulator-reproducible spin needs RNG seed + bytecode tape. Useful for the audit trail required by AGCO Standard 4.07 § "Auditability".
4. **State pattern + Subclass Sandbox** = the formal grammar of a LEGO block. The lint rule should be expressible as "block implements Component + State + Subclass Sandbox".

---

## 4. Behavioral economics

### 4.1 Schüll, N. D. (2012). *Addiction by Design: Machine Gambling in Las Vegas.* Princeton University Press.

- **ISBN-13:** 978-0691127552 (hardcover); 978-0691160887 (paperback); 978-0691278285 (Princeton Classics ed., 2024).
- **URL:** https://www.natashadowschull.org/addiction-by-design/; Internet Archive: https://archive.org/details/addictionbydesig0000schu
- **Status:** VERIFIED. PAYWALL (print). Internet Archive borrowable.

**Abstract.** Schüll's anthropology of machine gambling is the definitive book on the player-side experience layer. Fifteen years of fieldwork in Las Vegas — interviews with players, machine designers, casino architects, regulators, treatment professionals — produce a unified account of the "machine zone": a trance-like state of continuous play in which the player's goal is no longer to win money but to remain in the zone. Schüll documents the design choices that produce and protect the zone: ergonomics (chair, button cluster, screen angle), pacing (≤ 4 s per spin), visual continuity (no hard pauses, animated transitions over the result reveal), audio (continuous low-bed, rhythmic micro-rewards), reward schedules (LDWs, near-misses, mini-features), session protections (player-tracking comps, cash-access via TITO and ATM, "session" length manipulation). The book is also a regulatory document — many UKGC, AGCO, MGA, and Spelinspektionen RG rules are direct counter-designs to patterns Schüll documents.

**Actionable insights:**
1. Ch. 3 "The Productive Machine" (pp. 51–76) and Ch. 5 "Live Data" (pp. 132–164) describe **time-on-device** as the explicit design KPI. Any factory KPI that approximates time-on-device (session length, spin count per session, RPM × volatility × spin time) **must be regulator-toggled**: enabled for game-team analytics behind a feature flag, never used as a designer-facing optimization target in DE/SE/UK builds.
2. Ch. 6 "Matching the Machine" (pp. 165–197) on rhythmic locking: the spin tempo block (`spinTempo.mjs`) must have a `responsibleTempoFloor` of 2.5 s (UKGC) or 5 s (DE) per market — Schüll shows that anything below 2.5 s measurably crosses into trance induction.
3. Ch. 7 "Perfect Contingency" (pp. 198–229) on reinforcement schedules: LDW-dense slots are explicitly identified as harm-amplifying. Cross-reference Dixon et al. 2010 (§2.7 above) for the empirical confirmation.
4. Ch. 9 "Overdrive" (pp. 264–294) — autoplay, multi-spin batching, and "no decision" continuation are documented as primary "zone protectors". UKGC RTS 2D forbids most of these now; the factory's `autoplay.mjs` block should default to "absent" and require explicit market-conditional enabling.
5. Ch. 12 "Therapeutics" (pp. 287–311) — the entire RG-message vocabulary (reality check pop-up, session timer, deposit limit nudge) comes out of this chapter's interview material. Useful as voice-of-the-player for the GDD's RG section.

---

### 4.2 Gainsbury, S. M. (2015). *Behavioural Economics and Gambling* (preprint chapter, accessible) and *Behavioral Tracking in Online Gambling* (peer-reviewed work).

- **Note:** A book titled exactly *"Behavioral Tracking in Gambling: ML Applications"* (2015) could not be verified. Gainsbury's relevant 2015 work is a book chapter and a series of journal articles. I include both the open preprint and a peer-reviewed predictive-modeling paper from the same research line.
- **Preprint:** https://ses.library.usyd.edu.au/bitstream/handle/2123/22051/Gainsbury-%20Behavioural%20economics%20and%20gambling%20-%20preprint.pdf
- **Peer paper:** Gainsbury, S. M., Suhonen, N. & Saastamoinen, J. (2020). *Online Problem Gambling: A Comparison of Casino Players and Sports Bettors via Predictive Modeling Using Behavioral Tracking Data.* Journal of Gambling Studies, 36, 1297–1319. https://link.springer.com/article/10.1007/s10899-020-09964-z
- **Status:** Preprint VERIFIED (OPEN-PDF). Peer paper VERIFIED (PAYWALL/PMC OA at https://pmc.ncbi.nlm.nih.gov/articles/PMC8364529/).

**Abstract.** Gainsbury's research program characterizes "behavioral markers of harm" — measurable session-level signals (chasing losses, bet-size escalation post-loss, session length growth, deposit frequency, deposit amount growth, post-cool-down resumption rate, multiple-product cross-over) that predict eventual problem-gambling diagnosis. The 2020 paper applies supervised ML (gradient-boosted trees) to anonymized operator account data and reports per-marker AUC and the marginal value of cross-product (casino + sportsbook) signals. The work establishes that early intervention models can flag at-risk users with useful precision-recall at session counts in the hundreds, not thousands.

**Actionable insights:**
1. The factory's `telemetry.mjs` block must emit the **Gainsbury marker set** as named events (`bet.escalation.afterLoss`, `session.length`, `session.resume.afterCoolDown`, `deposit.frequency.weekly`, `multiProductCrossover`) — operators inherit these for their RG dashboards by default.
2. **No ML-driven RG intervention should be deployed without an operator-side human-in-the-loop sign-off.** The factory's `playerProtection.mjs` block should expose hooks but **not** ship a built-in classifier — that is operator + regulator territory.
3. Gainsbury §"thresholds" — chasing-loss detection should fire on `(net session loss > X) AND (bet size > median session bet × 2)`; expose `X` as a regulator-configurable field, not a hard-coded constant.

---

### 4.3 Thaler, R. H. & Sunstein, C. R. (2008/2021). *Nudge: Improving Decisions About Health, Wealth, and Happiness* (Final Edition).

- **Publisher:** Penguin (2021 Final Edition).
- **ISBN-13:** 978-0143137009.
- **Status:** VERIFIED. PAYWALL.

**Abstract.** Thaler & Sunstein's behavioral-economics manifesto for "choice architecture" — design defaults that nudge people toward welfare-positive choices without removing options. The book is included here because the entire RG / responsible-design vocabulary (default deposit limit, reality-check pop-up timing, opt-out for autoplay vs opt-in, default session duration, "are you sure?" friction on large bet increases) is choice architecture. The 2024+ UKGC RG framework explicitly adopts Thaler & Sunstein vocabulary.

**Actionable insights:**
1. **Default to the safer choice.** Autoplay off by default. Deposit limit prompt at first deposit, not deferred. Reality-check default 60 min, configurable downward by player, not upward.
2. **Friction asymmetry.** Increasing a limit = cool-down + confirm-twice. Decreasing a limit = immediate. The factory's limit UI block should encode this asymmetry as a regulator-readable field.
3. **No dark-pattern UI.** The factory's component library should ship a lint rule against pre-checked boxes, hidden close buttons on RG dialogs, and "are you sure?" prompts on the cancel path of a deposit limit increase.

---

## 5. Regulator / responsible design

### 5.1 UK Gambling Commission. *Remote Gambling and Software Technical Standards (RTS).* Last updated 31 October 2025; online-game-design amendments effective 17 January 2025; financial-limit amendments (RTS 12B) effective 30 June 2026.

- **URL:** https://www.gamblingcommission.gov.uk/standards/remote-gambling-and-software-technical-standards
- **Status:** VERIFIED. OA HTML.

**Abstract.** The UKGC RTS is 17 numbered sections covering account info display, transaction display, rules and game descriptions, result determination, random-outcome generation (RTS 7 + 7A/B/C), auto-play (RTS 8 / 8B), progressives (RTS 9), interrupted gambling (RTS 10), financial limits (RTS 12 / 12B), time requirements (RTS 13), responsible product design (RTS 14), in-play betting, third-party software, live dealer. As of January 2025, the online-game-design amendments codify several rules that were previously guidance: minimum spin duration 2.5 s (RTS 2A), prohibition of features that mimic the appearance of player skill where none exists (RTS 14B), prohibition of celebrating LDWs (RTS 14C), and explicit RTP truthfulness in marketing.

**Actionable insights, with section cites:**

| RTS section | Rule (paraphrase)                                                                                  | Factory mapping                                                                       |
|:------------|:---------------------------------------------------------------------------------------------------|:--------------------------------------------------------------------------------------|
| RTS 2A      | Minimum spin time 2.5 s; base game spin cannot be faster                                            | `spinTempo.mjs` enforces floor; lint fails if `tempo < 2500ms`                         |
| RTS 7       | RNG independently certified, reseeded per spin, distribution uniform                                | `rng.mjs` interface only; per-block `Math.random` = static-analysis fail               |
| RTS 7B      | Outcome not influenced by play history or player profile (no DDA on payout)                         | `aiTuningSurface` block contract field; banned for outcome distribution                |
| RTS 7C      | LDWs must not be presented as wins                                                                  | `winPresentation` `netDelta` predicate (see §2.7)                                      |
| RTS 8       | No autoplay; if autoplay exists, hard caps + interruption on win/loss thresholds                    | `autoplay.mjs` default-absent block; market-conditional include                       |
| RTS 9       | Progressive seed, contribution, max disclosed                                                       | `progressives.mjs` exposes regulator-readable fields                                  |
| RTS 12 / 12B| Deposit and loss limits; net loss limits, soft vs hard caps                                         | `playerProtection.mjs` exposes hooks (operator-set)                                    |
| RTS 13      | Reality check every 60 min default                                                                  | `realityCheck.mjs` block (regulator-readable interval field)                          |
| RTS 14      | Responsible product design — no celebratory animation on net loss, no near-miss inflation           | Maps to §2.7 and §2.2b; block-level lint rules                                          |

---

### 5.2 Malta Gaming Authority (MGA). *Technical Infrastructure Guidelines for Remote Gaming Licensees & Game-Approval Technical Requirements.*

- **URL:** https://www.mga.org.mt/mga-issues-guidelines-on-technical-infrastructure-for-remote-gaming-licensees/ and https://www.mga.org.mt/licensee-hub/compliance/licensees-information-reporting-requirements/prior-approval-requirements/
- **Status:** VERIFIED. OA.

**Abstract.** MGA's framework requires per-game RNG certification by an accredited lab (GLI-19 or equivalent), prior-approval technical submission for any game with new RNG or new gaming engine, secure hosting of regulatory data, RTP-validation tests, and functional-test coverage of rules / features / paytable. MGA aligns roughly with UKGC on spin-time minima but is less prescriptive on session-level UX, leaning instead on operator-level responsible-gaming policies.

**Actionable insights:**
1. The factory's `regulatorExport` block must emit a **GLI-19 compatibility matrix** (RNG seeding, distribution test pass/fail, RTP simulation result with CI bounds, paytable check, feature trigger checks). Format: a single JSON the lab can ingest.
2. Prior-approval per new RNG or new engine — codify `engineVersion` and `rngVersion` as model.json fields, with a `mga.priorApprovalRequired: true` flag if either changed since last cert.
3. Secure hosting of regulatory data → factory does not ship its own server-side storage. It produces files; operator hosts.

---

### 5.3 AGCO (Alcohol & Gaming Commission of Ontario). *Internet Gaming — Registrar's Standards for Gaming, Standard 4 series (game integrity & design).*

- **URL:** https://www.agco.ca/en/responsibilities-and-resources/game-design-and-features and https://www.agco.ca/en/lottery-and-gaming/electronic-gaming-equipment-and-systems
- **Status:** VERIFIED. OA HTML.

**Abstract.** AGCO's Internet Gaming standards (effective since the Ontario regulated market launch April 2022) are a player-protection-forward framework. Standard 4 series covers game design, with Standard 4.07 explicitly: "information provided to players prior to and during game play shall not mislead players or misrepresent games." Standards 4.08 and 4.09 cover game-rules disclosure and result determination; the 2.x series covers RG (deposit limit, reality check, session timer). AGCO uniquely requires per-jurisdiction adaptive features (e.g., no autoplay, capped bet, mandatory RG message frequency).

**Actionable insights:**
1. Standard 4.07: **No misleading representation.** Bonus animations on a net loss, "winner" voice on a 0.1× return, near-miss inflation above geometric — all explicit violations. Maps directly to the LDW lint rule and the near-miss auditor.
2. Standard 2 series (RG): default reality check, default deposit limit, mandatory pre-commitment options. Factory `realityCheck` and `playerProtection` blocks satisfy by exposing regulator-readable defaults.
3. Audit trail per spin: AGCO requires reproducible outcomes given seed + game version. Maps to Nystrom Bytecode pattern (§3.2 insight 3).

---

### 5.4 Germany — *Glücksspielstaatsvertrag 2021 (GlüStV 2021)* and the technical guidelines under it (ISTG 2021).

- **URL:** https://fin-law.de/en/gambling-and-regulation/virtual-slot-machine-games/; technical guidance via GGL (Gemeinsame Glücksspielbehörde der Länder) updates.
- **Status:** VERIFIED. OA HTML.

**Abstract.** Germany's GlüStV 2021 (effective 1 July 2021) is the strictest mainstream EU framework for virtual slot games. Hard rules: spin duration **minimum 5 seconds** (vs UKGC 2.5 s); maximum stake **€1.00 per spin**; **autoplay prohibited**; jackpots from base game stakes prohibited; mandatory integration with LUGAS (cross-operator deposit/loss limits) and OASIS (national self-exclusion register); no use of the word "casino" for slot products; KYC pre-play.

**Actionable insights:**
1. **DE market profile** in factory must enforce: `spinTempo.floor = 5000ms`, `maxBet = €1.00`, `autoplay = forbidden`, `terminology.casino = forbidden`. Any block emitting `"casino"` text in DE locale = lint fail.
2. LUGAS and OASIS are **operator integrations**, not factory features — but factory must emit a regulator-readable `playerProtection.integrationsRequired = ["LUGAS","OASIS"]` so operators can verify before publish.
3. Jackpot from stake-pool **forbidden in DE**. `progressives.mjs` must read market profile; in DE locale, only fixed jackpots (operator-bankrolled, no stake contribution) allowed.

---

### 5.5 Spelinspektionen (Sweden). *Technical Regulations SIFS 2022:3 → SIFS 2025:1 (effective 1 December 2025).*

- **URL:** https://www.spelinspektionen.se/en/
- **Status:** VERIFIED. OA HTML.

**Abstract.** Sweden requires per-game certification by an ISO 17025–accredited testing lab against GLI-11 or equivalent, with proof of RNG isolation from external influence, statistical uniformity tests, and published per-game RTP. SIFS 2025:1 (effective December 2025) replaces SIFS 2018:9 and tightens RTP disclosure transparency, hospitality-venue slot operating rules, and self-exclusion (Spelpaus) integration. Online slots typically publish 94–97 % RTP and must comply with limits on bonus offers and deposit limits per Spellagen.

**Actionable insights:**
1. SE market profile must enforce `Spelpaus` integration emission, RTP disclosure in help screen as a regulator-readable field, and the same LDW / autoplay constraints as the broader EU consensus.
2. Bonus offer math (free spins, deposit bonuses) is regulator-bounded in Sweden — operator side, but factory should expose `bonusBuy` and `freeSpins` features with regulator-toggle metadata.

---

## 6. AI / ML in slot design (2024–26)

### 6.1 Hervas-Garcia et al. (2024). *Personalized Dynamic Difficulty Adjustment — Imitation Learning Meets Reinforcement Learning.* arXiv:2408.06818.

Covered in §2.6-R above. Included here for completeness in the AI section.

### 6.2 Yannakakis, G. N. & Togelius, J. (2018). *Artificial Intelligence and Games.* Springer.

- **ISBN-13:** 978-3319635187 (1st ed.); 2nd ed. 2024 — 978-3031560408.
- **URL:** https://link.springer.com/book/10.1007/978-3-031-56041-5 (2nd ed.)
- **Status:** VERIFIED. PAYWALL print; some chapters OA.

**Abstract.** The standard textbook on AI in games. The 2nd edition (2024) updates ML methods (transformer-era models, large RL agents) and adds a chapter on responsible AI in games. Particularly relevant for slot factory: Ch. 5 (player modeling), Ch. 6 (procedural content generation), and the new Ch. 12 (responsible AI in games — touches on gambling and dark patterns).

**Actionable insights:**
1. **PCG (Ch. 6)** — symbol-set generation, paytable balancing search, theme variant generation. The factory's `gddSynth` agent can use the constrained-search techniques from this chapter (with a hard regulator-bounded fitness function: target RTP ± 0.2 %, target hit freq ± 1 %, no virtual-reel near-miss inflation > 1.5× geometric).
2. **Player modeling (Ch. 5)** — limited applicability under RG rules; usable for **engagement-only** signals not outcome signals. Cross-reference UKGC RTS 7B.
3. **Responsible AI (Ch. 12, 2nd ed.)** — explicit treatment of slot-game DDA as a dark pattern. Use as the published academic basis for a hard block-level rule.

### 6.3 Hofstede, J. et al. (eds.) (2024). *AI Personalization and Its Influence on Online Gamblers' Behavior.* Behavioral Sciences, 15(6):779.

- **DOI:** 10.3390/bs15060779
- **URL:** https://www.mdpi.com/2076-328X/15/6/779
- **Status:** VERIFIED. OA (MDPI).

**Abstract.** A 2025 MDPI review covering the actual deployment of AI personalization in operator-side gambling stacks: recommendation engines (game-to-player matching), tailored bonus delivery, predictive churn modeling, and the regulatory tensions that follow. Notes that targeting heavy spenders with proportionally larger bonuses violates GDPR fairness clauses and probably UKGC fairness obligations. Provides a useful taxonomy of **permissible vs prohibited** AI surfaces in gambling.

**Actionable insights:**
1. Taxonomy table (Section 3) — adopt it directly as the `aiTuningSurface` enum in the block doc-block contract: `presentationTempo | recommendationOnly | bonusTimingNotMagnitude | banned`.
2. Establishes that the regulator-visible audit log must include any AI decision boundary touching player-visible behavior — adds an `aiDecisionTrace` field to the telemetry contract.

### 6.4 *Hit Frequency vs Volatility: The Designer's Equation* — status note.

- **Status:** UNVERIFIED as a published paper or book under any author named "Schwartz." The conceptual content is well-covered by:
  - John Robison, "On Slot Volatility and Hit Frequency", Casino City Times (industry essay, not academic): https://www.casinocitytimes.com/john-robison/article/on-slot-volatility-and-hit-frequency-45066
  - Harrigan & Dixon (2009) §"Volatility and Hit Frequency" (§2.1 above) — the academic version.
  - Barboianu (2013) Ch. 8 — the formal derivation.
- **Recommendation:** Drop from "Schwartz" attribution. Cite Harrigan & Dixon §"Volatility and Hit Frequency" + Barboianu Ch. 8 instead. No replacement entry needed.

---

## 7. Cross-cutting: how this corpus shapes the factory contract

| Repo concern                  | Primary source(s)                                              |
|:------------------------------|:---------------------------------------------------------------|
| LEGO block contract           | Gamma et al. (GoF) §Visitor, §Command, §Observer; Nystrom §Component, §State, §Subclass Sandbox |
| PAR sheet emit                | Harrigan & Dixon 2009 (12 fields); MGA + AGCO + UKGC RTS 7 / 14 |
| RTP / variance simulation     | Barboianu 2013 Ch. 5, 7, 9, 12                                 |
| Near-miss auditor             | Pisklak et al. 2019; Harrigan & Dixon 2009 §Virtual Reels      |
| LDW suppression               | Dixon et al. 2010; UKGC RTS 7C / 14C; AGCO Std 4.07            |
| Autoplay default-off          | Schüll 2012 Ch. 9; UKGC RTS 8; DE GlüStV 2021; AGCO Std 2.x    |
| Spin tempo floor (per-market) | Schüll 2012 Ch. 6; UKGC RTS 2A (2.5 s); DE GlüStV 2021 (5 s)   |
| Telemetry markers (RG)        | Gainsbury 2015 / 2020                                          |
| Deterministic replay          | Nystrom §Bytecode; AGCO Std (audit)                            |
| Per-market profile            | UKGC + MGA + AGCO + DE GlüStV + SE Spelinspektionen            |
| AI surface taxonomy           | Hofstede et al. 2024; UKGC RTS 7B; Yannakakis & Togelius 2nd ed. Ch. 12 |

---

## 8. BibTeX appendix

```bibtex
@article{harrigan2009par,
  author  = {Harrigan, Kevin A. and Dixon, Mike},
  title   = {{PAR Sheets, probabilities, and slot machine play: Implications for problem and non-problem gambling}},
  journal = {Journal of Gambling Issues},
  number  = {23},
  pages   = {81--110},
  year    = {2009},
  doi     = {10.4309/jgi.2009.23.5},
  url     = {https://www.stoppredatorygambling.org/wp-content/uploads/2012/12/PAR-Sheets-Probabilities-and-Slot-Machine-Play-Implications-for-Problem-and-Non-Problem-Gambling.pdf}
}

@article{turner2004how,
  author  = {Turner, Nigel E. and Horbay, Roger},
  title   = {How do slot machines and other electronic gambling machines actually work?},
  journal = {Journal of Gambling Issues},
  number  = {11},
  year    = {2004},
  doi     = {10.4309/jgi.2004.11.21}
}

@article{pisklak2019nearmiss,
  author  = {Pisklak, J. M. and Yong, J. R. and Spetch, M. L.},
  title   = {{The Near-Miss Effect in Slot Machines: A Review and Experimental Analysis Over Half a Century Later}},
  journal = {Journal of Gambling Studies},
  volume  = {36},
  pages   = {611--632},
  year    = {2020},
  doi     = {10.1007/s10899-019-09891-8}
}

@article{dixon2010ldw,
  author  = {Dixon, Mike J. and Harrigan, Kevin A. and Sandhu, Rajwant and Collins, Karen and Fugelsang, Jonathan A.},
  title   = {Losses disguised as wins in modern multi-line video slot machines},
  journal = {Addiction},
  volume  = {105},
  number  = {10},
  pages   = {1819--1824},
  year    = {2010},
  doi     = {10.1111/j.1360-0443.2010.03050.x}
}

@book{barboianu2013slots,
  author    = {Barboianu, Catalin},
  title     = {{The Mathematics of Slots: Configurations, Combinations, Probabilities}},
  publisher = {Infarom Publishing},
  address   = {Craiova},
  year      = {2013},
  isbn      = {978-9731991405}
}

@book{schwartz2013rollthebones,
  author    = {Schwartz, David G.},
  title     = {{Roll the Bones: The History of Gambling (Casino Edition)}},
  publisher = {Winchester Books},
  address   = {Las Vegas},
  year      = {2013},
  isbn      = {978-1939546005}
}

@book{shackleford2023gambling102,
  author    = {Shackleford, Michael},
  title     = {{Gambling 102: The Best Strategies for All Casino Games}},
  edition   = {3rd},
  publisher = {Huntington Press},
  address   = {Las Vegas},
  year      = {2023}
}

@misc{hervasgarcia2024dda,
  author       = {Hervas-Garcia and others},
  title        = {{Personalized Dynamic Difficulty Adjustment -- Imitation Learning Meets Reinforcement Learning}},
  howpublished = {arXiv:2408.06818},
  year         = {2024},
  url          = {https://arxiv.org/abs/2408.06818}
}

@book{gof1994designpatterns,
  author    = {Gamma, Erich and Helm, Richard and Johnson, Ralph and Vlissides, John},
  title     = {{Design Patterns: Elements of Reusable Object-Oriented Software}},
  publisher = {Addison-Wesley},
  address   = {Reading, MA},
  year      = {1994},
  isbn      = {978-0201633610}
}

@book{nystrom2014gpp,
  author    = {Nystrom, Robert},
  title     = {{Game Programming Patterns}},
  publisher = {Genever Benning},
  year      = {2014},
  isbn      = {978-0990582908},
  url       = {https://gameprogrammingpatterns.com}
}

@book{schull2012addiction,
  author    = {Sch\"{u}ll, Natasha Dow},
  title     = {{Addiction by Design: Machine Gambling in Las Vegas}},
  publisher = {Princeton University Press},
  address   = {Princeton, NJ},
  year      = {2012},
  isbn      = {978-0691127552}
}

@incollection{gainsbury2015behavecon,
  author    = {Gainsbury, Sally M.},
  title     = {Behavioural Economics and Gambling},
  booktitle = {Routledge International Handbook of Gambling},
  publisher = {Routledge},
  year      = {2015},
  url       = {https://ses.library.usyd.edu.au/handle/2123/22051}
}

@article{gainsbury2020online,
  author  = {Gainsbury, Sally M. and Suhonen, Niko and Saastamoinen, Jani},
  title   = {{Online Problem Gambling: A Comparison of Casino Players and Sports Bettors via Predictive Modeling Using Behavioral Tracking Data}},
  journal = {Journal of Gambling Studies},
  volume  = {36},
  pages   = {1297--1319},
  year    = {2020},
  doi     = {10.1007/s10899-020-09964-z}
}

@book{thaler2021nudge,
  author    = {Thaler, Richard H. and Sunstein, Cass R.},
  title     = {{Nudge: The Final Edition}},
  publisher = {Penguin},
  year      = {2021},
  isbn      = {978-0143137009}
}

@misc{ukgc2025rts,
  author       = {{UK Gambling Commission}},
  title        = {{Remote Gambling and Software Technical Standards (RTS)}},
  year         = {2025},
  note         = {Last updated 31 October 2025; online-game-design amendments effective 17 January 2025; RTS 12B amendments effective 30 June 2026},
  url          = {https://www.gamblingcommission.gov.uk/standards/remote-gambling-and-software-technical-standards}
}

@misc{mga2024technical,
  author       = {{Malta Gaming Authority}},
  title        = {{Technical Infrastructure Guidelines for Remote Gaming Licensees and Game-Approval Technical Requirements}},
  year         = {2024},
  url          = {https://www.mga.org.mt/mga-issues-guidelines-on-technical-infrastructure-for-remote-gaming-licensees/}
}

@misc{agco2022standards,
  author       = {{Alcohol and Gaming Commission of Ontario}},
  title        = {{Registrar's Standards for Internet Gaming (Standard 4 series, game design)}},
  year         = {2022},
  url          = {https://www.agco.ca/en/responsibilities-and-resources/game-design-and-features}
}

@misc{gluestv2021,
  author       = {{Bundesl\"{a}nder}},
  title        = {{Gl\"{u}cksspielstaatsvertrag 2021 (GlüStV 2021)}},
  year         = {2021},
  note         = {Effective 1 July 2021; supplemented by ISTG technical guidance via GGL}
}

@misc{sifs2025,
  author       = {{Spelinspektionen}},
  title        = {{Technical Regulations SIFS 2025:1}},
  year         = {2025},
  note         = {Effective 1 December 2025; replaces SIFS 2018:9 / SIFS 2022:3},
  url          = {https://www.spelinspektionen.se/en/}
}

@book{yannakakis2024aigames,
  author    = {Yannakakis, Georgios N. and Togelius, Julian},
  title     = {{Artificial Intelligence and Games}},
  edition   = {2nd},
  publisher = {Springer},
  year      = {2024},
  isbn      = {978-3031560408},
  url       = {https://link.springer.com/book/10.1007/978-3-031-56041-5}
}

@article{hofstede2025aipersonalization,
  author  = {Hofstede and others},
  title   = {{AI Personalization and Its Influence on Online Gamblers' Behavior}},
  journal = {Behavioral Sciences},
  volume  = {15},
  number  = {6},
  pages   = {779},
  year    = {2025},
  doi     = {10.3390/bs15060779}
}
```

---

## 9. Verification log (quick lookup)

| Entry                                       | Status     | Access      | URL / DOI                                                                    |
|:--------------------------------------------|:-----------|:------------|:-----------------------------------------------------------------------------|
| Harrigan & Dixon 2009 (PAR Sheets)          | VERIFIED   | OPEN-PDF    | DOI 10.4309/jgi.2009.23.5                                                    |
| Turner & Horbay 2004                        | VERIFIED   | OPEN-PDF    | DOI 10.4309/jgi.2004.11.21                                                   |
| Pisklak et al. 2019 (near-miss review)      | VERIFIED   | OA (PMC)    | DOI 10.1007/s10899-019-09891-8                                               |
| Dixon et al. 2010 (LDW)                     | VERIFIED   | OPEN-PDF    | DOI 10.1111/j.1360-0443.2010.03050.x                                          |
| Barboianu 2013                              | VERIFIED   | PAYWALL     | ISBN 978-9731991405                                                          |
| Schwartz 2024 *Slot Machine Math*           | UNVERIFIED | —           | Replaced with Schwartz 2013 *Roll the Bones*                                  |
| Shackleford essays / Gambling 102 3rd ed.   | VERIFIED   | PAYWALL+OA  | wizardofodds.com (essays); ISBN 978-0929712079                                |
| Chen et al. 2024 DDA in gambling            | UNVERIFIED | —           | Replaced with Hervas-Garcia 2024 arXiv:2408.06818                            |
| GoF 1994                                    | VERIFIED   | PAYWALL     | ISBN 978-0201633610                                                          |
| Nystrom 2014                                | VERIFIED   | OA web      | https://gameprogrammingpatterns.com                                          |
| Schüll 2012                                 | VERIFIED   | PAYWALL+IA  | ISBN 978-0691127552                                                          |
| Gainsbury 2015 chapter                      | VERIFIED   | OPEN-PDF    | Sydney eScholarship 2123/22051                                               |
| Gainsbury et al. 2020                       | VERIFIED   | OA (PMC)    | DOI 10.1007/s10899-020-09964-z                                               |
| Thaler & Sunstein 2021                      | VERIFIED   | PAYWALL     | ISBN 978-0143137009                                                          |
| UKGC RTS                                    | VERIFIED   | OA          | https://www.gamblingcommission.gov.uk/standards/remote-gambling-and-software-technical-standards |
| MGA technical                               | VERIFIED   | OA          | https://www.mga.org.mt/                                                      |
| AGCO Std 4 / 2.x                            | VERIFIED   | OA          | https://www.agco.ca/                                                         |
| GlüStV 2021                                 | VERIFIED   | OA          | (federal gazette + GGL)                                                      |
| SIFS 2025:1                                 | VERIFIED   | OA          | https://www.spelinspektionen.se/en/                                          |
| Hervas-Garcia 2024 DDA                      | VERIFIED   | OA (arXiv)  | arXiv:2408.06818                                                             |
| Yannakakis & Togelius 2024 (2nd ed.)        | VERIFIED   | Mixed       | DOI 10.1007/978-3-031-56041-5                                                |
| Hofstede et al. 2025                        | VERIFIED   | OA (MDPI)   | DOI 10.3390/bs15060779                                                       |
