# Goals — First Pass Farming Loop (Barley / Floodplain)

This document defines the **scope, behavior, and acceptance criteria** for implementing a first-pass farming loop consistent with the current deterministic simulation + timeline replay architecture.

---

## 0) High-level objective

Implement a deterministic, replay-safe **barley farming loop** on floodplain tiles:

* Flood recedes → farming becomes available and hydration is high.
* Player selects Barley for the tile’s Growth system (action, logged).
* Characters standing on the tile automatically plant (consume barley) over time.
* After a fixed maturation time, planted batches convert into a matured pool.
* Characters harvest from matured pool into inventory over time.
* Yield is influenced by hydration (numeric meter + tier-shaped curve) and fertility (tiered RNG quality table).

---

## 1) Non-negotiable engine constraints

* Must preserve determinism:

  * All randomness uses `state.rng`.
  * All simulation changes occur via the authoritative tick path and replay identically.
* Crop selection is a **timeline action** (recorded at a specific `tSec`).
* No “UI-only” state may affect simulation outcomes.
* All new state must be JSON-serializable and survive `serialize/deserialize`.

---

## 2) Board + tile state model changes

### 2.1 Tile system state

Add a serializable per-tile container:

* `tile.systemState: { [systemId: string]: anySerializable }`

This is authoritative state (unlike `board.occ`, which is derived).

### 2.2 Hydration system state (meter + accumulator)

When hydration is relevant on a tile:

* `tile.systemState.hydration = { cur, max, decayPerSec, sumRatio }`

Locked values (v1):

* `max = 100`
* `decayPerSec = 2`
* `cur` clamped `[0..max]`
* `sumRatio` accumulates `cur/max` once per second (see timing contract)

### 2.3 Growth system state (barley loop)

When growth is relevant on a tile:

* `tile.systemState.growth = { selectedCropId, plantedBatches, maturedPool }`

Where:

* `selectedCropId: string | null` (set by player action)
* `plantedBatches: Array<Batch>`
* `maturedPool: { bronze: number, silver: number, gold: number, diamond: number }`

Batch (v1):

* `{ id: string, cropId: string, plantedSec: number, seedCommitted: number, sumAtPlant: number }`

Notes:

* `id` is primarily for debug and stable identification.
* `cropId` stored per batch (even if only barley v1) for future extensibility.
* `maturesSec` is derived as `plantedSec + 32` (locked maturation time).

---

## 3) Crop definition contract (Barley)

Add a crop definition for Barley (where defs live is implementation choice, but must be data-only):

Locked v1 crop values:

* `cropId = "barley"`
* `maturitySec = 32`

Parameters required (v1):

* `plantSeedPerSec` (base planting rate, before character multipliers)
* `harvestUnitsPerSec` (base harvest rate, before character multipliers)
* `baseYieldMultiplier` (used in maturity conversion)
* `qualityTablesByFertilityTier` (prob distributions for output tier)

Design tuning target (soft):

* In typical conditions (silver hydration + silver fertility, no other impacts), average conversion should be ~5 barley out per 1 barley planted.

---

## 4) Event / tag / system enablement

### 4.1 Flooding lifecycle

Update flood-related content so that floodplain farming behaves as intended:

* Flood **onEnter**:

  * removes farmable capability (or otherwise disables farming)
  * clears growth + hydration system state (cleanup hook)
* Flood **onExit**:

  * re-enables farming
  * initializes hydration meter: `cur=max=100`, `decayPerSec=2`, `sumRatio=0`
  * sets hydration tier + fertility tier to initial values (locked: silver/silver unless otherwise specified)

### 4.2 Cleanup hook (required)

Implement a data-driven cleanup operation to clear tile system state when farmable is removed / flood enters.

Acceptance:

* No stale growth/hydration state remains after farming is disabled.
* Cleanup is replay-safe and action/effect-driven (not UI-driven).

---

## 5) Per-second simulation rules (authoritative behavior)

### 5.1 Ordering within a second

For tiles where farming is enabled and a character is present, per-second processing must be deterministic. A consistent order must be selected and documented.

### 5.2 Hydration decay and accumulator update

Each second on relevant tiles:

1. Apply any event-driven hydration changes for that second (if any exist).
2. Apply decay: `cur = max(0, cur - decayPerSec)`
3. Accumulate: `sumRatio += cur/max`

(Exact order must be consistent and deterministic; above order is the target.)

### 5.3 Planting (automatic when selected crop exists)

If:

