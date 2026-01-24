# Effect Op Dictionary

Reference for `effects.js` EffectOps. All ops are data-only specs and must be executed via `runEffect`. Arrays of ops are allowed. `kind` is accepted as an alias for `op`.

## Common Conventions
- `target`: board target spec used by board ops and system ops.
  - `{ ref: "self" }` (defaults to `context.source`)
  - `{ ref: "self", layer: "tile" }` or `{ ref: "self", layer: "event" }`
  - `{ at: { layer: "tile", col: 3 } }`
  - `{ all: true, layer: "tile" }`
  - `{ ref: "pawn" }` (resolves the interacting pawn from context)
- Owner targets (for `ConsumeItem`, `TransferUnits`, `SpawnItem`) use the owner targeting spec (see Targeting Dictionary), e.g. `{ ref: "selfInv" }`.
- `context.kind`:
  - `"game"` for env tags/passives/intents, hub tags/passives/intents, pawn defs, and env events.
  - `"item"` for item passives.
  - `"inventoryMove"`, `"inventoryStack"`, `"inventorySplit"` for inventory commands.
- `defRegistry` resolution:
  - `defRegistry`: `"crops"`, `"items"`, `"envSystems"`
  - `defId`: explicit def id
  - `defIdFromSystemKey`: pull `tile.systemState[system].<key>` (e.g., `selectedCropId`)
  - `defIdFromVar`: pull `context.vars[<key>]`
- Amount resolution (where supported):
  - `amount`, `delta`
  - `amountVar` (context var)
  - `amountFromKey` (system state key)
  - `amountFromDefKey` (def field)
  - `amountScale` (multiplier)

## Inventory Ops
### moveItem
- Purpose: move an item between owners or within the same owner grid.
- Context: `context.kind = "inventoryMove"`.
- Required: `fromOwnerId`, `toOwnerId`, `itemId`.
- Optional: `targetGX`, `targetGY` (grid destination).
- Notes: handles stacking when possible; validates placement.

### stackItem
- Purpose: stack two items within the same owner inventory.
- Context: `context.kind = "inventoryStack"`.
- Required: `ownerId`, `sourceItemId`, `targetItemId`.
- Optional: `amount`.

### splitStack
- Purpose: split an item stack into a new item.
- Context: `context.kind = "inventorySplit"`.
- Required: `ownerId`, `itemId`, `amount`.
- Optional: `targetGX`, `targetGY`.

## Game Ops
### AddResource
- Purpose: add a numeric resource to `state.resources`.
- Required: `resource`, `amount`.

## Item Ops
### TransformItem
- Purpose: transform an item into another kind (keeps quantity).
- Context: `context.kind = "item"`.
- Required: `targetKind`.

### RemoveItem
- Purpose: remove an item from its inventory.
- Context: `context.kind = "item"`.

### ExpireItemChance
- Purpose: remove a random quantity from an item stack using a per-unit chance.
- Context: `context.kind = "item"`.
- Required: `chance` (0..1).
- Optional: `chanceFromDefKey`, `targetKind` (spawn result kind).
- Notes: uses deterministic RNG via `state.rng`.

### TickItemSeasonExpiry
- Purpose: decrement `item.seasonsToExpire` and transform/remove when it reaches 0.
- Context: `context.kind = "item"`.
- Optional: `targetKind` (transform); if omitted, item is removed.

## System Ops
### AddToSystemState
- Purpose: add a numeric delta to `target.systemState[system][key]`.
- Required: `system`, `key`.
- Amount: supports common amount resolution.
- Targeting: if `target` is omitted, defaults to `context.source` (tile, hub structure, or pawn).

### ClampSystemState
- Purpose: clamp a numeric system state value.
- Required: `system`, `key`.
- Optional: `min`, `max`, or `minKey` / `maxKey` from system state.
- Targeting: if `target` is omitted, defaults to `context.source`.

### AccumulateRatio
- Purpose: accumulate a ratio into a system state key (e.g., hydration sumRatio).
- Required: `system`, `numeratorKey`, `denominatorKey`.
- Optional: `targetKey` (default `sumRatio`), `min`, `max`.
- Targeting: if `target` is omitted, defaults to `context.source`.

### ResetSystemState
- Purpose: reset a system state to its def `stateDefaults`.
- Required: `system`.
- Notes: uses `envSystemDefs[system].stateDefaults` and deep clones (env systems only).
- Targeting: if `target` is omitted, defaults to `context.source`.

### AdjustSystemState
- Purpose: adjust a numeric system state value by flat and/or percentage.
- Required: `system`, `key`.
- Optional: `percent` (fractional, e.g. `0.1` = +10%), `delta`/`amount`, `min`, `max`.
- Optional sources: `percentFromKey`, `percentFromDefKey`, `percentVar`.
- Notes: formula is `next = current + delta + current * percent`, then clamped.
- Targeting: if `target` is omitted, defaults to `context.source`.

