# PROJECT CONTEXT & ARCHITECTURAL GUIDELINES

## 1. Project Overview

**Genre**
Deterministic, time-driven city builder with MTG-style card, keyword, and deck mechanics.

**Technology**
- JavaScript (ES Modules)
- PixiJS (rendering only)
- Pure JavaScript authoritative model

**Defining Feature**
A fully deterministic simulation supporting:
- complete timeline replay
- time travel / scrubbing
- projection and forecasting

### Board & Gamepieces review

* **4-zone board model:** timegraphs / env tiles / env events / hub
* **Env tiles:** persistent; store ordered tags + system tiers; tile defs are tier-ignorant.
* **Tags:** ordered, unique, gameplay-relevant verbs; at most one tag intent executes per tile per second.
* **Pawn gate:** if no pawn on tile → skip intent evaluation entirely.
* **Systems:** own tiers; when adding a tag that enables a system, initialize missing system tier to that system’s `defaultTier`.
* **Env events:** transient; absolute-time lifecycle (`createdSec`, `expiresSec`).
* **Season deck:** generated at season start from tiles; drawn on fixed cadence; no discard pile; deleted at season end.
* **Effects:** data-only; gating stays in resolver/manager layer.


## 2. Core Principles (Non-Negotiable)
### A. Determinism
**Invariant Rules**
- All randomness must flow through `state.rng` (seeded).
- `Math.random()` is forbidden.
- Simulation must not depend on:
  - wall-clock time
  - frame timing
  - UI state
  - platform-specific behavior

**Authoritative Time**
- The master clock is `simStepIndex → tSec` (integer seconds).
- Time advances only through the simulation tick path.
- Time is frozen only when `state.paused === true`.

---

### B. Serialization

**Authoritative State**
- `GameState` must be 100% JSON-serializable.

**Forbidden in State**
- Classes
- Functions
- Closures
- Maps / Sets
- Circular references

**Derived Data**
- Derived fields must be stripped on serialize.
- Derived fields must be rebuilt on deserialize.
- Replay, projection, and graphs must operate on rebuilt state.

---

### C. Separation of Concerns (Strict)

#### 1. Defs (`src/defs/*`)
- Immutable data only
- No mutable state
- No imperative logic
- May describe behavior declaratively (DSL), never execute it

#### 2. Model (`src/model/*`)
- Owns all authoritative state and rules
- Owns:
  - time advancement
  - commands
  - effects
  - behaviors
  - replay logic
- No PixiJS, DOM, or UI imports

#### 3. Controllers (`src/controllers/*`)
- Orchestrate execution (e.g. simulation runner)
- Decide *when* to tick, pause, scrub, or rebuild
- Never contain gameplay rules

#### 4. Views (`src/views/*`)
- Rendering and input only
- No gameplay logic
- Dispatch intent as actions to the model

### D. DSL-First Behavior Authoring (Gamepiece Work)

When implementing behavior for gamepieces (tiles, events, hub structures, pawns, items, tags, systems, processes):

1. Prefer existing DSL affordances first
   - Attempt to express requested behavior using existing effect ops, targeting, timing, requires gates, and defs data.
   - Favor declarative composition over new imperative logic.

2. If existing DSL is insufficient, extend DSL in a generalized way
   - Add or expand ops/targeting/trigger affordances as reusable primitives.
   - Design the extension to cover a class of similar behaviors, not a single content case.

3. Implement the requested behavior as data using the new affordance
   - After extending the DSL, express the actual feature in defs/content.
   - Avoid bespoke one-off execution paths when the behavior can be represented by reusable DSL primitives.

Practical guardrail:
- New imperative model logic should usually be engine-level DSL infrastructure, not content-specific behavior.

---

## 3. Time, Simulation, and Phases

### Authoritative Time Axis
- `tSec` (integer seconds) is the universal timeline axis.
- Derived from fixed simulation steps (`1/60`).
- Used consistently by:
  - replay
  - projection
  - graphs
  - UI scrubbers

### Phases
- **Simulation phase**
  - Gameplay simulation runs
  - Timed behaviors advance
- **Planning phase**
  - Gameplay simulation is idle
  - Editing and inspection allowed
- Phase does not define time; pause does.

### Pause Semantics
- `state.paused === true` freezes time.
- No simulation advancement while paused.
- No resource income while paused.

---

## 4. Actions, Timeline, and Replay

