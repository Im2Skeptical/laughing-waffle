# Trigger Dictionary

Reference for where effects can be attached and when they run.

## Per-Second Execution Order
`cmdTickSimulation` runs these in this exact order when a second advances:
1. `processSecondChangeForItems(state)` (item-tag passives)
2. `stepPawnSecond(state, tSec)` (equipped-item passives, pawn passives, pawn intents)
3. `stepEnvSecond(state, tSec)` (env events, env tag passives/intents, deck draws)
4. `stepHubSecond(state, tSec)` (hub tag passives/intents)

`state._seasonChanged` is true during that tick if a season advanced, then reset to false after these steps.

## Timing Object
Used by passives in multiple systems.

- `timing.cadenceSec`: run when `tSec % cadenceSec === 0` (`cadenceSec >= 1`).
- `timing.onSeasonChange: true`: run on ticks where `state._seasonChanged === true`.
- If both are present, runtime check is OR (`cadence` or `season change`).

## Env Events (`env-events-defs.js`)

### `onEnter`
- Runs once per event anchor when first processed.

### `onTick`
- Runs every second while anchor exists.

### `onExit`
- Runs when anchor is removed or expires.
- Expiry/removal paths include:
  - `durationSec` elapsed
  - `expiresOnSeasonChange`
  - spawn collision removal with `collision.mode: "destroyExisting"` and `runExit !== false`

## Env Tags (`env-tags-defs.js`)

### `passives`
- Run per tile each second (independent of pawn presence), subject to `timing` and `requires`.

### `intents`
- Run only when a pawn is on the tile.
- For each pawn, only the first eligible/payable intent executes each second.
- Deterministic order:
  - tiles by ascending column
  - pawns by `state.characters` order
  - tags in tile tag order
  - intents in def order

### `requires` keys (env)
- `season: string[]`
- `hasPawn: boolean`
- `hasSelectedCrop: boolean`
- `selectedCropIdIn: string[]`
- `hasMaturedPool: boolean`
- `hasTag: string | string[]`
- `hasEquipment`: currently always fails (reserved)

## Hub Tags (`hub-tag-defs.js`)

### `passives`
- Run per hub structure each second, subject to `timing` and `requires`.

### `intents`
- Run only when pawns occupy the structure span.
- For each pawn, only first eligible/payable intent executes each second.
- Deterministic order:
  - structures by `state.hub.anchors` order (slot order)
  - pawns by `state.characters` order
  - tags in structure tag order
  - intents in def order

### `requires` keys (hub)
- Supports env keys plus process/recipe keys:
  - `processSystem: string`
  - `processTypeFromSystemKey: string` (default key is `selectedRecipeId`)
  - `hasSelectedRecipe: boolean`
  - `hasSelectedProcessType: boolean`
  - `noSelectedProcessType: boolean`
  - `hasProcessType: string | string[]`
  - `noProcessType: string | string[]`
- `hasEquipment` is also currently treated as false.

## Pawn Defs (`pawn-defs.js`)

### `passives`
- Run per pawn each second, subject to `timing`.

### `intents`
- Run per pawn each second.
- Only first eligible/payable intent executes.

### `requires` keys (pawn intents)
- `hungerAtMost: number`

## Item Triggers

### Item-tag passives (`item-tag-defs.js`)
- Executed by `processSecondChangeForItems -> stepItemSecond`.
- Run per inventory item each second, in deterministic owner/item order.
- Use `timing` object.
- Context kind is `item` with `{ inv, item, ownerId, tSec }`.

### Equipped item passives (`item-defs.js`)
- `itemDefs[kind].passives` run in `stepPawnSecond` for equipped items.
- Processed in slot order:
  - `head`, `chest`, `mainHand`, `offHand`, `ring1`, `ring2`, `amulet`
- Use `timing` object.
- Context kind is `game`; `context.source` is the equipped item, and includes `equippedItem` and `equippedSlotId`.

## Season Deck Event Draws (`env-exec.js`)
- Draw cadence is every 5 seconds (`EVENT_CADENCE_SEC`) when `tSec > 0`.
- Draws one entry from current season deck and applies event `spawn` rules.
- If `spawn.consumePolicy === "onlyIfAnyPlaced"` and no anchor is placed, entry is pushed back to the front of deck.

## Skill Tree Unlock Trigger (Action-Driven)
- Skill unlocks are triggered by timeline action `unlockSkillNode` (`ActionKinds.UNLOCK_SKILL_NODE` -> `cmdUnlockSkillNode`).
- Unlock actions follow normal edit-action gating:
  - must be paused for non-replay execution (`applyAction` paused gate).
  - executed at the action's `tSec` in replay/time-travel.
- Unlock effects are passive after commit:
  - no per-second `timing` trigger object in skill defs.
  - systems query derived skill selectors/mods (`computeCharacterSkillMods`, `computeGlobalSkillMods`, `computeAvailableRecipesAndBuildings`).
- Unlock validation includes:
  - node exists, not already unlocked
  - skill point affordability
  - tree start node or adjacency-to-unlocked rule
  - explicit requirements (`requirements.requiredNodeIds`)

## Command-Driven Effect Execution (`commands.js`)
- Inventory commands run effect ops immediately (not per-second):
  - `cmdMoveItemBetweenOwners` -> `moveItem` (`context.kind = "inventoryMove"`)
  - `cmdStackItemsInOwner` -> `stackItem` (`context.kind = "inventoryStack"`)
  - `cmdSplitStackAndPlace` -> `splitStack` (`context.kind = "inventorySplit"`)
- Build designation creates construction processes immediately:
  - `cmdBuildDesignate` -> `CreateWorkProcess` with `completionPolicy: "build"`.
