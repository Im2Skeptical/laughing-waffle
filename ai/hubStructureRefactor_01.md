## Rebuild Hub Structures on DSL + Add Hearth

You are performing a **deliberate, clean rebuild** of the hub structure system.

All existing hub behavior code is **experimental and disposable** and must be **fully removed**. There is no save compatibility requirement and no migration shim code.

The end state must mirror the **env tile architecture** exactly:

> **tags + systems + passives/intents + effects DSL**

---

## 1. Non-negotiable invariants

### Architecture

* Hub structures use:

  * `hubTagDefs`
  * `hubSystemDefs`
  * `hubStructureDefs`
* All behavior is expressed via:

  * tag `passives`
  * tag `intents`
  * evaluated through the existing **effects DSL**
* No bespoke “hub behavior” engine remains.

### Execution semantics

* **Passives**

  * run according to declared timing (`second`, `season`, etc.)
  * do **not** require pawn presence
* **Intents**

  * require pawn presence on the hub slot
  * execute **per pawn, per second**
  * first **payable** intent wins *per pawn*
  * costs are **atomic per pawn**
  * if an intent is not payable for a pawn, continue to later intents for that pawn

### Pawn interaction

* Multiple pawns on the same hub slot may independently execute intents in the same second.
* Execution order is deterministic:

  * hub slots in index order
  * pawns in `state.characters` array order
  * tags and intents in definition order

### Effects & targeting

* Use the existing effects DSL.
* Valid targets include:

  * `{ ref: "self" }` → hub structure systems
  * `{ ref: "pawn" }` → interacting pawn
  * `{ ref: "selfInv" }` → hub structure inventory
* Do **not** introduce new effect engines or listeners.

### Deletion policy

* Delete **all** legacy hub behavior code and defs:

  * `behaviors`
  * trigger-based hub logic
  * old hub execution paths
* No transitional or compatibility code.

---

## 2. Required implementation work

### A. New definitions

Introduce:

* `hub-tag-defs.js`
* `hub-system-defs.js`
* a **fresh** `hub-structure-defs.js`

Each hub structure instance must have:

* `tags[]`
* `systemTiers`
* `systemState`
* capacity for **inventory** (even if unused)

System and inventory initialization must be deterministic.

---

### B. Hub execution pass

Add a new simulation phase:

```
stepHubSecond(state, tSec)
```

Execution model (mirrors env tiles):

For each hub slot:

1. Resolve the hub structure instance (if any).
2. Run hub tag **passives** (timing-based).
3. Enumerate pawns occupying the hub slot.
4. For each pawn:

   * evaluate hub tag intents in order
   * check requirements
   * resolve + apply **atomic costs**
   * run effects
   * stop after the first payable intent for that pawn

This pass must be called once per second from the main simulation loop.

---

### C. Effect targeting

Extend targeting so:

* `{ ref: "pawn" }` mutates `pawn.systemState`
* `{ ref: "selfInv" }` resolves to the hub structure’s inventory

Do not create parallel mutation paths.

---

### D. Minimal example content: Hearth

Implement a **minimal hearth hub structure** using the new system.

#### Hearth behavior

* Implemented as a **hub intent**
* Requires pawn presence (handled by intent loop)
* No cost
* Effect:

  * `+1` stamina to the pawn per second
  * clamp to pawn stamina max

This must apply **per pawn** when multiple pawns occupy the hearth.

#### Hearth defs

* A `hearth` hub tag defining the intent
* A `hearth` hub structure referencing that tag
* Hearth inventory exists but is unused for now

---

## 3. Constraints (do not violate)

* Do **not** refactor env tile logic beyond reuse.
* Do **not** alter timeline, projection, or replay semantics.
* Do **not** introduce listeners or reactive logic.
* Do **not** preserve or port old hub behaviors.
* Do **not** add additional hub content beyond the hearth.

---

## 4. Acceptance checks

1. Hearth with one pawn:

   * pawn gains stamina each second.
2. Hearth with two pawns:

   * both pawns gain stamina in the same second.
3. Hearth with no pawns:

   * no intent executes.
4. Hub inventory exists and is empty by default.
5. Replay rebuild to the same `tSec` yields identical hub + pawn state.
6. No remaining references to legacy hub behavior code.

---

## 5. Output expectations
* Clearly explain:

  * what legacy code was removed
  * how hub execution now mirrors env tiles
  * how determinism is preserved
* Call out any assumption explicitly.

---

### End of prompt

---

## Loose reference for content in new hub defs

### 1) `hub-system-defs.js`

You can skip hub systems entirely for this minimal feature. The hearth doesn’t need internal meters to buff pawns.

### 2) `hub-tag-defs.js` 

Add a tag that provides an intent which always applies +stamina to the activating pawn:

```js
// src/defs/hub/hub-tag-defs.js
export const hubTagDefs = {
  hearth: {
    id: "hearth",
    kind: "hubTag",
    ui: { name: "Hearth", description: "Rest here to regain stamina." },
    systems: [],
    passives: [],
    intents: [
      {
        id: "hearth-rest",
        verb: "Rest",
        requires: {}, // pawn presence is handled by hub intent loop; no extra gating
        // optional: cost: { charges: [] }
        effect: [
          { op: "AddToSystemState", target: { ref: "pawn" }, system: "stamina", key: "cur", amount: 1 },
          { op: "ClampSystemState", target: { ref: "pawn" }, system: "stamina", key: "cur", min: 0, maxKey: "max" }
        ]
      }
    ]
  }
};
```

### 3) `hub-structure-defs.js`

```js
// src/defs/hub/hub-structure-defs.js
export const hubStructureDefs = {
  hearth: {
    id: "hearth",
    kind: "hubStructure",
    ui: { name: "Hearth", description: "A warm place to recover." },
    tags: ["hearth"],
    systems: {} // optional; empty is fine
    inventory: { cols: 5, rows: 10 },
  }
};
```