### Actions
- Actions are authoritative, recorded, and replayable.
- Actions are timestamped to `tSec`.
- Actions execute at the **start of their second**.
- Multiple actions in the same second execute in recorded order.

### Timeline
- Timeline is the sole source of truth for history.
- Supports:
  - branching
  - truncation
  - scrubbing
  - projection
- Legacy indices (e.g. boundaries) may exist but are non-authoritative.

### Timeline management notes
- `cursorSec` is the current playhead/scrub position.
- `historyEndSec` is the farthest realized second on the *current branch*.
- Editing the past truncates all future history and resets `historyEndSec` to the edit second.
- Projection/forecasting always starts at `historyEndSec` and extends forward by the projection horizon.
- `timeline.revision` bumps on any timeline mutation (actions or checkpoint maintenance), so it is broader than "actions changed."

### Time-Travel Validity Contract (Post Refactor)
- `timeline` is the single source of truth for historical/forecast reconstruction.
- `runner.getCursorState()` is authoritative at current `cursorSec`.
- `runner.getState()` may return preview state during scrubbing; preview is read-only and non-authoritative.
- `dragPreviewState` is ephemeral and must never be persisted into timeline/checkpoints/save payloads.

**Scrub browse/commit correctness**
- `browseCursorSecond(tSec)` and `commitCursorSecond(tSec)` must resolve from timeline rebuild truth.
- Cached `stateData` may accelerate reads but must not be trusted as authority for scrub commits.
- Scrub commit must finish paused at committed second with preview cleared.

**Branching and truncation**
- Any mutation at `tSec` truncates future history beyond that second.
- Planner commits replace actions at `tSec` and truncate future branch from that point.
- Projection/graphs must rebuild from new frontier (`historyEndSec`) after branch edits.

**Planner boundary validation**
- Validate planner commits against second-boundary state for `tSec`:
  - replay through `tSec - 1`
  - advance one full simulated second
  - apply all actions at `tSec` in deterministic order
- If validation fails, reject commit and reset planner staging to timeline truth.

**Checkpoint and memo safety**
- Checkpoints/memo are performance caches, never authority.
- Exact checkpoint at `tSec` is potentially stale if actions exist at `tSec`.
- Rebuild path remains the canonical correctness path.

**Projection cache safety**
- Projection caches must be signature-guarded against timeline mutations.
- Cached forecast snapshots must be invalidated on branch edits.
- Projection remains pure read-side simulation and never mutates authoritative model state.

### Replay
- `rebuildStateAtSecond(tSec)` is authoritative.
- Replay:
  - applies actions at second boundaries
  - advances exactly `60` microsteps per second
  - uses the same simulation path as live play

---

## 5. Projection & Forecasting

- Projection is **pure**:
  - never mutates authoritative state
  - always operates on cloned/rebuilt state
- Projection must use the same stepping logic as replay.
- Projection exists for:
  - graphs
  - previews
  - "what-if" exploration

### Graph and scrub guarantees
- During active drag scrub, preview may diverge from committed cursor state.
- On scrub release commit, cursor state must equal replay truth at committed `tSec`.
- Timeline edits (pawn move, crop selection, tag toggle, recipe/tag order, etc.) must immediately affect subsequent projection and scrub results on the active branch.

---

## 6. Debugging & Cheats

- Debug or cheat features must be implemented as **actions**.
- Cheats must be:
  - recorded in the timeline
  - replay-safe
  - deterministic
- UI must never mutate state directly.

---

## 7. Anti-patterns:

* Don’t add countdown timers; use absolute expiry seconds.
* Don’t implement gating inside effects.
* Don’t store Maps/Sets in state (including “indexes”); keep them derived and rebuilt.

---


## 8. Working Rules for AI Assistance

Before writing any code, always perform an **Impact Analysis**:

1. **Determinism**
   - Does this introduce new timing or randomness sources?

2. **Serialization**
   - Does this add non-serializable data to state?

3. **Replay**
   - Will replay at the same `tSec` produce identical results?

4. **Layering**
   - Is logic leaking across Model / Controller / View boundaries?

5. **Clarity**
   - Use explicit, intention-revealing variable names. Conversly avoid abbreviated or ambiguous variable names



---

## 9. Collaboration Preferences

- Ask for clarification before coding if requirements are ambiguous.
- Explain:
  - what changed
  - why it changed
  - how to test it


