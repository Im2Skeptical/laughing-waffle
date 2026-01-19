
---

## Prompt — Stage 1: Defs scaffolding (no/low-op content)

You are a Codex refactor agent working in a deterministic, replayable JS game. Follow the attached architecture rules (determinism, serialization, no UI logic in model). This stage is **defs-only**.

### Objective

Create initial defs that conform to **Gamepiece Def Schema.md**:

* EnvTagDef registry (tags as verbs with intents)
* EnvSystemDef registry (tiers live here)
* EnvTileDef registry (persistent terrain, tier-ignorant)
* EnvEventDef registry (transient events/animals, absolute-time expiry)

These are mostly **no-op/debug** pieces to validate schema and distribution.

### Scope rules (hard)

* Do NOT change model logic, state shape, timeline, simulation runner, projection, or UI.
* Only touch `src/defs/*` and any defs index file needed to export them.
* All defs must be pure JSON-serializable objects. No functions.

### Required content (minimum)

* 5–8 tags: `farmable`, `fishable`, `forageable`, `grazable`, `mineable`, etc
  * Each tag: 1–2 intents with minimal `requires` + small `AddResource` effects.

* 6–10 systems: `fertility`, `hydration`, `fishDensity`, `turfDensity`, `growth`, `mineralRarity`, etc.
  * Each has `defaultTier:"bronze"` and a numeric `tierMap`.

* 8–12 tiles: `tile_floodplains`, `tile_wetlands`, `tile_levee`, `tile_dunes`, `tile_hinterland`, etc.
  * Each has ordered `baseTags`
  * Each has `seasonTables` for all seasons, with a few entries and weights.

* 12–20 events:
  * class `"effect"` and a few `"animal"`
  * some with `durationSec` (5–10), some without
  * keep effects trivial (mostly no-op or small AddResource)
  * include at least one event that uses `AddTag` on enter and `RemoveTag` on exit (per schema)
### File touch list

Create or update:

* `src/defs/env-tags-defs.js`
* `src/defs/env-systems-defs.js`
* `src/defs/env-tiles-defs.js`
* `src/defs/env-events-defs.js`
* Update any central export barrel if one exists (e.g. `src/defs/index.js`), but keep minimal.

### Exit checks

* `npm test` if present OR run the game build to ensure imports resolve.
* Ensure there are no runtime import errors from defs.
* Ensure all IDs are unique and stable strings.

Return: list of files changed + brief summary of what was added.

---

## Prompt — Stage 2

You are a Codex refactor agent. This stage introduces **new board state structures and instance constructors** for env tiles/events. No gameplay execution yet.

### Objective

Implement an authoritative board model:

* `state.board.layers.{tile,event,permanent}.anchors[]` are canonical
* `state.board.occ.{tile,event,permanent}[col]` are **derived** and rebuilt deterministically
* Env tiles are persistent; env events are transient with absolute-time expiry

### Scope rules (hard)

* No UI changes.
* No resolver/execution logic yet.
* Keep all state JSON-serializable.
* Do not break timeline replay, serialization, or determinism suite.

### Implement (required)

#### 1) Add canonical board state (authoritative anchors)

In `createEmptyState` add:

```js
state.board = {
  cols: 12,
  layers: {
    tile: { anchors: [] },
    event: { anchors: [] },
    permanent: { anchors: [] }, // can mirror existing permanent slots later
  },
  occ: {
    tile: new Array(12).fill(null),
    event: new Array(12).fill(null),
    permanent: new Array(12).fill(null),
  },
};
```

Rules:

* `layers.*.anchors` are the only authoritative placement storage.
* `occ.*` arrays are derived (may be overwritten on canonicalize).

#### 2) Instance constructors (model-only)

Add:

* `makeEnvTileInstance(defId, state, col, span=1)`

  * init tags from `EnvTileDef.baseTags` (ordered unique)
  * init `systemTiers = {}`
  * store `{ instanceId, defId, col, span, tags, systemTiers }`
* `makeEnvEventInstance(defId, state, col, span, tSec)`

  * store `{ instanceId, defId, col, span, createdSec, expiresSec? }`
  * if def has `durationSec`, set `expiresSec = tSec + durationSec`

#### 3) Deterministic derived occupancy rebuild

Add a canonical rebuild function (where your project’s derived rebuild belongs—prefer `canonicalizeSnapshot` or a dedicated helper called by it):

* `rebuildBoardOccupancy(state)`:

  * reset `board.occ.*` arrays to all null
  * for each layer, for each anchor:

    * for each occupied col in `[col .. col+span-1]`:

      * set `board.occ[layer][occupiedCol] = anchor`
  * if collisions occur:

    * choose a deterministic policy:

      * simplest: “later anchors overwrite earlier” or “first wins”
    * log a warning only (do not crash)

