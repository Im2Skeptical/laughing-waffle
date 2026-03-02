# Effect Op Dictionary

Reference for all currently registered effect ops in `src/model/effects/index.js`.

## Core Rules
- Effects are data specs executed via `runEffect(state, effect, context)`.
- An effect can be a single object or an array of effect objects.
- `kind` is accepted as an alias for `op`.
- Unknown ops are ignored (return `false`).

## Skill Tree Effects
- Skill tree node effects are authored as effect specs in `skillNodes[*].onUnlock` and executed via `runEffect`.
- Unlock execution path: `cmdUnlockSkillNode` in `src/model/commands/pawn-skill-commands.js`.
- `skillNodes[*].effects` is deprecated and fails validation (`validate-skill-defs.js`).
- `skillNodes[*].onLock` is validated but not currently used by the unlock command path.

### Skill Node Requirement Shape
- `requirements.requiredNodeIds: string[]`

### Skill Modifier Keys (validated for skill-node effects)
- `forageTierBonus` (additive integer)
- `forageStaminaCostDelta` (additive integer)
- `farmingStaminaCostDelta` (additive integer)
- `restStaminaBonusFlat` (additive integer)
- `restStaminaBonusMult` (multiplicative number)
- `apCapBonus` (additive integer)
- `projectionHorizonBonusSec` (additive integer)
- `populationFoodMult` (multiplicative number)

### Notes
- AP cap, projection horizon, seasonal population food attempts, and recipe/building availability are driven by aggregated skill runtime modifiers/unlocks.

## Shared Conventions

### Context kinds in use
- `game`: env events, env tag passives/intents, hub tag passives/intents, pawn passives/intents, skill-node unlock effects.
- `item`: item-tag passives and equipped-item passives.
- `inventoryMove`, `inventoryStack`, `inventorySplit`: inventory command contexts.
- Other kinds may exist (for example `build`) but only ops that explicitly check `context.kind` are restricted.

### Def lookup (`resolveEffectDef`)
- `defRegistry` or `registry`: `"crops" | "cropDefs" | "items" | "itemDefs" | "envSystems" | "envSystemDefs"`.
- `defId`: explicit id.
- `defIdFromVar`: from `context.vars[key]`.
- `defIdFromSystemKey`: from `target.systemState[effect.system][key]`.

### Amount lookup (`resolveAmount`)
- `amount`, else `delta`.
- `amountVar` from `context.vars`.
- `amountFromKey` from current system state.
- `amountFromDefKey` from resolved def.
- `amountScale` multiplier (default `1`).

### Target defaults
- Many system ops default to `context.source` when `effect.target` is omitted.
- Tag/event/prop ops require explicit `effect.target`.
- Owner-targeting ops (`ConsumeItem`, `TransferUnits`, `SpawnItem`, `SpawnFromDropTable`) use owner target specs (see Targeting Dictionary).

## Inventory Ops

### `moveItem`
- Context: `inventoryMove`.
- Required: `fromOwnerId`, `toOwnerId`, `itemId`, `targetGX`, `targetGY`.
- Behavior: move in-grid, cross-owner move, or same-owner stack if dropping onto stack target.
- Notes: cross-owner stacking is rejected.

### `stackItem`
- Context: `inventoryStack`.
- Required: `ownerId`, `sourceItemId`, `targetItemId`.
- Optional: `amount`.

### `splitStack`
- Context: `inventorySplit`.
- Required: `ownerId`, `itemId`, `amount`.
- Optional: `targetGX`, `targetGY` (otherwise first fit search).

## Game Ops

### `AddResource`
- Required: `resource`, `amount`.
- Behavior: `state.resources[resource] += amount`.

### `ConsumeItem`
- Context: `game` or `item`.
- Required: `target` (owner target spec).
- Item resolution: `itemKind` or `kind`, otherwise resolved def id / `def.cropId`.
- Amount: shared amount lookup.
- Optional: `perOwner`, `tierOrder` (`asc` default, `desc`), `outVar`.
- Output: writes consumed total to `context.vars[outVar]` when provided.

