**Goal:** Add committed pawn “eat/rest” modes with AI seeking and a player-intervention grace period, preserving determinism, serialization, replay/time travel invariants.

### High-level behavior

1. **Modes & commitment**

   * Add `pawn.ai` state (serialized as part of the pawn object):

     * `mode: "eat" | "rest" | null`
     * `suppressAutoUntilSec: number` (default 0)
   * Thresholds (initial values; keep them data-driven/configurable):

     * Enter `eat` when hunger is “bad enough” (define: e.g., `hunger.cur >= HUNGER_START_EAT`).
     * Exit `eat` only when “full” (define: e.g., `hunger.cur <= HUNGER_FULL`).
     * Enter `rest` when stamina is “low enough” (define: e.g., `stamina.cur <= STAMINA_START_REST` or your existing direction; user mentioned “when gets to 20 stamina they move to rest spot”, so confirm whether 20 means low or high in your system).
     * Exit `rest` only when “fully rested” (define: e.g., `stamina.cur >= STAMINA_FULL`).
   * Priority: if both want to trigger, pick one deterministically (e.g., `eat` before `rest`).

2. **Seeking**

   * If in `eat` mode and not currently able to eat:

     * Find nearest reachable “edible source” tile/structure (data-driven via tags/defs).
     * Issue a deterministic move intent (same placement rules as player moves).
   * If in `rest` mode and not currently on a rest spot:

     * Find nearest rest spot tile/structure (data-driven via tags/defs).
     * Move there.
   * Once at the destination:

     * Repeatedly apply eat/rest effects each second until the exit condition is met.

3. **Player intervention**

   * On any successful pawn `PLACE_CHARACTER` (player move):

     * Clear `pawn.ai.mode = null`
     * Set `pawn.ai.suppressAutoUntilSec = state.tSec + 20`
   * During suppression (`state.tSec < suppressAutoUntilSec`):

     * Block **AI movement intents** (seek behavior).
     * Allow **non-movement eating** if food is accessible in-place.

### Where to implement (concrete files / touch-points)

1. **`src/model/commands.js`**

   * In `cmdPlaceCharacter(state, payload)` (where it already sets `ch.envCol`/`ch.hubCol`), after a successful placement:

     * mutate the moved character `ch`:

       * `ensure pawn.ai exists`
       * `pawn.ai.mode = null`
       * `pawn.ai.suppressAutoUntilSec = Math.floor(state.tSec ?? 0) + 20`
   * Must apply for both env and hub placements so replay is deterministic.
     Relevant existing code for placement + constraints:  

2. **`src/model/pawn-exec.js`**

   * Extend `ensurePawnSystems(pawn)` usage by ensuring `pawn.ai` exists (or add a dedicated `ensurePawnAI(pawn)` helper).
   * Before running default pawn intents:

     * Update/maintain `pawn.ai.mode` based on thresholds and commitment rules.
     * If suppressed: block mode-triggered movement decisions but still allow in-place eat.
   * Implement AI-generated intents as either:

     * Additional pawn intents that run before `pawnDefs` intents, or
     * A small “AI layer” that decides on an effect to run (move/eat/rest) and runs it via `runEffect`, consistent with the current execution style. 

3. **Defs / tagging (repo files to inspect)**

   * Identify how “edible” and “rest spot” are represented:

     * `defs/gamepieces/pawn-defs.js` (current pawn intents)
     * `defs/gamesystems/env-tags-defs.js` and `defs/gamesystems/hub-tag-defs.js` (tags + affordances/intents)
     * Any crop/food item defs (for “edible available” checks)
   * Implement seeking predicates based on tags/defs rather than hardcoding.

4. **Movement legality**

   * Reuse the same constraints as `cmdPlaceCharacter` (e.g., `noOccupy` tiles). 
   * AI movement should be executed using the same pathway the sim uses for pawn placement so time travel/replay remains correct (i.e., via effects that ultimately call the same command, or by producing `PLACE_CHARACTER` actions if that’s how “AI actions” are represented in your architecture).

### Acceptance criteria / smoke tests

1. **Commitment**

   * When hunger crosses the enter threshold, pawn commits to eating until full (no sawtooth).
   * When stamina crosses enter threshold, pawn commits to resting until fully rested.

2. **Seeking**

   * If food exists elsewhere, pawn moves to an edible source and then eats to full.
   * If rest spot exists elsewhere, pawn moves to it and rests to full.

3. **Player move cancel + grace**

   * While in eat/rest mode, if player moves pawn:

     * mode clears immediately
     * pawn does not auto-move for 20 seconds
     * pawn can still eat in place if food is accessible
   * After grace ends, if thresholds are still violated, mode can re-engage.

4. **Determinism / replay**

   * Serialize state mid-mode, reload, and observe identical continuation.
   * Record timeline with a player move interrupt; replay yields identical pawn positions and resource curves.

### Deliverable format

* Document:

  * what changed
  * why
  * how to smoke-test
  * remaining risks (especially around what constitutes “edible available” and how to find edible/rest candidates)