This rebuild must be called:

* on `deserializeGameState`
* on snapshot canonicalization / rebuild (whatever path already exists)

Strip `state.board.occ` in serializeGameState to keep saves stable and avoid “stale derived data” bugs.

#### 4) World init: populate 12 tiles in anchors

On new game init (wherever env slots were set up previously):

* populate `board.layers.tile.anchors` with 12 tile instances (span=1), cols 0..11
* do not create events yet
* call `rebuildBoardOccupancy(state)` once after init

#### 5) Save/load migrations

In `deserializeGameState`:

* if `state.board` missing, create it (as above)
* if `occ` missing, create it
* ensure `layers.*.anchors` exist as arrays

After defaults, call `rebuildBoardOccupancy(state)`.

### File touch list

Likely:

* `src/model/state.js`
* `src/model/canonicalize.js` (or wherever snapshot canonicalization lives)
* Any init/bootstrap file

### Exit checks

* New game state has `state.board.layers.tile.anchors.length === 12`.
* `state.board.occ.tile[col]` is non-null for cols 0..11.
* Serialize → deserialize → rebuildStateAtSecond still works.
* Determinism suite passes.

Return: files changed + brief notes on derived rebuild placement.

---

## Prompt — Stage 3: Resolver/managers use `board.occ` (O(1)) + new ops

You are a Codex refactor agent. This stage adds the new deterministic gameplay loop for tile intents and event lifecycle. Use **Option B2** board.

### Objective

Implement:

* Pawn-gated tile intent selection/execution (≤1 per tile per second)
* Env event enter/tick/exit and expiry (`tSec >= expiresSec`)
* Command/action for tag reorder
* Effect ops listed in schema
* “Add tag enables systems initializes default tier”
* All hot-path queries use `state.board.occ.*` (not scans)

### Scope rules (hard)

* No UI work.
* Do not add countdown timers.
* Do not put gating inside effects.
* Preserve determinism/replay: randomness only via `state.rng`.

### Implement details

#### 1) Action + command: set tag order

Add ActionKind and command:

* `SET_TILE_TAG_ORDER` → `cmdSetTileTagOrder(state, { tileCol, tagIds })`
* Find tile via `state.board.occ.tile[tileCol]`
* Validate set equality and uniqueness; then assign `tile.tags = tagIds`

#### 2) Effect ops + TargetSpec resolution (board-based)

Extend `effects.js` with TargetSpec resolution:

* For `{ at:{layer,col} }`:

  * resolve using `state.board.occ[layer][col]`
* For `{ ref:"self", layer }`:

  * resolve relative to the **source instance** that emitted the effect
  * must handle span by applying across occupied columns, but **de-dupe by instanceId**
  * Implementation approach:

    * compute occupied cols from `source.col/source.span`
    * for each occupied col resolve `board.occ[layer][col]`
    * de-dupe instances by `instanceId`

Ops:

* `AddTag`/`RemoveTag` mutate tile.tags (ordered unique; AddTag appends)

  * On AddTag: if tag enables systems and missing in `systemTiers`, set default tier
* `SetSystemTier`/`UpgradeSystemTier` mutate `systemTiers`
* `RemoveEvent` remove the targeted event anchor from `board.layers.event.anchors`
* `TransformEvent` replace event anchor defId; reset created/expires based on current `tSec`

After any op that changes placement/removal:

* call `rebuildBoardOccupancy(state)` once (or mark dirty + rebuild at end of second). Prefer “mark dirty and rebuild once” to avoid repeated rebuilds inside multi-op arrays.

#### 3) Env execution managers (per-second)

Create `src/model/env-exec.js` (or similar):

`stepEnvSecond(state, tSec)` called once per second boundary while unpaused.

* Event manager:

  * iterate over `board.layers.event.anchors` (anchors, not occ) to avoid duplicates
  * ensure `onEnter` runs exactly once (serializable `entered` flag is allowed)
  * run `onTick` once per second if present
  * if expired (`expiresSec != null && tSec >= expiresSec`) or `expiresOnSeasonChange` (hook later):

    * run `onExit`
    * remove event anchor
* Tile intent resolver:

  * for col 0..11:

    * tile = `board.occ.tile[col]` (span=1 for now)
    * if no tile continue
    * if no pawn present on that tile → continue (skip intent evaluation)
    * else evaluate tags top→bottom, select first eligible intent, execute effect