### `TransferUnits`
- Context: `game`.
- Required: `system`, `target`.
- Source pool: `context.source.systemState[system][poolKey]`, `poolKey` default `maturedPool`.
- Item resolution and amount: same pattern as `ConsumeItem`.
- Optional: `perOwner`, `tierOrder` (`desc` default).

### `SpawnItem`
- Context: `game` or `item`.
- Required: `target`.
- Item resolution: same pattern as `ConsumeItem`.
- Amount: shared amount lookup.
- Optional: `tier` (default resolved item default tier or `bronze`), `perOwner`.

### `SpawnFromDropTable`
- Context: `game`.
- Required runtime: `state.rngNextFloat`.
- Optional: `tableKey` (default `forageDrops`), `target`, `tier`, `debug`.
- Table resolution: by tile def (`context.source.defId`) using `forageDropTables[tableKey]`.
- Miss behavior: weighted null entries and failed `chance` rolls are considered resolved misses (op returns `true`).
- Item spawn target fallback:
  - explicit `effect.target`, else
  - `{ ownerId: context.pawnId ?? context.ownerId }`, else
  - `{ kind: "tileOccupants" }`.

## Item Ops

### `TransformItem`
- Context: `item`.
- Required: `targetKind`.
- Behavior: re-initializes tags/system state from target item def.

### `RemoveItem`
- Context: `item`.

### `ExpireItemChance`
- Context: `item`.
- Chance: `chance` or `chanceFromDefKey`.
- Optional tier scaling: `tierSystemId` with `tierMultiplierByTier` or `multiplierByTier`.
- Optional output transform: `targetKind`.
- Behavior: binomial expiry over stack quantity; deterministic via state RNG.

## System Ops

### `AddToSystemState`
- Required: `system`, `key`.
- Amount: shared amount lookup.
- Target: explicit `target` or default `context.source`.

### `ClampSystemState`
- Required: `system`, `key`.
- Bounds: `min` / `max` or `minKey` / `maxKey`.
- Target: explicit `target` or default `context.source`.

### `AccumulateRatio`
- Required: `system`, `numeratorKey`, `denominatorKey`.
- Optional: `targetKey` (default `sumRatio`), `min`, `max`.
- Target: explicit `target` or default `context.source`.

### `ResetSystemState`
- Required: `system`.
- Behavior: resets to `stateDefaults` from env/pawn/hub/item system defs.
- Target: explicit `target` or default `context.source`.

### `AdjustSystemState`
- Required: `system`, `key`.
- Flat amount: shared amount lookup.
- Percent sources: `percent`, `percentFromKey`, `percentFromDefKey`, `percentVar`.
- Optional clamp: `min` / `max` or `minKey` / `maxKey`.
- Formula: `next = clamp(current + delta + current * percent)`.
- Target: explicit `target` or default `context.source`.

### `ExpireStoredPerishables`
- Target: explicit `target` or default `context.source`.
- Required: `chance > 0`.
- Intended target type: hub structures with a `deposit` config and pool.
- Optional:
  - `perishableTag` (default `perishable`)
  - `rotPoolKey` (default `rotByKindTier`)
  - `rotKind` (default `rot`)
  - `preserveTierBonusProp` (default `perishabilityTierBonus`)
  - `preserveTag`
  - `tierMultiplierByTier` or `multiplierByTier`
  - `itemKind` / `itemId` for tier-bucket pools

