

## Master refactor plan: graphs, projection, and time travel performance (ROI-first, deterministic)

### Guiding invariants (non-negotiable)

* Replay and tick-based projection must remain **exactly equivalent** to the authoritative sim: **60 microsteps per second** (`dt = 1/60`).  
* Timeline remains **linear with truncation** (no branching introduced).
* Timeline is the **single owner of past-seconds serialized snapshots**; graphs cache only forecast.
* Graph sampling is **semantic-density** driven; focus mode increases density and near-cursor fidelity.

---

## Phase 0 — Guardrails, instrumentation, and baselines (DEV-only)

**Goal:** quantify impact and prevent regressions.

**Deliverables**

1. Timing instrumentation (DEV flag) for:

   * `rebuildStateAtSecond` cost and memo hit rate
   * checkpoint maintenance cost (if applicable per tick/commit)
   * projection window build time (history vs forecast)
   * timegraph controller cache hit/miss counts
   * graph render time and plotted-point count
2. A one-call “perf snapshot” helper (debug overlay callable) reporting:

   * timeline: `revision`, action count, checkpoint count, memo size, actionsBySec size
   * graphs: forecast cache size, last build durations, last point counts

**Files likely touched**

* `src/model/timeline.js` 
* `src/model/projection.js` 
* `src/model/timegraph-controller.js` 
* `src/views/timegraphs-pixi.js` 
* (optional) debug overlay entry point in `src/views/ui-root-pixi.js` 

**Smoke tests**

* Open/close each graph, toggle focus, scrub timeline, commit planner edits; verify counters update and no behavioral change.
* Run determinism suite.

---

## Phase 1 — Hardening patch: strict tick-based projection dt (no approximations)

**Goal:** eliminate silent divergence and misleading API surface.

**Policy**

* Any projection path that advances by `updateGame(dt, state)` looping is **strictly** `dtStep === 1/60` (or omitted/default).
* Any non-`1/60` call returns `{ ok:false, reason:"unsupportedDtStep" }` (no implicit “approximate” stepping). 

**Scope**

* `simulateForwardSecondsInPlace`
* `simulateUntilNextSeasonEventPure`
* any exported builder receiving `dtStep` (directly or via options)
* timegraph controller must never pass a non-default dt

**Files**

* `src/model/projection.js` 
* `src/model/timegraph-controller.js` 

**Smoke tests**

* Forecast still works with default dt.
* Any hidden non-1/60 usage fails loudly (expected).

---

## Phase 2 — Timeline becomes the single owner of past-seconds snapshot caching

**Goal:** remove duplicated state-at-second caches and rebuild work.

**Current duplication**

* timeline memo cache (revision-keyed) 
* projection checkpoint map + rebuild path 
* timegraph controller’s stateData LRU for past seconds 

**Deliverables**

1. **New timeline API:** `getStateDataAtSecond(tl, sec)`

   * Returns serialized `stateData` for `sec` using:

     * exact checkpoint if present
     * memo if present
     * rebuild + memo write if missing
   * Guarantees `actionsBySec` is fresh (since graphs depend on action seconds).
2. Update projection to use timeline snapshot service for past:

   * `getStateAtSecond` becomes “stateData from timeline → deserialize → canonicalize”
3. Update timegraph controller:

   * Remove (or sharply reduce) its internal “past seconds” cache.
   * Only keep cache for **forecast seconds > historyEndSec** (purely ephemeral).

**Files**

* `src/model/timeline.js` 
* `src/model/projection.js` 
* `src/model/timegraph-controller.js` 

**Smoke tests**

* Reopen graphs repeatedly: past history should be instant after first build.
* Scrub to previously visited seconds: no repeated heavy rebuild.
* Forecast caching behavior unchanged.

---

## Phase 3 — First-class action-second index and range query from timeline

**Goal:** eliminate repeated O(n) action scans/sorts across layers and improve snapping/sampling performance.

**Deliverables**

1. **New timeline API:** `getActionSecondsInRange(tl, startSec, endSec)`

   * Returns sorted unique seconds containing actions within the range.
   * Cached per `revision` (or per internal actions signature) inside timeline.
2. Replace action-second derivation in:

   * timegraph controller history enrichment
   * graph snapping lists (view/controller)
   * any “include action seconds” logic in projection cache builders (if applicable)

**Files**

* `src/model/timeline.js` 
* `src/model/timegraph-controller.js` 
* `src/views/timegraphs-pixi.js` 

**Smoke tests**

* Frequent planner commits don’t cause spikes.
* Scrub snapping remains correct and stable.

---