* All runEffect calls that use TargetSpec must pass context.source.

* Effects must not scan anchors to find targets; only use board.occ + dedupe-by-instanceId logic for span.

* Board occupancy rebuild must be batched: set state._boardDirty=true and rebuild once at end of stepEnvSecond (or once per second boundary), never per effect op.

Pawn presence:

* Use existing character/pawn model if already available.
* If none exists, add `state.tilePawnsByCol = boolean[12]` (serializable) + a debug action to toggle for Stage 3 only.

#### 4) Hook into simulation at second boundaries

In the authoritative tick path where `tSec` increments:

* call `stepEnvSecond(state, state.tSec)` exactly once per new second

### File touch list

* `src/model/actions.js`
* `src/model/commands.js`
* `src/model/effects.js`
* `src/model/env-exec.js` (new)
* `src/model/game-model.js` or wherever `cmdTickSimulation` lives (hook)
* Possibly `src/model/state.js` (pawn presence fallback)

### Exit checks

* Determinism suite passes.
* Scrub replay reproduces tile/resource changes exactly.
* Event expiry and onExit are stable under replay.
* `rebuildBoardOccupancy` is not called per microstep.

Return: files changed + notes on dirty-rebuild strategy.

---

## Prompt — Stage 4: Season decks + cadence draws spawn into `board.layers.event.anchors`

You are a Codex refactor agent. Replace legacy env deck/discard paths with tile-driven season decks + cadence draws. Use Option B2 board model.

### Objective

* Season deck generated once at season start from tiles’ `seasonTables`
* Draw events every 5 seconds (tSec-based)
* Spawn events into `board.layers.event.anchors`
* No discard pile; delete deck at season end
* Deck generation consumes RNG in a stable order: col 0→11 (or anchor order sorted by col), and within each tile, a deterministic weighted-roll method.

### Scope rules (hard)

* No UI changes.
* Deterministic RNG only.

### Implement

1. Add `state.seasonDecks` or `state.currentSeasonDeck` (pick one).
2. On season start, build deck entries by iterating tile anchors (or cols 0..11 via `occ.tile[col]`).
3. In `stepEnvSecond`, on cadence boundary:

   * draw next entry
   * spawn event at same col as the source tile (span from def defaultSpan or 1)
   * push into `board.layers.event.anchors`
   * call `rebuildBoardOccupancy(state)` once after spawn
4. Remove/deprecate legacy env deck/discard calls so they are not in the main loop.

Occupied slot policy:

* If spawning would collide in `board.occ.event[col]`, default to **skip** the spawn (do not consume deck entry OR do consume—choose one and document; prefer **consume** to keep deck deterministic and bounded).

### File touch list

* `src/model/state.js` (remove legacy env deck usage, add new deck state)
* `src/model/commands.js` (season transition hook)
* `src/model/env-exec.js` (cadence draw + spawn)
* Any legacy env-deck helper file still referenced

### Exit checks

* Deck generation is deterministic and replay-stable.
* Events spawn on cadence boundaries and replay identically.
* No discard pile state required.

Return: files changed + documented collision/consumption policy.

---

## Prompt — Stage 5: UI reads from `state.board.occ` and supports reorder/placement

You are a Codex refactor agent. Update Pixi UI to render the new three gameplay rows (tiles/events/permanents) aligned to 12 columns. Use Option B2 board as the source of truth.

### Objective

* Render tiles from `state.board.occ.tile[col]`
* Render events from `state.board.occ.event[col]` (or anchors for multi-span visuals)
* Render permanents from `state.board.occ.permanent[col]` (initially may mirror existing slots)
* Allow tag reorder interaction dispatching the Stage 3 action
* Provide a way to set pawn presence on a tile using existing characters
* delete `state.tilePawnsByCol` if used

### Scope rules (hard)

* No gameplay logic in views.
* No direct state mutation in UI.
* Views may compute derived display values (like remaining seconds) but must not store them.

### Implementation notes

* For multi-span event visuals, it’s acceptable in Stage 5 to render only at anchor col (or render across cols) but you must de-dupe.
* Remaining time display:

  * if `expiresSec` exists: `expiresSec - state.tSec`, clamp ≥ 0

### File touch list

* `src/views/board-pixi.js`
* `src/views/layout-pixi.js` (if needed)
* `src/views/interaction-controler-pixi.js` (if needed)
* `src/views/ui-root-pixi.js` wiring if necessary

### Exit checks

* Tiles/events/perms render in distinct rows, aligned.
* Reordering tags changes execution priority (observable).
* Scrubbing shows consistent historical states.

Return: files changed + smoke test steps.

---