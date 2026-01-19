
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

## Prompt — Stage 2: State model + instances + migrations (tile/event layers)

You are a Codex refactor agent. This stage introduces **new state structures and instance constructors** for env tiles/events, but **does not change gameplay rules** yet.

### Objective

Add new instance shapes to the authoritative state to support:

* 12 env tile instances (persistent)
* 12 env event instances (transient layer)
* absolute-time lifecycle fields for events
* ordered tags + system tiers on tiles

### Scope rules (hard)

* No UI changes.
* No new gameplay execution (no resolver yet).
* Keep all state JSON-serializable.
* Do not break timeline replay, serialization, determinism suite.

### Implement

1. **State shape additions**

* In `createEmptyState` add:

  * `envTileSlots` (length 12) OR reuse `envSlots` by introducing `{ tile, event }` shape—pick one and keep consistent.
  * `envEventSlots` (length 12) if separate.
  * `nextEnvTileInstanceId`, `nextEnvEventInstanceId` (or reuse existing counters but keep clarity).
* Add defaults/migrations in `deserializeGameState` for new fields.

2. **Instance constructors**
   Add in `src/model/state.js` (or appropriate model file):

* `makeEnvTileInstance(defId, state, col, span=1)`

  * initializes `tags` from `EnvTileDef.baseTags` (ordered unique)
  * initializes `systemTiers` empty
* `makeEnvEventInstance(defId, state, col, span, tSec)`

  * sets `createdSec=tSec`
  * if def has `durationSec` set `expiresSec=tSec+durationSec`

3. **World init**
   Wherever initial env slots are set up (init code path in model), populate 12 tiles using the new defs:

* Use deterministic RNG from `state.rng` to choose tile defs if needed, or use a fixed starter set.
* Do NOT implement season decks yet.

### File touch list

Likely:

* `src/model/state.js`
* Any init/bootstrap file that populates env slots (if present)
* Possibly `src/model/canonicalize.js` if you need derived rebuild, but prefer minimal.

### Exit checks

* Load a new game: state contains 12 tiles with tags.
* Serialize → deserialize → rebuildStateAtSecond still works.
* Run determinism suite if available (`window.__DBG__.test()` manual OK).

Return: files changed + notes on migrations and why replay remains safe.

---

## Prompt — Stage 3: Execution manager + commands + effect ops (core loop)

You are a Codex refactor agent. This stage introduces the **new deterministic gameplay loop** for tile intents and event lifecycle. No UI changes yet.

### Objective

Implement:

* Pawn-gated tile intent selection/execution (one intent per tile per second)
* Env event enter/tick/exit and expiry using absolute-time fields
* Command: `CmdSetTileTagOrder`
* Effect ops: `AddTag`, `RemoveTag`, `SetSystemTier`, `UpgradeSystemTier`, `RemoveEvent`, `TransformEvent`
* “Add tag enables systems initializes default tier” rule

### Scope rules (hard)

* No UI work.
* Do not add countdown timers; expiry must be `tSec >= expiresSec`.
* Do not put gating in effects. Gating belongs in resolver/manager.
* Preserve determinism and replay: all randomness via `state.rng`.

### Implement details

1. **New ActionKinds + dispatch**
   Add action kind to `src/model/actions.js`:

* `SET_TILE_TAG_ORDER` (or similar)
* optional: `DEBUG_SET_PAWN_ON_TILE` only if you need a minimal pawn presence to test without UI; prefer using existing pawn/character placement if already exists.

2. **Command implementation**
   Add command in `src/model/commands.js`:

* `cmdSetTileTagOrder(state, { tileCol, tagIds })`

  * validate: same set as existing tags, unique, no unknowns
  * set `tile.tags = tagIds`

3. **Effect ops implementation**
   Extend `src/model/effects.js` to support the new ops targeting by `TargetSpec`:

* Implement target resolution:

  * `{ ref:"self", layer }` resolves to the source piece (tile/event/permanent) across its span (de-dupe by instanceId)
  * `{ at:{layer,col} }` targets piece(s) in that layer at that col
* Add ops:

  * `AddTag` / `RemoveTag` -> mutate `EnvTileInstance.tags` (ordered unique; AddTag appends)

    * On AddTag: if tag enables systems, initialize missing system tiers to defaultTier
  * `SetSystemTier` / `UpgradeSystemTier` -> mutate `systemTiers`
  * `RemoveEvent` -> remove event instance from event layer
  * `TransformEvent` -> replace event instance with new defId, preserve col/span, set createdSec/expiresSec freshly

4. **Managers (model layer)**
   Create `src/model/env-exec.js` (or similar) containing:

* `stepEnvSecond(state, tSec)` called exactly once per second boundary while unpaused:

  * **Event lifecycle**

    * On enter: when an event instance is created, ensure `onEnter` executed exactly once (use a boolean marker on instance like `entered=true` is allowed; must be serializable)
    * On tick: if `onTick`, execute once per second while active
    * On exit: when expired or season change (later), execute `onExit` then remove
  * **Tile intent execution**

    * For each tile col:

      * if no pawn present on tile → skip entirely
      * else evaluate tags top→bottom:

        * for each tag: evaluate its intents (in declared order), pick first eligible intent
        * execute its effect and stop for that tile for that second
* Pawn presence: use the simplest existing representation available (character placement or a tile occupancy map). If none exists yet, add a minimal `tilePawnsByCol` state array (serializable) + debug action to set it, strictly for Stage 3 testing.

