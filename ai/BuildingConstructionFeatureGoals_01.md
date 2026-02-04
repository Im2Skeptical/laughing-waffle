
## Feature: Hub Building Construction (First Pass)

### Core Intent

Enable players to designate and complete construction of basic hub buildings (Granary, Storehouse) in a way that:

* Is fully deterministic and replay-safe
* Uses existing action, hub execution, inventory, and tag systems
* Scales naturally to future mechanics (duplicate buildings, multiple leaders, automation, passives)

---

## High-Level Player Experience Goals

1. **Leader-driven unlocks**

   * Buildings available for construction are an affordance provided by leader pawns.
   * The build list is visible when selecting a leader pawn.
   * Loss of a leader does *not* invalidate already placed or in-progress buildings.

2. **Intent-first placement**

   * Construction is designated explicitly by the player.
   * Placement is limited to valid, empty hub slots.
   * Duplicate buildings are disallowed globally (one per hub) by default.

3. **Convenient but honest interaction**

   * Players may:

     * Designate construction directly on a pawn already in position, **or**
     * Use a convenience shortcut that automatically moves the selected pawn and then designates construction.
   * Convenience does not bypass rules: AP costs, placement validity, and movement constraints are identical to manual play.

4. **Visible, legible construction state**

   * Under-construction buildings appear as a greyed-out version of the final structure.
   * They do not expose their normal systems/tags.
   * Instead, they present a “construction” view showing:

     * Required resources
     * Deposited progress
     * Remaining labor time

5. **Ongoing, systemic construction**

   * Construction progresses through normal simulation time.
   * It pauses naturally when conditions are unmet (no workers, no stamina, blocked by events).
   * Completion is automatic once requirements are satisfied.

---

## Architectural Outcomes (Model-Level)

### 1. Construction is a **state**, not a separate entity

* A construction site is a **hub structure instance** with:

  * The *final* building `defId`
  * An explicit `build` sub-state (e.g. `status: underConstruction`)
* Footprint and occupancy are identical to the finished building.
* Transition to “complete” is a state flip, not a replacement.

**Why:**
This preserves determinism, avoids instance swapping, and ensures projection/replay see the same object lifecycle.

---

### 2. Uniqueness is data-driven

* Buildings declare a default global uniqueness constraint (e.g. `maxInstances: 1`).
* This is enforced at designation time.
* Future systems may override or extend this limit via passives or effects.

**Why:**
Avoids hard-coding assumptions and keeps future “duplicate enablers” straightforward.

---

### 3. Leader unlocks are declarative

* Leader pawns expose a list of buildable structure IDs via their defs.
* The available build list is computed at interaction time from controlled leaders.
* Unlocks are *not* re-evaluated after placement.

**Why:**
Matches existing affordance patterns (prestige, powers) and avoids retroactive invalidation.

---

### 4. Designation is an explicit action

* Construction designation is recorded as a gameplay action at a second boundary.
* If the convenience auto-move is used, it results in:

  * A normal pawn placement/movement action
  * Followed by a build designation action
* Both actions obey pause, AP, and validity rules.

**Why:**
Preserves timeline integrity. No hidden state mutations.

---

### 5. Construction uses existing hub execution flow

* Construction progression is evaluated during per-second hub execution.
* It naturally fits alongside:

  * Deposit logic
  * Pawn presence checks
  * Tag passives/intents

**Why:**
Avoids introducing parallel simulation paths and keeps projection accurate.

---

## Resource & Labor Model (Outcomes)

### Resource requirements

* Defined per building in defs.
* Can include:

  * Specific item IDs
  * Item tags
  * Numeric values
* Items are consumed incrementally per second using existing deterministic inventory logic.
* No refunds are required for v1.

### Construction inventory

* Each construction site owns an inventory (via existing owner inventory systems).
* Items deposited there are converted into build progress over time.

### Labor

* Any pawn occupying the construction footprint may contribute.
* Labor progress accrues per second per contributing pawn.
* Labor drains pawn stamina.
* When stamina is exhausted or no pawns are present, construction pauses.

**Why:**
This mirrors existing work systems (granary, farming) and avoids bespoke mechanics.

---

## Failure, Pause, and Cancellation Outcomes

### Invalid at designation

* If placement or rules fail at commit time:

  * Action fails
  * No partial state changes occur

### Becomes invalid later

* Construction **pauses**, it does not fail or roll back.
* Causes include:

  * No pawns present
  * All contributing pawns at zero stamina
  * External blocking conditions (e.g. events)

### Cancellation

* Player may explicitly cancel a construction site.
* Cancellation:

  * Is an edit action
  * Immediately removes the structure and its inventory
  * Provides no refunds
* Deterministic and replay-safe.

---

## Completion Outcome

On completion:

* Construction state is cleared.
* The building’s normal tags, systems, and inventory behavior become active.
* The structure persists even if:

  * The original leader dies
  * Leader unlocks change later

---

## Explicit Non-Goals (First Pass)

* No refunds on cancel
* No construction automation
* No partial footprint changes
* No branching timelines
* No AI construction logic
* No dynamic re-evaluation of unlocks

