Build a first-pass **Skill Tree** feature end-to-end (model + defs + UI) with these constraints:

## Objectives

1. **Data-driven skill trees**

   * All trees/nodes/edges live in defs.
   * Nodes can grant:

     * character bonuses (e.g. forage tier +1, rest stamina +10%, farming stamina cost -1)
     * global bonuses (e.g. AP cap +10, projection horizon +10 sec, population eats -10%)
     * unlocks (buildings + recipes)
   * Unlock rule: a node is unlockable if it is the tree’s start node OR it has **>= 1 adjacent unlocked node**, plus any explicit requirements the node declares.

2. **Deterministic auto-layout for UI**

   * Layout must be stable across runs for the same defs (no physics/force layout).
   * Provide optional `uiPos` override per node in defs; otherwise auto-layout.
   * Auto-layout recommendation: BFS depth from start; columns by depth; within a depth sort node ids; compute y positions deterministically.

3. **Authoritative replay/time-travel support**

   * Unlocking a node must be an **action** applied at second boundaries (like other planning edits).
   * Must respect paused-only planning rules.
   * Must preserve determinism, serialization, and timeline truncation semantics.

4. **Minimal Pixi UI**

   * Add a button in the **character inventory view** that opens the skill tree.
   * The skill tree is a **full-screen replacement** view.
   * Minimal controls:

     * “Save/Exit” (commit any changes)
     * “Cancel/Back” (discard changes)
   * Display:

     * nodes + edges
     * node states (locked, unlockable, unlocked)
     * hover/selection tooltip with node name + effects + cost + requirements
   * Interactions:

     * click unlockable node to queue unlock (in an edit buffer)
     * show points available / total cost in buffer
     * must use existing highlight/key conventions where sensible (node click can highlight the character; optional)

## Required engineering decisions (make them explicit in code)

* **Where skill points live** (suggestion: per character `skillPoints` number).
* **How points are earned**: for v1, it’s fine to set a fixed starting points value in state/defs and not implement earning.
* **How to apply bonuses/unlocks**:

  * Do NOT permanently mutate lots of derived values in state.
  * Implement a deterministic “mods” aggregation layer derived from unlocked node ids:

    * `getCharacterSkillMods(characterId, state)`
    * `getGlobalSkillMods(state)`
  * Then wire those mods into existing systems:

    * AP cap computation
    * projection horizon computation
    * recipe/building availability gates
    * pawn/system bonuses (forage/rest/farming)
  * If there isn’t an existing unified modifier system, implement a minimal one specifically for these initial bonuses (keep it small, but extensible).

## Implementation tasks

### A) Defs

* Add new defs category (file location per existing conventions), containing:

  * `skillTrees` with `id`, `startNodeId`, optional UI styling
  * `skillNodes` with:

    * `id`, `treeId`, `name`, `desc`
    * `cost` (default 1)
    * `adjacent` (array of node ids) OR `edges` stored in tree; choose one representation, but validate symmetry if adjacency is per-node
    * optional `uiPos`
    * `effects` payload describing:

      * `characterMods` (e.g. `{ forageTierBonus: 1 }`)
      * `globalMods` (e.g. `{ apCapBonus: 10, projectionHorizonBonusSec: 10, populationFoodMult: 0.9 }`)
      * `unlocks` (e.g. `{ recipes: [...], hubStructures: [...] }`)
    * optional requirements (v1 can be minimal, but define shape)
* Create at least one sample tree with 10–20 nodes to exercise adjacency and layout.

### B) State + canonicalization

* Extend character state to include:

  * `unlockedSkillNodeIds: string[]` (or a set-like object) and `skillPoints`
* Ensure serialization/deserialization and `canonicalizeSnapshot` handle these fields safely.

### C) Actions

* Add new action kind `UnlockSkillNode`:

  * payload: `{ pawnId/characterId, nodeId }`
  * Enforce:

    * paused-only
    * node exists
    * not already unlocked
    * node belongs to a tree allowed for that character (v1: any)
    * cost affordable
    * adjacency rule satisfied (or is start node)
  * Apply:

    * decrement points
    * add node id to unlocked list
* Ensure planner/time-travel works:

  * Unlock is committed at the current `tSec`.
  * Editing at cursor truncates future history as usual.

### D) Derived computation API

Add a module, e.g. `src/model/skills.js`, exporting:

* `getSkillTreeDefs(defs)`
* `getSkillNodeDef(defs, nodeId)`
* `getUnlockedSkillSet(state, characterId)`
* `getUnlockableSkillNodes(state, characterId, treeId)`
* `computeCharacterSkillMods(state, characterId)`
* `computeGlobalSkillMods(state)`
* `computeAvailableRecipesAndBuildings(state)` (or integrate into existing gating functions)

Include a `validateSkillDefs(defs)` called during defs load.

### E) Wire mods/unlocks into gameplay

Implement the initial bonuses end-to-end:

* AP cap bonus affects AP cap calculation
* projection horizon bonus affects projection horizon
* population food multiplier affects whatever system consumes food
* forage/rest/farming examples: implement at least one character-only bonus in the correct system layer (not in UI)

If some of these systems don’t exist yet, stub the mod usage points with TODOs and implement the ones that exist.

### F) UI

* Add a button to the character inventory view: “Skills”.
* Create a new full-screen Pixi view `createSkillTreeView(...)`:

  * Inputs: `runner/controller`, `characterId`, `defs`, and a callback to exit
  * Maintains a local edit buffer of nodes to unlock (not yet committed)
  * Renders nodes + edges using layout
  * Node visuals:

    * Unlocked: filled
    * Unlockable: highlighted
    * Locked: dim
  * Buttons:

    * Save/Exit: dispatch `UnlockSkillNode` actions for buffered nodes (in deterministic order), then exit
    * Cancel/Back: discard buffer, exit
* Ensure view switching is consistent with existing UI navigation patterns (replace screen, then restore).

## Determinism requirements

* Auto-layout must not depend on non-deterministic iteration order; always sort ids.
* Buffer commit ordering must be deterministic (sort by node id or by BFS order).

## Deliverables
* In the PR description / notes (as comments in response), include:

  * what changed
  * why it fits determinism/timeline invariants
  * smoke test steps (unlock nodes, time travel, projection, save/cancel)