5. **Hook into simulation**
   Call `stepEnvSecond` from the authoritative tick path only when `tSec` increments (i.e., once per second), not every microstep.

* The correct hook point is wherever `state.tSec` advances (currently in `cmdTickSimulation` when newTSec > prevTSec). Add a call there.

### File touch list

* `src/model/actions.js`
* `src/model/commands.js`
* `src/model/effects.js`
* `src/model/commands.js` (hook)
* New file: `src/model/env-exec.js` (or similar)
* Possibly `src/model/state.js` if you add minimal pawn presence state

### Exit checks

* Determinism: run determinism suite.
* Replay: scrub back/forward; tile resource changes reproduce exactly.
* Event expiry: spawn an event with duration, verify it exits at correct second and replays identically.

Return: files changed + brief notes on key invariants.

---

## Prompt — Stage 4: Season decks + cadence draw (replace legacy env deck/discard paths)

You are a Codex refactor agent. This stage replaces the **legacy season env deck/discard** with the new **tile-driven season deck + cadence draw** model.

### Objective

Implement:

* One season deck per season
* Generated once at season start from env tile `seasonTables`
* Drawn every fixed cadence (5 seconds default)
* Stops when exhausted
* Deleted at season end
* No discard pile

### Scope rules (hard)

* No UI changes (HUD can remain stale for now).
* Preserve determinism: deck generation must use `state.rng`.
* Season deck generation must be stable under replay.

### Implement details

1. **State**
   Add:

* `state.seasonDecks` (map seasonKey -> deck object) OR `state.currentSeasonDeck` (simpler)
  Deck object:

```js
{ seasonKey, entries: string[], drawIndex: number }
```

2. **Deck generation**
   On season start (in `cmdAdvanceSeason` or immediately after season change is applied):

* Build entries by iterating tiles:

  * for each tile, sample from its `seasonTables[seasonKey]` weighted table using `state.rng`
  * push selected `defId` into `entries`
* Initialize `drawIndex=0`

3. **Cadence draws**
   In the per-second env execution hook (from Stage 3), add:

* if `tSec % CADENCE_SEC === 0`:

  * draw next entry if available
  * spawn event instance into the event layer at the same col as its source tile (or another deterministic placement rule)
* If an event slot is occupied, decide a deterministic policy (skip, replace, queue). Choose **skip** as simplest unless Goals specify otherwise.

4. **Remove/deprecate legacy**
   Stop using:

* `state.envSeasons[season].discard`
* `drawEnvDefId`, `refillEnvSlots`, `cmdRefillEnvSlot` for env cards
  You may keep functions temporarily but ensure they are no longer called by the main loop.

### File touch list

* `src/model/state.js` (remove legacy initialization usage, add new deck state)
* `src/model/commands.js` (season start hook)
* `src/model/env-exec.js` (cadence draw)
* Any old env-deck helpers referenced; ensure unused.

### Exit checks

* New season start generates a new deck deterministically.
* Every 5 seconds, events appear (or are attempted) deterministically.
* Scrubbing back/forward reproduces identical deck draws and spawns.

Return: files changed + note on placement/occupied-slot policy.

---

## Prompt — Stage 5: UI + interaction migration (12-col unified board)

You are a Codex refactor agent. This stage updates Pixi UI to present the new 4-zone board and enable basic interaction (tag reorder + pawn placement).

### Objective

Implement UI to support:

* 12-col aligned layout for:

  * env tiles row
  * env events row
  * permanents row
* Render ordered tags on tiles
* Allow drag-reorder of tags on a tile (dispatch action from Stage 3)
* Ensure pawn placement produces “pawn present” for tile execution (using existing character system if applicable)

### Scope rules (hard)

* No gameplay logic in views.
* Views dispatch actions; model remains authoritative.
* Keep changes localized to board views and interaction controller.

### Implement details

1. **Layout**
   Update `layout-pixi.js` or board view positioning so there are distinct y-bands:

* tiles row (top gameplay row)
* events row (below tiles)
* permanents row (bottom gameplay row)

2. **Rendering**
   Update `src/views/board-pixi.js` to render:

* tiles: name + vertical tag list (top->bottom)
* events: event card with name + remaining time (derive remaining as `expiresSec - tSec` in view only; do not store)
* Ensure rebuild/update uses state from runner

3. **Interaction**

* Implement tag reorder drag/drop within a tile:

  * On drop, compute new ordered tag list
  * Dispatch `SET_TILE_TAG_ORDER` action with `{ tileCol, tagIds }`
* Pawn presence:

  * If using characters as pawns: add ability to place/move a pawn onto an env tile col (simple snap-to-col).
  * If Stage 3 introduced a debug pawn presence action/state, wire UI to it minimally (click tile toggles pawn present) ONLY if character approach is not feasible yet.

4. **Cleanup**

* Remove/disable legacy env card visuals if they conflict with new event row.

### File touch list

* `src/views/board-pixi.js`
* `src/views/layout-pixi.js` (if needed)
* `src/views/interaction-controler-pixi.js` (if needed)
* Possibly `src/views/ui-root-pixi.js` for wiring new handlers
* Do not touch model except to call existing actions.

### Exit checks

* Visual: tiles, events, permanents appear in three aligned rows.
* Interaction: reorder tags changes execution priority (observable via resource changes over time).
* Scrubbing shows consistent past/future state.
* No nondeterministic UI-driven state mutations.

Return: files changed + how to manually smoke test.

---