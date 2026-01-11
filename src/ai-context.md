# PROJECT CONTEXT & ARCHITECTURAL GUIDELINES

## 1. Project Overview

**Genre**
Deterministic, time-driven city builder with MTG-style card, permanent, and deck mechanics.

**Technology**
- JavaScript (ES Modules)
- PixiJS (rendering only)
- Pure JavaScript authoritative model

**Defining Feature**
A fully deterministic simulation supporting:
- complete timeline replay
- time travel / scrubbing
- projection and forecasting

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
  - “what-if” exploration

---

## 6. Debugging & Cheats

- Debug or cheat features must be implemented as **actions**.
- Cheats must be:
  - recorded in the timeline
  - replay-safe
  - deterministic
- UI must never mutate state directly.

---

## 7. Working Rules for AI Assistance

Before writing any code, always perform an **Impact Analysis**:

1. **Determinism**
   - Does this introduce new timing or randomness sources?

2. **Serialization**
   - Does this add non-serializable data to state?

3. **Replay**
   - Will replay at the same `tSec` produce identical results?

4. **Layering**
   - Is logic leaking across Model / Controller / View boundaries?

---

## 8. Collaboration Preferences

- Ask for clarification before coding if requirements are ambiguous.
- Prefer full, copy-pasteable file replacements over diffs.
- Explain:
  - what changed
  - why it changed
  - how to test it
- Stage-specific plans belong in **separate documents or prompts**, not here.