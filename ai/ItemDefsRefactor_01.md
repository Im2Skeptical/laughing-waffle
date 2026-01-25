
---

## Clean-Break Item Refactor (Preserve Transfer Semantics)

You are performing a **clean-break refactor** of the item system.

All legacy item behavior paths (especially item passives defined directly on `itemDefs`) must be **removed**. No migration shims, no fallback logic, no transitional compatibility.

The end state must mirror the unified architecture used for env tiles and hub structures:

> **itemTagDefs + itemSystemDefs + instance tags + effects DSL**

---

## 1. Non-negotiable invariants

### Architecture

* Items are defined using:

  * `itemTagDefs`
  * `itemSystemDefs`
  * `itemDefs` becomes **data-only**
* All item behavior is expressed via **tag-driven passives** executed through the existing effects DSL.
* No bespoke item behavior engine remains.

### Item instances (state shape)

Every item instance in authoritative state must store:

* `kind`
* `tags[]` (copied at spawn time, not derived at runtime)
* `systemTiers`
* `systemState`
* existing identity / stack fields (id, qty, etc.)

Item behavior must **not** read tags or behavior from `itemDefs` at runtime.

---

## 2. Explicit preservation: transfer + currency semantics

### Transfer logic (must be preserved)

* **Do not refactor or redesign the transfer action logic.**
* Transfers must continue to be charged **once per action**, not per unit.
* Batch transfers (arbitrary amounts) must remain **a single action with a single AP charge**.

### Currency behavior

* Items with the base tag `currency` must continue to use the existing **currency transfer pricing logic**.
* This logic must remain **action-level**, not item-passive-based.
* After refactor, transfer logic must check:

  ```js
  item.tags.includes("currency")
  ```

  instead of deriving tags from `itemDefs`.

🚫 Do NOT implement currency behavior via item passives, listeners, or reactive logic.

---

## 3. Registries to introduce / refactor

### A. New registries

Introduce:

* `item-tag-defs.js`
* `item-system-defs.js`

### B. Refactor `item-defs.js`

`itemDefs` must be **data-only**, containing:

* base tags (copied into instances at creation)
* base system tiers/defaults
* visuals / UI metadata
* stack rules

Remove:

* passives
* intents
* any behavior fields

---

## 4. Item systems & required tags

### Required systems

Implement item systems sufficient to preserve existing gameplay:

* rot / freshness system (age, stage, or equivalent)

### Required tags

Implement at minimum:

* `rotatable` — items that can rot over time
* `rotted` / `rot` — final rotted state
* `edible` — if currently used
* `currency` — must be preserved exactly

---

## 5. Rot behavior (must be preserved)

Implement rot as **tag-driven passives**:

* Defined in `itemTagDefs.rotatable.passives`
* Runs on `second` cadence
* Uses **deterministic RNG** (engine RNG / state PRNG, never `Math.random`)
* Advances rot state over time
* When rot occurs:

  * deterministically transform the item (preferred: replace item kind with `rot`)
  * use effects DSL ops, not bespoke mutation

No listeners, no “on inventory change” hooks.

---

## 6. Item passive execution pass

Replace the legacy item passive runner with a tag-driven pass:

```
stepItemSecond(state, tSec)
```

Execution model:

1. Traverse inventories deterministically:

   * characters (array order)
   * hub structures (slot order)
   * any global inventories (fixed order)
2. For each item instance:

   * iterate `item.tags[]`
   * run matching tag passives for the current timing
   * execute via `runEffect` with item-scoped context

No runtime behavior lookup from `itemDefs`.

---

## 7. Effect targeting requirements

Ensure the effects system supports:

* `{ ref: "self" }` → item systemState
* `{ ref: "selfInv" }` → inventory containing the item

Do not invent new ownership abstractions unless already present.

---

## 8. Deletion policy (strict)

Remove or fully disconnect:

* any execution of `itemDefs[kind].passives`
* any item behavior runners tied to `itemDefs`
* any reactive or listener-based item logic

No migration code. No fallback branches.

---

## 9. Acceptance checks

1. New item instances contain `tags[]`, `systemState`, `systemTiers`.
2. Barley rots over time with deterministic chance and produces rot.
3. Currency-tagged items still trigger **currency transfer pricing**, charged once per transfer action.
4. Non-currency items still use standard transfer pricing.
5. No code path executes item passives from `itemDefs`.
6. Replay to the same `tSec` yields identical item/system state.

---

## 10. Output expectations

* Prefer full-file replacements.
* Clearly list:

  * legacy item behavior code removed
  * new registries added
  * where instance tags/systems are initialized
  * where item passives are executed
* Call out any assumption explicitly.

---

### End of prompt

---