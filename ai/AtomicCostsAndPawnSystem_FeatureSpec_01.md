## Revised v1 spec: Per-pawn atomic costs for env tile intents (queryable cost language)

This is the earlier “generic, queryable, atomic cost language” spec, revised so **tile intents execute per pawn** at the same `tSec`, and **cost failure only skips that pawn** (not the tile).

---

# 0) Invariants (lock these first)

1. **Execution unit:** `(tileCol, pawnId, tSec)`
   For each env tile column and each pawn standing on it at second `tSec`, evaluate and potentially execute one intent.

2. **Per-pawn intent limit:** each pawn can trigger **at most one** env intent on that tile per second:

   * “first matching intent wins” is evaluated **per pawn**.

3. **Atomic per-pawn payment:** costs are applied **only if fully affordable** for that pawn.
   If any cost is not affordable, **nothing is paid** and the pawn is skipped for that tick.

4. **Skip-pawn policy:** if costs/requirements fail for Pawn A, continue evaluation for Pawn B on the same tile/second.

5. **No attempt/success/outVars/branching** in v1.

6. **Deterministic ordering:**

   * iterate columns in ascending order (as today)
   * iterate pawns on a column in stable order (see §2)
   * iterate tile tags and their intents in their existing order
   * apply cost charges in declared order

---

# 1) Data registries (defs)

## 1.1 Pawn systems (required)

Create `pawnSystemDefs` with at least:

* `stamina`: `{ cur, max }`
* `hunger`: `{ cur, max }` (or satiety; pick semantics)

System def shape matches env systems:

```js
{
  id,
  kind,
  ui,
  defaultTier,
  tierMap,
  stateDefaults
}
```

## 1.2 Env intents gain optional `cost`

Extend env tag intent defs to include:

```js
intent: {
  id,
  verb,
  requires,
  cost,    // NEW (optional)
  effect
}
```

---

# 2) Deterministic “pawns on col” enumeration

Replace boolean pawn detection with enumeration.

## 2.1 Helper

`getPawnIdsOnEnvCol(state, col) -> pawnId[]`

Spec:

* iterate `state.characters` in **array order**
* collect `ch.id` where `ch.envCol === col`
* return the array (possibly empty)

This becomes the canonical worker order for per-pawn execution.

---

# 3) Eligibility requirements (tile-level + pawn-level)

You already gate env intents via `requirementsPass(...)`. Extend it minimally so that intent eligibility can depend on tile crop selection and (later) pawn state.

## 3.1 New requirement keys (v1)

* `requires.hasSelectedCrop: true`

  * passes if `tile.systemState.growth.selectedCropId` is a non-empty string

Optional (if you want tighter authoring):

* `requires.selectedCropIdIn: string[]`

Note: v1 does **not** require pawn-equipment requirements yet; costs cover most cases.

---

# 4) Generic cost language (queryable)

## 4.1 Where costs live

Inside each intent def:

```js
cost: { charges: ChargeSpec[] }
```

## 4.2 ChargeSpec (v1)

### A) System drain charge

```js
{
  kind: "system",
  target: { ref: "pawn" },
  system: string,      // e.g. "stamina"
  key: string,         // e.g. "cur"
  amount: AmountExpr,  // positive number paid
  clampMin?: number    // default 0
}
```

Semantics:

* affordability: currentValue >= amount
* payment: value -= amount; clamp to clampMin

### B) Item payment charge

```js
{
  kind: "item",
  target: { ref: "pawnInv" },
  itemId: ItemIdExpr,
  amount: AmountExpr   // positive integer
}
```

Semantics:

* affordability: inventory contains >= amount units of itemId
* payment: consume exactly amount deterministically (same selection semantics as existing ConsumeItem)

## 4.3 Target refs (v1)

Cost resolver must support these symbolic payers:

* `{ ref: "pawn" }` → current pawn entity
* `{ ref: "pawnInv" }` → current pawn’s inventory

(You may also pass `{ ref: "selfTile" }` in context, but v1 doesn’t need it for payment.)

## 4.4 AmountExpr (v1)

Minimum expression support:

* `{ const: number }`
* `{ var: "selectedCropId", map: { [cropId]: number }, default: number }`

Rules:

* resolve must return finite number >= 0, else resolution fails

## 4.5 ItemIdExpr (v1)

* literal string `"barleySeed"`
* or crop-dependent:

```js
{ var: "selectedCropId", map: { barley:"barleySeed", wheat:"wheatSeed" }, default: null }
```

If resolves to null/undefined → resolution fails.

---

# 5) Pure cost resolution (no mutation)

## 5.1 Cost context per pawn

When evaluating a pawn on a tile:

* `pawnId`
* `pawn` (read-only reference)
* `pawnInv` (read-only reference)
* `tile` (read-only)
* `envCol`
* `selectedCropId` (pre-read from tile)
* `tSec`
* `state` (read-only)

## 5.2 Function