### `CreateWorkProcess`
- Required: `system`.
- Target: explicit `target` or default `context.source`.
- Queue: `queueKey` default `processes`.
- Type: `processType` (or `type`, default `process`), optional `uniqueType`.
- Duration: `durationSec` or `durationFromDefKey` (required after resolution).
- Mode: `time` (default) or `work`.
- Amount: if def-resolved, shared amount lookup into `inputAmount`; otherwise `inputAmount` fallback.
- Completion: `completionPolicy` (`cropGrowth`, `build`, `none`), default inferred by type.
- Optional process fields: `poolKey`, `requirements`, `processMeta`, `outputs`.
- Optional captured value: `captureSystem`, `captureKey`, `captureAs`.

### `AdvanceWorkProcess`
- Required: `system`.
- Target: explicit `target` or default `context.source`.
- Optional filters: `queueKey` (default `processes`), `processType`.
- Optional time/work advance:
  - `deltaSec` for base increment (default `1`)
  - `workersFrom: "envCol" | "hubAnchor" | <other>`
  - `amount` when mode is `work` and `workersFrom` is not used
  - `workerCost` for hub worker spend on progress ticks
- Optional `poolKey` (default `maturedPool`) for crop-growth completion.

## Skill Ops

### `AddModifier`
- Required: `key`, and numeric `amount` (or `delta`).
- Scope: `scope: "global" | "pawn"` (`global` is runtime fallback).
- Pawn target resolution for `scope: "pawn"`:
  - `effect.pawnId`, else
  - `effect.target.ref === "pawn"` using `context.pawn.id`, `context.pawnId`, or `context.ownerId`, else
  - `context.pawn.id`, else `context.pawnId`.
- Behavior: delegates to `addGlobalSkillModifier` / `addPawnSkillModifier`.

### `MulModifier`
- Required: `key`, and numeric multiplier from `factor` (or `multiplier`, or `amount`).
- Scope and pawn resolution: same as `AddModifier`.
- Behavior: delegates to `multiplyGlobalSkillModifier` / `multiplyPawnSkillModifier`.

### `GrantUnlock`
- Required: `unlockType: "recipe" | "hubStructure" | "tag" | "feature"`.
- Unlock id resolution:
  - `unlockId` (all types), else
  - `recipeId` / `hubStructureId` / `tagId` / `featureId` by type, else
  - `envTagId` / `hubTagId` / `itemTagId` for tag-domain aliases, else
  - `defId`.
- Behavior: grants unlock in `state.skillRuntime.unlocks`.

### `RevokeUnlock`
- Required: `unlockType: "recipe" | "hubStructure" | "tag" | "feature"`.
- Unlock id resolution: same as `GrantUnlock`.
- Behavior: revokes unlock in `state.skillRuntime.unlocks`.

## Tag / Event / Prop Ops

### `AddTag`
- Required: `tag`, `target`.
- Notes: initializes systems from `envTagDefs` + `envSystemDefs` only.

### `RemoveTag`
- Required: `tag`, `target`.

### `DisableTag` / `EnableTag`
- Required: `tag`, `target`.
- Notes: toggles `target.tagStates[tag].disabled`; does not remove from `target.tags`.

### `SetSystemTier`
- Required: `system`, `target`, and `tier` (or string `value`).
- Notes: system must exist in `envSystemDefs` tier map.

### `UpgradeSystemTier`
- Required: `system`, `delta`, `target`.
- Notes: system must exist in `envSystemDefs`.

### `SetSystemState`
- Required: `system`, `target`, and `value` (or `state`).
- Optional: `merge: true` for shallow object merge.

### `ClearSystemState`
- Required: `target`.
- Optional: `systems` list; omitted means clear all system state on each target.

### `RemoveEvent`
- Required: `target`.
- Notes: removes event anchors from `board.layers.event.anchors` and marks board dirty.

### `TransformEvent`
- Required: `defId`, `target`.
- Notes: resets event lifetime (`createdSec`, `expiresSec`) and clears `entered`.

### `SetProp`
- Required: `prop`, numeric `value`, `target`.
- Optional clamp: `min`, `max`.

### `AddProp`
- Required: `prop`, numeric `amount`, `target`.
- Optional clamp: `min`, `max`.
