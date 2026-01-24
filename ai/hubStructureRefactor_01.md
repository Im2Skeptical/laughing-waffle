
---

## ✦ FEATURE PROMPT — Rebuild Hub Structures on Tags + Systems + DSL Effects

### Goal

Replace the existing hub structure behavior system with a **clean, unified architecture** that mirrors env tiles:

> **tags + systems + passives/intents + effects DSL**

All existing hub behavior code and content is to be **deleted**. No migration shims, compatibility layers, or legacy preservation.

This is a deliberate reset.

---

## 1. Non-negotiable invariants

1. **Architecture parity**

   * Hub structures must use the *same conceptual execution model* as env tiles:

     * `hubTagDefs`
     * `hubSystemDefs`
     * tag-driven `passives` and `intents`
     * execution via the existing effects DSL (`runEffect`)
   * No bespoke “behavior” engine remains.

2. **Execution semantics**

   * **Passives**:

     * run according to their declared timing (`second`, `season`, etc.)
     * do *not* require pawn presence
   * **Intents**:

     * require pawn presence on the hub slot (same semantics as env tiles)
     * execute per pawn, per hub slot, per second
     * first *payable* intent wins per pawn
     * costs are atomic per pawn (reuse existing cost system)

3. **Pawn interaction**

   * Hub intents run **only if a pawn occupies the hub slot**.
   * Multiple pawns on a hub slot may independently trigger intents (same policy as env tiles).

4. **Effects & targeting**

   * Hub passives and intents must use the **existing effects DSL**.
   * Valid targets include:

     * `{ ref: "self" }` → hub structure systems
     * `{ ref: "pawn" }` → interacting pawn
     * global / state targets already supported
   * No new effect engine.

5. **Deletion policy**

   * All old hub behavior code, defs, and execution paths must be removed.
   * This includes:

     * `behaviors`
     * trigger-based hub logic
     * any hub-specific execution helpers not reused by the new system
   * No transitional or compatibility code.

---

## 2. Required deliverables

### A. New definitions

Introduce the following registries (mirroring env):

* `hub-tag-defs.js`
* `hub-system-defs.js`
* **new** `hub-structure-defs.js` (fresh content only)

Each hub structure instance must have:

* `tags[]`
* `systemTiers`
* `systemState`

System initialization must be deterministic and data-driven.

---

### B. Hub execution pass

Add a new simulation pass:

```
stepHubSecond(state, tSec)
```

Execution model (mirrors env tiles):

For each hub slot:

1. Resolve the hub structure instance (if any).
2. Run **hub tag passives** (timing-based).
3. Enumerate pawns occupying the hub slot (stable order).
4. For each pawn:

   * evaluate hub tag intents in order
   * check requirements
   * resolve + apply atomic costs
   * run effects
   * stop after first payable intent for that pawn

This pass must be called once per second from the main simulation loop.

---

### C. Removal of legacy hub system

Delete or fully disconnect:

* old hub `behaviors`
* trigger handlers (e.g. timed triggers)
* legacy hub execution in `updateGame` or equivalent

After this change:

* **all hub dynamics must flow through tags + systems + DSL effects**

---

## 3. Constraints (do not violate)

* Do **not** refactor env tile logic beyond reuse.
* Do **not** introduce new DSL concepts.
* Do **not** preserve old hub content “just in case”.
* Do **not** alter timeline, projection, or replay semantics.
* Do **not** add UI changes unless strictly required for correctness.

---

## 4. Acceptance checks

1. Hub structure with a passive:

   * system value updates deterministically each second.
2. Hub structure with an intent:

   * pawn present → intent executes
   * pawn absent → intent does not execute
3. Two pawns on one hub slot:

   * each pawn may independently execute the same intent in the same second.
4. Replay rebuild to the same `tSec` yields identical hub + pawn state.
5. No remaining references to legacy hub behavior code.

---

## 5. Output expectations

* Prefer **full-file replacements** for clarity.
* Explain:

  * what was removed
  * what replaced it
  * how hub execution now mirrors env tiles
* Call out any assumptions explicitly.

---

## 5. Reference for minimal content in new hub defs

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
  }
};
```



---

### End of prompt

---



