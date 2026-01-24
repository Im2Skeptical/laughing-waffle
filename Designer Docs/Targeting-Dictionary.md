# Targeting Dictionary

Reference for effect `target` specs and owner targeting. Use this when authoring env events, tags, and systems that need to point at tiles, events, hub structures, or characters.

## Board Targets (tiles, events, hub structures)
Used by board ops and system ops.

### Common Shapes
- `{ all: true, layer: "tile" }`
- `{ at: { layer: "tile", col: 3 } }`
- `{ ref: "self", layer: "tile" }`
- `{ ref: { kind: "tileWhere", where: {...} }, area: {...}, layer: "tile" }`

### Layers
- `"tile"`: env tiles
- `"event"`: env events
- `"hub"`: hub structures

### `ref` (reference sources)
- `"self"`: uses `context.source` and its `col`/`span`.
  - Span-aware: if the source has `span`, the ref covers all occupied cols.
- `{ kind: "tileWhere", where: {...} }`: uses every tile that matches `where`.

### `area` (spatial expansion)
- `{ kind: "adjacent", radius: N }`
  - Expands `ref` cols by `-N..+N` (clamped to board).
  - Union + dedupe by col.
  - Returned in ascending col order.

### `where` (tile filters)
Applies after `all/at/ref/area` selection. These checks target `target.defId`, `target.tags`, and `target.systemState`, so they are primarily meaningful for tiles.

- `where.tileId: string` (matches `target.defId`)
- `where.hasTag: string`
- `where.hasAllTags: string[]`
- `where.hasAnyTags: string[]`
- `where.notTag: string`
- `where.excludeTags: string[]`
- `where.systemAtLeast: { system, key, gte }`
- `where.systemAtMost: { system, key, lte }`
- `where.systemBetween: { system, key, min, max }`

### Determinism Notes
- Column iteration is ascending.
- Dedupe is by column (for `ref`/`area` expansions).

### Examples
```js
// All farmable tiles
{ all: true, layer: "tile", where: { hasTag: "farmable" } }

// The tile under the current event's span, plus one tile either side
{ ref: "self", layer: "tile", area: { kind: "adjacent", radius: 1 } }

// Any tile with hydration.sumRatio >= 50
{ all: true, layer: "tile", where: { systemAtLeast: { system: "hydration", key: "sumRatio", gte: 50 } } }
```

## Owner Targets (characters)
Used by ops like `ConsumeItem`, `TransferUnits`, `SpawnItem`.

### Shapes
- `{ kind: "tileOccupants" }`
  - Col resolution order: `target.envCol` -> `context.envCol` -> `context.source.col`.
  - Deterministic owner order: lowest `char.id` first.
- `{ ownerId: 101 }`
- `{ ownerIds: [101, 102, 103] }`

### Example
```js
{ kind: "tileOccupants" }
```
