# Targeting Dictionary

Reference for effect `target` specs used by effect ops.

## Board Targets (`resolveBoardTargets`)
Used by system ops, tag ops, event ops, and prop ops.

### Supported layers
- `tile`
- `event`
- `hub`

### Common shapes
- `{ all: true, layer: "tile" }`
- `{ at: { layer: "tile", col: 3 } }`
- `{ ref: "self" }`
- `{ ref: "self", layer: "tile" }`
- `{ ref: "pawn" }`
- `{ ref: { kind: "tileWhere", where: { ... } }, layer: "tile" }`
- `{ ref: "self", layer: "tile", area: { kind: "adjacent", radius: 1 } }`
- `{ layer: "hub", where: { hasTag: "distributor" } }`

### Selection behavior

#### `all`
- `{ all: true, layer }`
- `tile` / `event`: scans occupancy array, dedupes by anchor/instance.
- `hub`: uses `state.hub.anchors` when present, otherwise structures from `state.hub.slots`.

#### `at`
- `{ at: { layer, col } }`
- Returns the single target occupying that column (if any).

#### `ref`
- `ref: "self"`
  - If no `layer` and no `at`/`area`: returns `[context.source]`.
  - With `layer`: uses `context.source.col` and `context.source.span` to resolve columns.
- `ref: "pawn"`
  - Resolves from `context.pawn`, else `context.pawnId`, else `context.ownerId`.
- `ref: { kind: "tileWhere", where }`
  - Builds reference columns from tiles matching `where`.

#### `area`
- Supported shape: `{ kind: "adjacent", radius }`.
- Applies to resolved ref columns and expands by `-radius..+radius`, clamped to board.

#### `where`
`where` filters the selected targets by `defId`, `tags`, and system-state numeric checks.

- `tileId: string | string[]`
- `hasTag: string | string[]`
- `hasAllTags: string[]`
- `hasAnyTags: string[]`
- `notTag: string`
- `excludeTags: string[]`
- `systemAtLeast: { system, key, gte } | Array<...>`
- `systemAtMost: { system, key, lte } | Array<...>`
- `systemBetween: { system, key, min, max } | Array<...>`

### Determinism
- Column scans are ascending.
- Dedupe is stable by first encounter (instance id/object identity).
- Ref/area column expansion is deterministic.

## Owner Targets (`resolveOwnerTargets`)
Used by `ConsumeItem`, `TransferUnits`, `SpawnItem`, `SpawnFromDropTable`.

### Supported shapes
- `{ ref: "selfInv" }`
  - In `context.kind === "item"`: uses `context.ownerId`.
  - Otherwise: uses `context.source.instanceId`.
- `{ kind: "tileOccupants" }`
  - If `context.pawn` exists: returns `[context.pawn]`.
  - Else if `context.pawnId` or `context.ownerId` resolves to a character: returns that pawn only.
  - Else resolves env column in this order:
    - `target.envCol`
    - `context.envCol`
    - `context.source.col`
  - Returns characters on that env col in `state.characters` order.
- `{ ownerId: ... }`
- `{ ownerIds: [...] }`

### Return type notes
- Resolver may return pawn objects or raw owner ids depending on spec.
- Game ops normalize each target by using `target.id` when object, otherwise raw id.

## Skill Tree Targeting Scope (Outside Effect Target Resolvers)
- Skill tree node effects do not use `target` specs or `resolveBoardTargets` / `resolveOwnerTargets`.
- Targeting is implied by effect bucket:
  - `effects.characterMods`: applies only to the character that unlocked the node.
  - `effects.globalMods`: aggregates across all characters and applies globally.
  - `effects.unlocks.recipes` / `effects.unlocks.hubStructures`: global unlock gates for recipe and build availability.
  - `effects.unlocks.features`: global feature flags (for example UI feature visibility gates).
- Aggregation is deterministic (character and node id ordering is normalized in `src/model/skills.js`).