* tile has farmable enabled
* growth.selectedCropId is set to "barley"
* one or more characters occupy the tile
* those characters have barley in inventory

Then each second:

* Determine planting effort per character (v1: base only; later multiply by skill).
* Consume barley from occupying characters in deterministic order (lowest `charId` first).
* For each second where `seedCommitted > 0`, append a batch:

  * `plantedSec = current tSec`
  * `seedCommitted = amount consumed total (or per character, but must be deterministic)`
  * `sumAtPlant = hydration.sumRatio` at time of planting

### 5.4 Maturation (conversion at fixed time)

Each second, for each batch where:

* `tSec >= plantedSec + 32`

Convert batch → matured pool:

1. Compute hydration average ratio over growth window:

   * `rAvg = (hydration.sumRatio - batch.sumAtPlant) / 32`
   * clamp to `[0..1]`

2. Compute hydration factor:

   * `f(rAvg, hydrationTier) = A[tier] * rAvg ^ P[tier]`
   * v1 tier params:

     * bronze:  A=0.85, P=1.80
     * silver:  A=1.00, P=1.45
     * gold:    A=1.10, P=1.20
     * diamond: A=1.20, P=1.05

3. Compute matured unit count:

   * `maturedUnits = seedCommitted * baseYieldMultiplier * f(rAvg, hydrationTier)`
   * define rounding rule (must be deterministic): e.g. floor/round.
   * v1: choose a single rounding rule and use it everywhere.

4. Allocate maturedUnits into quality tiers using fertility tier:

   * roll per-unit or per-chunk using `state.rng`
   * add counts into `maturedPool` tiers

5. Remove the batch from `plantedBatches`.

### 5.5 Harvesting (automatic when maturedPool > 0)

If:

* tile has one or more occupying characters
* maturedPool has any units

Then each second:

* Determine harvest capacity per character (v1: base only).
* Transfer from maturedPool → character inventories, in deterministic order (lowest charId first).
* Tier ordering: remove from highest tier first (diamond→gold→silver→bronze).
* Inventory stacking rule: never mix tiers in a stack.

---

## 6) Player action: selecting Barley on a tile

### 6.1 Action requirements

Introduce an action to set growth selection for a tile:

* Must be recorded in timeline with `tSec`.
* Must be visible in action log.
* Must be no-op cost if the selection is unchanged (swapping repeatedly should not stack costs beyond net change rules).

### 6.2 Paused gating

Selection edits should follow existing edit conventions (typically paused-gated unless explicitly exempted).

---

## 7) UI requirements (minimal v1)

* Tile inspector shows:

  * Hydration meter (`cur/max`)
  * Fertility tier
  * Growth selection control (“Select crop” dropdown; barley only v1)
  * Growth status:

    * planted batches count
    * matured pool counts (optionally summarized)
* UI must dispatch actions; must not directly mutate model state.

---

## 8) Acceptance criteria / smoke tests

### Determinism & replay

* Run a short simulation with identical inputs twice → identical state hashes.
* Create a timeline, branch at a past `tSec`, change crop selection, and verify:

  * future state changes
  * replay remains stable and consistent.

### Farming loop correctness

* Flood exit initializes hydration meter on floodplain tiles.
* Planting consumes barley while a character stands on the tile with barley in inventory.
* After 32 seconds, planted batches mature into maturedPool.
* Harvesting transfers from maturedPool to character inventory at the defined rate.
* Highest-tier-first harvesting works and no mixed-tier stacks appear.

### Cleanup

* Flood enter (or farmable removal) clears growth + hydration system state.
* No maturation/harvest occurs while farming is disabled.

---

## 9) Explicit out-of-scope (v1)

* Multiple crop types beyond barley (structure supports it, but only barley implemented).
* Character skill/laborforce modifiers (hook points allowed; base rate only).
* Canal/levee engineering impacts (only hydration meter baseline exists).
* Complex environmental impacts beyond flood enable/disable and optional direct hydration changes.
* UI polish beyond basic inspector + action dispatch.

---

## 10) Deliverables

* Updated defs:

  * floodplain tile and flooding event updated to match farming lifecycle
  * barley crop/item defs added
  * fertility quality tables added
* Model changes:

  * `tile.systemState` implemented and serialized
  * hydration meter + accumulator processing per second
  * growth batch creation, maturation conversion, matured pool, harvesting
  * action for crop selection with proper timeline behavior
  * cleanup hook for farmable removal / flood enter
* Minimal UI wiring for selection + display (no heavy UX work).
