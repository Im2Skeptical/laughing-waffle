# Trigger Dictionary

Reference for where effects can be attached and when they run.

## Env Events (env-events-defs.js)
### `onEnter`
- Runs once when the event anchor is first processed.

### `onTick`
- Runs every second while the event is active.

### `onExit`
- Runs when the event expires or is removed.
- Expiry reasons:
  - `durationSec` elapsed.
  - `expiresOnSeasonChange` (event or instance flag).
  - Collision removal (when spawn uses `collision.mode: "destroyExisting"` and `runExit` is true).

## Env Tags (env-tags-defs.js)
### `passives`
- Run every second per tile, regardless of pawn presence.
- Optional `timing`:
  - `timing.cadenceSec`: integer cadence (seconds).
  - `timing.onSeasonChange: true`: run only on season change.

### `intents`
- Run only when a pawn is on the tile.
- Only the first eligible intent per tile executes each second.

### `requires` gates (for passives/intents)
- `season: string[]`
- `hasPawn: boolean`
- `hasMaturedPool: boolean`
- `hasTag: string | string[]`
- `hasEquipment`: currently treated as false (reserved)

## Item Passives (gamepieces-defs.js -> itemDefs)
### `passives`
- Run per item.
- Timing:
  - No `timing`: every second.
  - `timing.cadenceSec`: cadence in seconds.
  - `timing.onSeasonChange: true`: only on season change.

## Hub Structure Behaviors (gamepieces-defs.js -> hubStructureDefs)
### `behaviors`
- `TimedTrigger`
  - Fires a trigger on a timer.
  - Props: `timerKey`, `periodKey`, `defaultPeriod`, `triggerId`.
  - Optional gate: `requiresOccupant` (requires a character on the hub slot).

### Trigger Ids (current)
- `MineFuel`

## Season Deck Event Spawning (env-exec.js)
- Event draw cadence: every 5 seconds (`EVENT_CADENCE_SEC`).
- Spawns from the current season deck, then applies the event's `spawn` policy.
