### ✦ FEATURE IMPLEMENTATION PROMPT — Per-Pawn Atomic Costs & Pawn Systems

You are implementing a **deterministic, per-pawn atomic cost system** for env tile intents, based on the attached feature spec:


This is a **surgical feature expansion**, not a refactor. Preserve existing architecture, ordering, and replay guarantees.

---

## 1. Non-negotiable invariants (do not reinterpret)

1. **Execution unit**
   Env intents execute per **(envCol, pawnId, tSec)**.

2. **Per-pawn intent rule**
   Each pawn may execute **at most one** env intent per tile per second.

3. **Intent selection policy**

   * Evaluate intents in order.
   * **First *payable* intent wins** for that pawn.
   * If an intent fails requirements or costs, continue to later intents for the same pawn.

4. **Atomic per-pawn costs**

   * All costs must be affordable up-front.
   * If any charge fails → **no costs applied, no effects run** for that intent.

5. **Skip-pawn only**

   * Cost or requirement failure skips only that pawn.
   * Other pawns on the same tile must still be evaluated.

6. **Determinism**

   * Env columns: ascending order.
   * Pawns on a column: `state.characters` array order.
   * Tags and intents: existing order.
   * Cost charges: declared order.

7. **No v1 features beyond the spec**

   * No attempt/success logic.
   * No outVars.
   * No branching.
   * No reactive listeners.
   * No cost modifiers.

---

## 2. Implementation tasks (follow in order)

### Task 1 — Pawn systems

* Add `pawnSystemDefs` with at least:

  * `stamina { cur, max }`
  * `hunger { cur, max }`
* Ensure pawn instances initialize `systemTiers` and `systemState` from defaults.

### Task 2 — Pawn enumeration helper

* Implement:

  ```js
  getPawnIdsOnEnvCol(state, col) -> pawnId[]
  ```
* Iterate `state.characters` in array order.
* Match `ch.envCol === col`.

### Task 3 — Requirements extension

Extend `requirementsPass` to support:

* `requires.hasSelectedCrop: true`
* (optional) `requires.selectedCropIdIn: string[]`

No pawn-equipment requirements yet.

### Task 4 — Cost system (pure + atomic)

Implement the following **pure functions**:

1. `resolveCosts(costSpec, ctx) -> ResolvedCosts | null`
2. `canAffordCosts(resolvedCosts, ctx) -> boolean`
3. `applyCosts(resolvedCosts, ctx)`

Rules:

* Resolution is read-only.
* Affordability checks *all* charges.
* `applyCosts` mutates state **only after** affordability passes.
* No partial application.

Supported charge types (v1 only):

* System drain → pawn systems
* Item payment → pawn inventory

### Task 5 — Env intent execution (per pawn)

Modify env intent execution to:

For each env column:

1. Run tile passives once (unchanged).
2. Enumerate pawns on the column.
3. For each pawn:

   * Evaluate intents in order.
   * Skip intents failing requirements.
   * Resolve + afford costs.
   * Apply costs **before** effects.
   * Run effects with pawn-scoped context.
   * Stop after first payable intent for that pawn.

### Task 6 — Effect targeting extension (Approach B)

Extend system-targeting so:

```js
target: { ref: "pawn" }
```

routes `AddToSystemState` / `ClampSystemState` to:

```js
pawn.systemState[system][key]
```

Do **not** introduce parallel mutation paths.

---

## 3. Acceptance tests (must pass)

1. **Two pawns, enough resources**

   * Both pay costs.
   * Tile growth advances twice in same `tSec`.

2. **One pawn unaffordable**

   * Pawn A skips work.
   * Pawn B succeeds.
   * No partial cost application.

3. **No selected crop**

   * Farm intent not eligible.
   * No stamina or seed spent.

4. **Replay determinism**

   * Rebuild + replay to same `tSec` yields identical pawn stamina, inventory, and tile state.

---

## 4. Non-goals (explicitly forbidden)

* No attempt/success semantics.
* No outVar-based branching.
* No cost modifiers or discounts.
* No refactors of effects.js beyond target routing.
* No changes to simulation cadence or timeline logic.

---

## 5. Deliverables

* Modified files with **full replacements** where practical.
* Clear explanation of:

  * what changed
  * why it preserves determinism
  * how to smoke-test the feature
* Call out any assumption that required interpretation.

---

### End of prompt

---

If you want, next I can:

* condense this further into a **“minimal agent brief”** (even tighter),
* or help you write a **review checklist** so you can validate the agent’s output quickly.