### ConsumeItem
- Purpose: consume items from owners (e.g., planting seeds).
- Context: `context.kind = "game"`.
- Required: `target`.
- Optional: `itemKind` (explicit), or def-based resolution via `defRegistry` + def fields.
- Amount: supports def/system/var resolution, `perOwner` for per-target usage.
- Output: `outVar` stores total consumed.
- Notes: supports `tierOrder` (`"asc"` or `"desc"`). Owner order follows the target resolver (tile occupants use `state.characters` order; `ownerIds` uses provided order).

### TransferUnits
- Purpose: move units from a system pool to owner inventories (e.g., harvesting).
- Context: `context.kind = "game"`.
- Required: `system`, `target`.
- Optional: `poolKey` (default `maturedPool`), `itemKind` or def-based resolution, `perOwner`, `tierOrder`.
- Amount: supports def/system/var resolution.
- Notes: deterministic owner and tier ordering; owner order follows the target resolver.

### SpawnItem
- Purpose: add items directly to inventories.
- Context: `context.kind = "game"`.
- Required: `target`.
- Optional: `itemKind` or def-based resolution, `tier`, `perOwner`.
- Amount: supports def/system/var resolution.

### CreateProcess
- Purpose: append a process entry to a system queue (e.g., crop growth).
- Required: `system`.
- Optional: `queueKey` (default `processes`), `processType`, def resolution fields.
- Amount: supports def/system/var resolution; stored as `inputAmount`.
- Duration: `durationSec` or `durationFromDefKey`.
- Capture: `captureSystem`, `captureKey`, `captureAs` (e.g., hydration sumRatio).

### FinalizeProcess
- Purpose: finalize ready processes and deposit output into a pool.
- Required: `system`.
- Optional: `queueKey` (default `processes`), `poolKey` (default `maturedPool`), `processType`.
- Notes: implementation uses growth hydration curve + fertility tables when available.

## Board Target Ops
### AddTag
- Purpose: add a tag to board targets and initialize system tiers/state defaults.
- Required: `tag`.
- Optional: `target`.
- Notes: uses `envTagDefs` and `envSystemDefs` (env tags only; not for hub tags).

### RemoveTag
- Purpose: remove a tag from board targets.
- Required: `tag`.
- Optional: `target`.

### DisableTag / EnableTag
- Purpose: disable or re-enable a tag without removing it from `target.tags`.
- Required: `tag`.
- Optional: `target`.
- Notes: disabled tags are skipped by env/hub execution; state stored under `target.tagStates[tagId].disabled`.

### SetSystemTier
- Purpose: set a system tier on a target.
- Required: `system`, `tier` (or `value` as tier).
- Optional: `target`.

### UpgradeSystemTier
- Purpose: move a system tier up or down.
- Required: `system`, `delta`.
- Optional: `target`.

### SetSystemState
- Purpose: replace the full system state object.
- Required: `system`, `value` (or `state`).
- Optional: `target`.

### ClearSystemState
- Purpose: delete system state entries (or clear all).
- Optional: `systems` array, `target`.

### RemoveEvent
- Purpose: remove env event anchors from the board.
- Required: `target`.

### TransformEvent
- Purpose: change an env event anchor to a new def.
- Required: `defId`, `target`.

## Generic Prop Ops
### SetProp
- Purpose: set a numeric prop on a target (e.g., hub structure props).
- Required: `prop`, `value`.
- Optional: `min`, `max`, `target`.

### AddProp
- Purpose: add a numeric delta to a prop.
- Required: `prop`, `amount`.
- Optional: `min`, `max`, `target`.

## Execution Notes (Env Tags)
- Passives run per tile regardless of pawn occupancy and may include `timing`.
- Intents run only when a pawn is present and only the first eligible intent per pawn executes each second (tag order priority).
- Gating belongs in `env-exec` via `requires` (never inside ops).
- Deterministic order: tiles in col order, pawns in `state.characters` order, tags/intents in def order.

## Execution Notes (Hub Tags)
- Passives run per hub structure regardless of pawn occupancy and may include `timing`.
- Intents run per pawn on the hub slot, once per second. The first payable intent per pawn executes (tag order priority).
- Costs are resolved and applied per pawn, atomically, before effects.
- Deterministic order: hub slots in index order, pawns in `state.characters` order, tags/intents in def order.

## Execution Notes (Items)
- Item defs can declare `passives` with `timing` (cadence or season change).
- Passives run via `processSecondChangeForItems` and `processSeasonChangeForItems`.
- Item passives run with `context.kind = "item"` and receive `{ inv, item, ownerId, tSec }`.
