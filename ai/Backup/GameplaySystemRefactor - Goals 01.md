
# Gameplay System Refactor — Goals

**Board, Environment, and Gamepieces**

This document defines the **canonical goals and constraints** for the next major refactor of the board, environment, and gamepiece systems.
All implementation work must align with these goals.

---

## FOUNDATION

### **G1 — Establish the 4-zone board model (authoritative contract)**

The main screen consists of four horizontal zones:

1. **Time Zone**

   * Time graphs
   * Time lever / scrubbing
   * Time interaction is a core mechanic, not a debug feature

2. **Environment Tiles Zone**

   * 12-column grid
   * Persistent terrain systems
   * Hosts ordered gameplay tags and systems

3. **Environment Events Zone**

   * 12-column grid
   * Transient env events / animals
   * Spawned from season decks

4. **Hub Structures Zone**

   * Separate column space from env tiles/events
   * Player-built structures
   * Cross-zone targeting is global, not same-column

Env tiles/events and hub structures do **not** share a column grid; treat them as separate spaces.

---

### **G2 — Canonical board model with layered occupancy**

Introduce `state.board` as the authoritative spatial model.

* All pieces occupy:

  ```ts
  { col: number, span: number }
  ```
* Layers:

  * `tile`
  * `event`
  * `permanent`

Derived occupancy maps must be:

* deterministic
* rebuilt on:

  * deserialize
  * replay rebuild
  * canonicalization

No logic may rely on ad-hoc slot indices.

---

## ENVIRONMENT TILES & TAGS

### **G3 — Env tiles are persistent terrain systems**

Env tiles represent **long-lived terrain identity**.

EnvTileDefs:

* define identity
* define **initial ordered tags**
* define `seasonTables`
* **do not** define numeric props or tiers

EnvTileInstances store:

```ts
tags: string[]                 // ordered, unique
systemTiers: Record<SystemId, Tier>
```

Env tiles persist across seasons and time travel.

---

### **G4 — Tags are ordered, exclusive gameplay verbs**

EnvTags are the **primary verb system**.

Rules:

* Tags are boolean (present / absent)
* Tags are ordered; order defines priority
* A tile executes **at most one tag-driven intent per second**
* Tag execution is **exclusive**, not parallel
* Player may reorder tags; order is authoritative model state

Required command:

```ts
CmdSetTileTagOrder { tileCol: number, tagIds: string[] }
```

Adding a tag:

* appends it to the bottom by default

---

### **G5 — Systems own tiers, not tags**

Player-facing qualities (fertility, hydration, etc.) are **systems**, not tags.

EnvSystemDefs:

* define:

  * `defaultTier`
  * tier ladder semantics
* are the only place tiers exist

Rules:

* Tags may *enable* systems
* Tags never store tier data
* When a tag is added:

  * if it enables a system and that system is missing,
    initialize it to the system’s `defaultTier`

This rule is mandatory.

---

## ENVIRONMENT EVENTS & SEASONS

### **G6 — Season deck generation from env tiles**

Season decks are generated **once per season**.

On season start:

* For each env tile anchor:

  * roll exactly once from:

    ```ts
    EnvTileDef.seasonTables[currentSeason]
    ```
* Results populate a season deck:

  ```ts
  { seasonKey, entries: string[], drawIndex }
  ```

Deck rules:

* One deck per season
* No discard pile
* No carryover between seasons

---

### **G7 — Cadence-based event draws**

While a season is active:

* At a fixed cadence (e.g. every 5 seconds):

  * draw the next entry if available
  * spawn env event instance(s)
* When exhausted:

  * do nothing
* At season end:

  * delete the deck

Cadence is driven solely by `tSec`.

---

### **G8 — Env events are transient and absolute-time–bound**

EnvEventInstances use **absolute time lifecycles**.

On spawn at `tSec`:

```ts
createdSec = tSec
expiresSec = tSec + durationSec   // if defined
```

Rules:

* No countdown timers
* Expired when `tSec >= expiresSec`
* Optional `expiresOnSeasonChange`

This is mandatory and non-optional.

---

## EXECUTION MODEL

### **G9 — Tag-driven execution model (per-second, per-tile)**

Each second (while unpaused), for each env tile:

1. Evaluate tag intents in **tag order**
2. Check intent requirements
3. Select **at most one** intent
4. Emit its effects

**Pawn gate:** A tile evaluates tag intents **only if** a pawn is present on that tile at that second.

  * If no pawn present → skip intent evaluation entirely.
  * If pawn present → evaluate tags top-to-bottom and execute the **first eligible** intent (then stop).

This model guarantees:

* bounded execution cost
* deterministic replay
* clear priority resolution

---

### **G10 — Effects remain data-only and unconditional**

Effects describe **what happens if executed**, never **when**.

Rules:

* No gating logic inside effects
* No season / pawn / equipment checks in effects
* Gating lives in a resolver / manager layer

This preserves clarity and reuse.

---

## INTEGRATION & SAFETY

### **G11 — Preserve determinism, replay, and projection**

All new systems must obey:

* All randomness via `state.rng`
* No wall-clock or frame dependence
* Replay at the same `tSec` must produce identical results
* Projection must use the same execution path as replay

---

### **G12 — Minimal schemas, no premature tuning**

Design intent:

* Prefer systems + tiers over numeric props
* Avoid placeholder numeric tuning in terrain defs
* Keep schemas small and composable
* Expand complexity via:

  * tags
  * systems
  * interactions
    not via hard-coded numbers

---

## MIGRATION & IMPLEMENTATION

### **G13 — Staged migration, no hard cutover**

The refactor must be staged:

1. Introduce new schemas and instances
2. Introduce new execution manager
3. Route new content through new paths
4. Deprecate legacy env card logic
5. Remove legacy paths only after parity

Avoid long “half-broken” states.

---

## SUMMARY

This refactor establishes:

* Env tiles as persistent terrain systems
* Tags as ordered, exclusive verbs
* Systems as tiered player-facing qualities
* Env events as transient, absolute-time phenomena
* Time interaction as a core gameplay mechanic

The design intentionally prioritizes:

* determinism
* clarity
* extensibility
* emergent behavior

---