## Phase 4 — Semantic-density sampling policy + focus-mode fidelity

**Goal:** bound graph work by “meaningful events,” not run duration; integrate focus button semantics.

### Semantic density rules (defaults)

For a requested time window `[startSec, endSec]`:

**Always include**

* `startSec`, `endSec`
* `historyEndSec` if it lies in range (frontier marker)
* all action seconds in range (from timeline API)
* cursor second if it lies in range (for interaction fidelity)

**Filler sampling**

* Add additional evenly-spaced samples (“shape preservation”) subject to caps:

  * **Normal mode target:** 250–400 total points (after injecting action seconds)
  * **Focus mode target:** 900–1400 total points
* **Near-cursor densification (focus mode):**

  * add a higher-density sub-window around cursor (e.g. ±30s or ±60s), while keeping global cap.

**Guarantees**

* Filler never displaces action seconds.
* If action seconds alone exceed cap, keep all action seconds and drop filler entirely (graph remains semantically correct).

### Deliverables

1. Move sampling selection fully into controller:

   * controller returns the finalized ordered list of sample seconds
2. View becomes render-only:

   * consumes samples; does not compute action seconds or stride decisions itself.
3. Cache histories by (metric, subjectKey, samplingModeSignature):

   * samplingModeSignature captures focus vs normal + window length bucket
   * relies on timeline snapshot service for past seconds

**Files**

* `src/model/timegraph-controller.js` 
* `src/views/timegraphs-pixi.js` 
* (optional) `src/views/ui-root-pixi.js` if focus state is propagated from UI 

**Smoke tests**

* Long-run graphs open quickly and remain interactive.
* Focus toggling increases detail without freezes.
* Action-second fidelity is preserved in both modes.

---

## Phase 5 — Event-driven fast-forward projection (separate path from dt)

**Goal:** reduce forecast cost from O(seconds) microsteps to O(events) for eligible systems, without changing tick-based determinism.

**Key principle**

* This is not “larger dt.” It is “skip microsteps where equivalence is provable.”

**Deliverables**

1. Introduce a model-layer “fast-forward adapter” (new module):

   * `canFastForward(state, metricOrMode)`
   * `advance(state, fromSec, toSec)` for specific subsystems/fields
2. Projection scheduler identifies boundaries:

   * next season boundary (based on season clock) 
   * next cadence tick for any fast-forwarded subsystem
   * any other discrete triggers you define
3. Projection chooses:

   * fast-forward across intervals without boundaries
   * fall back to microstep simulation across intervals containing boundaries or non-FF systems
4. Start small:

   * enable fast-forward for a single metric/system at a time (e.g., AP income if purely `tSec`-derived)
   * validate equivalence vs microstep projection over randomized windows

**Files**

* `src/model/projection.js` 
* New: `src/model/fastforward.js` (or similar)
* Possibly reference helpers from `src/model/commands.js` (season boundary semantics) 

**Smoke tests**

* Automated equivalence checks: microstep vs fast-forward projection match for enabled systems.
* Determinism suite stays green.
* Forecast graphs show identical series values for supported metrics.

---

## Phase 6 — Canonicalization overhead reduction (only if profiling proves it’s hot)

**Goal:** avoid repeated `rebuildBoardOccupancy` when deserializing identical snapshots repeatedly. 

**Deliverables**

1. Add runtime-only canonicalization marker:

   * e.g., `state._canonVer` plus schema token
2. `canonicalizeSnapshot` early-out if already canonical for current schema version.
3. Ensure marker is set:

   * after `deserializeGameState`
   * after any operation that rebuilds occupancy and phase
4. Ensure marker is invalidated only where required (keep scope minimal).

**Files**

* `src/model/canonicalize.js` 
* `src/model/state.js` (deserialize path) 
* `src/model/timegraph-controller.js` if it canonicalizes frequently 

**Risk**

* Medium. Only proceed if Phase 0 shows canonicalize as a significant hotspot.

---

## Integration checkpoints after each phase

1. Determinism suite (already wired in UI root). 
2. Manual:

   * run → pause → edit planner → commit → scrub backward across action seconds
   * open/close graphs; scrub within graph; toggle focus
   * verify forecast extends correctly from frontier
3. Perf snapshot:

   * confirm cached counts and timings move in the expected direction

---

## “Definition of done” for the performance effort

* Graph history build time stays bounded as run length increases (semantic caps).
* Repeated scrubs to past seconds are memo/cache hits (timeline-owned).
* Forecast extension work scales with horizon, and Phase 5 reduces that to event density where enabled.
* No silent dt divergence; any misuse fails loudly.