`resolveCosts(costSpec, ctx) -> ResolvedCosts | null`

ResolvedCosts:

```js
{ charges: ResolvedCharge[] }
```

Where each ResolvedCharge is fully concrete:

* system charge: `{ kind:"system", pawnId, system, key, amount, clampMin }`
* item charge: `{ kind:"item", pawnId, itemId, amount }` (inv implied by pawn)

Return null if:

* missing pawn or pawnInv
* invalid expressions
* itemIdExpr resolves to null
* amount invalid

---

# 6) Atomic affordability check (per pawn)

## 6.1 Function

`canAffordCosts(resolvedCosts, ctx) -> boolean`

Rules:

* system: `pawn.systemState[system][key] >= amount`
* item: inventory has >= amount (consistent with ConsumeItem counting rules)

If any charge fails → false.

---

# 7) Atomic payment (per pawn)

## 7.1 Function

`applyCosts(resolvedCosts, ctx) -> void`

Precondition:

* must only be called if canAffordCosts is true

Payment:

* apply charges in order
* system drains mutate pawn.systemState
* item drains consume from pawnInv using the same deterministic selection semantics as existing ConsumeItem (no outVar)

No partial application is allowed.

---

# 8) Integration into env intent execution (per pawn)

Modify env intent evaluation to be per pawn:

For each env col:

1. `tile = board.occ.tile[col]`; if none continue
2. compute `pawnIds = getPawnIdsOnEnvCol(state, col)`
3. run tile passives once (existing behavior)
4. For each `pawnId` in pawnIds:

   * build `pawnCtx` (includes pawn/pawnInv/tile/selectedCropId/tSec)
   * iterate tile tags (in order), then intents (in order):

     * build `baseContext` for requirements:

       * include `hasPawn: true` (since this loop is per pawn)
       * include `selectedCropId` / `tile` as needed
     * if requirements fail → continue to next intent
     * if intent has `cost`:

       * resolved = resolveCosts(intent.cost, pawnCtx); if null → this intent is not executable for this pawn; continue to next intent
       * if !canAffordCosts(resolved, pawnCtx) → continue to next intent
       * else applyCosts(resolved, pawnCtx)
     * run intent effect via `runEffect(state, effect, effectContext)`

       * effectContext includes `{ pawnId, ownerId: pawnId, envCol: col, source: tileAnchor, tSec, kind: "env" }` (exact shape depends on your current conventions)
     * stop intent search for this pawn for this tick (first match wins per pawn)
   * proceed to next pawnId

---

# 9) Authoring examples

## 9.1 Farm work intent (per pawn, crop-dependent)

```js
{
  id: "farmPlant",
  requires: { 
    hasSelectedCrop: true 
    hasMaturedPool: false,
  },
  cost: {
    charges: [
      { kind:"system", target:{ref:"pawn"}, system:"stamina", key:"cur", amount:{const:2}, clampMin:0 },
      {
        kind:"item", target:{ref:"pawnInv"},
        itemId:{ var:"selectedCropId", map:{ barley:"barleySeed", wheat:"wheatSeed" }, default:null },
        amount:{const:1}
      }
    ]
  },
  effect: [
    {       
        op: "CreateProcess",
        system: "growth",
        defRegistry: "crops",
        defIdFromSystemKey: "selectedCropId",
        durationFromDefKey: "maturitySec",
        processType: "cropGrowth",
        queueKey: "processes",
        captureSystem: "hydration",
        captureKey: "sumRatio",
        captureAs: "sumAtStart", 
    }
  ]
}
```

## 9.2 “Rest” 

```js
{
  id: "rest",
  requires: {},
  cost: { charges: [] },
  effect: [
    { op:"AddPawnSystemState", target:{ref:"pawn"}, system:"stamina", key:"cur", amount:1 }
  ]
}
```

(You’ll need a pawn system op or a generic host target system op; see §10.)

---

# 10) Effect ops needed (minimal)

To keep v1 small, costs can mutate pawn systems directly via applyCosts without going through runEffect.

### Approach : add pawn as a valid “system target”

Extend targeting so `AddToSystemState`/`ClampSystemState` can target `{ref:"pawn"}` and operate on pawn.systemState, not tile.systemState.
This keeps authoring consistent: “systems everywhere”.

---

# 11) Determinism / replay checks

* Per col, per pawn order is stable (characters array order).
* Costs are pure-resolved and atomically applied.
* No outVar/branching.
* No reactive listeners.
* Same inputs → same payments → same growth progress.

---

# 12) Smoke tests

1. Two pawns on same farm tile with enough stamina+seed:

   * both pay costs
   * growth progress increments twice in same second
2. Pawn A lacks seed, pawn B has seed:

   * A skips work (may execute fallback intent if present)
   * B performs work and pays costs
3. Pawn lacks selectedCropId:

   * farm-work not eligible (requirement)
   * no stamina/seed spent
4. Replay rebuild at same tSec matches.

---