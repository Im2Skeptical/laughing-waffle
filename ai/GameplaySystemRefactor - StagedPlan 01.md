## Staged plan

### Stage 1 — Defs scaffolding (no/low-op content)

**Goal:** Populate defs to the new schema with placeholder/debug pieces so the runtime can reference real IDs early.

**Work:**

* Create new defs registries/files for:

  * `EnvTagDef[]`
  * `EnvSystemDef[]`
  * `EnvTileDef[]`
  * `EnvEventDef[]`
* Add ~5–10 tags (farm/fish/forage/etc) with minimal intents (often no-op or small `AddResource`).
* Add ~5–10 systems with tier maps (bronze→diamond).
* Add ~8–12 tiles with `baseTags` + `seasonTables` (weighted).
* Add ~10–20 events (effect + animal class) with mostly no-op `onEnter/onExit` and a couple simple resource events.
* Keep IDs stable and consistent.

**Exit criteria:**

* Defs load without errors and can be referenced by ID.
* No gameplay integration required yet.

---

### Stage 2 — State model + instances + migrations (tile/event layers)

**Goal:** Introduce the new board-layer state shapes without changing gameplay rules yet.

**Work:**

* Add instance constructors:

  * `makeEnvTileInstance(defId, col, span, state)`
  * `makeEnvEventInstance(defId, col, span, tSec, state)`
* Add state storage:

  * 12 env tile slots (tile layer)
  * 12 env event slots (event layer)
* Implement absolute-time fields on event instances (`createdSec`, `expiresSec`).
* Implement tag/system state on tile instances (`tags`, `systemTiers`).
* Add minimal “world init” / “new game” population of 12 tiles.
* Add deserialize defaults + canonicalization for new fields (non-breaking load).

**Exit criteria:**

* Game boots with 12 env tiles visible in state (even if UI not updated yet).
* Timeline replay/serialize works with new fields present.

---

### Stage 3 — Execution manager + core commands (no UI rework yet)

**Goal:** Make the model capable of running the new rules deterministically:

* pawn-gated tile intent execution
* event lifecycle (enter/tick/exit)
* tag reorder command
* system-tier init on tag add

**Work (model-only):**

* Add command:

  * `CmdSetTileTagOrder { tileCol, tagIds }`
* Add effect ops support (new ops in your schema):

  * `AddTag`, `RemoveTag`
  * `SetSystemTier`, `UpgradeSystemTier`
  * `RemoveEvent`, `TransformEvent`
* Add resolver/manager layer(s):

  * **TileIntentResolver**: per second, per tile

    * if no pawn present → skip entirely
    * else evaluate tags top→bottom, select first eligible intent, execute its effects
  * **EnvEventManager**:

    * detect enter (spawn)
    * per-second tick (optional)
    * detect expiry (`tSec >= expiresSec`) and execute `onExit`
* Hook managers into the simulation path (called from the authoritative tick/update path once per second boundary).

**Exit criteria:**

* With debug pawns placed, tiles produce deterministic, replayable effects.
* Events spawn/expire deterministically and apply enter/exit effects.
* Timeline replay reproduces results exactly.

---

### Stage 4 — Season deck generation + 5-second cadence draws (replace legacy env deck/discard)

**Goal:** Switch seasonal environment flow to the new model:

* deck generated from tiles at season start
* drawn on cadence
* no discard pile
* deck deleted at season end

**Work:**

* Implement per-season deck state (minimal):

  * `seasonDeckByKey[season] = { entries: string[], drawIndex: number }`
* On `cmdAdvanceSeason` (or season start hook):

  * build the deck from `EnvTileDef.seasonTables[season]` (deterministic RNG)
* Implement cadence draw:

  * every N seconds (e.g. 5), draw next event and spawn into event layer (col-aligned)
* Remove/deprecate:

  * `envSeasons[season].discard`
  * discard-driven reshuffle/refill logic
  * `refillEnvSlots` behavior tied to env cards

**Exit criteria:**

* Events are produced only via season decks + cadence.
* No discard pile is required for correct operation.
* Graphs/replay still stable.

---

### Stage 5 — UI + interaction migration (12-col unified board)

**Goal:** Make the new 4-zone board fully playable and legible:

* time zone interaction remains core
* tiles row and events row rendered distinctly
* tag reorder + pawn placement usable

**Work:**

* Update board view/layout to 12-col shared grid across:

  * env tiles row
  * env events row
  * permanents row
* Render:

  * tile identity + ordered tag stack
  * active/pending intent feedback (optional, can be minimal)
  * event cards with duration / class
* Interaction:

  * drag/drop reorder tags (dispatch `CmdSetTileTagOrder`)
  * place/move pawn(s) onto tiles (whatever pawn model is)
* Update chrome HUD to remove legacy deck/discard display and show new deck counters (optional).

**Exit criteria:**

* Player can:

  * scrub time and see state changes
  * place pawns
  * reorder tags
  * observe cadence events
* Legacy env-card row behavior fully replaced.

---

## Notes on why this fits in 5 stages

* Stage 1 isolates defs and avoids coupled partial mechanics.
* Stage 2 introduces state without behavior changes (safe for replay).
* Stage 3 implements the core “new gameplay loop” without season complexity yet.
* Stage 4 swaps the seasonal generation model in one contained step.
* Stage 5 is UI + interaction migration, kept last to avoid debugging UI during core rule churn.
