Correction of Building Construction Implementation 

GOAL
Unify the construction (“build”) system with the existing tag/system/process infrastructure so that:
1) Build visuals use the same Tag UI (“Build” label) and standard system meters/progress bars.
2) Build logic reuses existing ops infrastructure (cost resolution + work processes) rather than bespoke progression.
3) Future support: “improvements on existing non-construction tiles” should work by applying a Build tag/process to an existing tile and transforming/modifying the underlying game piece on completion.

CURRENT PROBLEM (AS-IS)
- Construction for hub structures is currently bespoke:
  - Stored as structure.build { status, laborRequiredSec, laborProgress, requirements[], startedSec }.
  - Progress and consumption happen in hub-exec.js (stepConstructionForStructure) in a parallel pipeline.
- Meanwhile, the engine already has:
  - resolveCosts / canAffordCosts / applyCosts for standardized item/system charges.
  - CreateWorkProcess / AdvanceWorkProcess (system-ops) for time/work-progress queues, including workersFrom=hubAnchor.
  - Tag UI that renders systems/meters consistently.
- Because build is not a system/process, it cannot naturally reuse Tag UI meters and duplicates “ops” semantics.

DESIRED DIRECTION (HIGH-LEVEL)
Convert “build” from bespoke per-structure.build progression to a standardized system-backed work process:
- Build should be represented as a “Build” tag + a “build” system state that contains a work process queue.
- Designation adds a work process (mode:"work", workersFrom:"hubAnchor", durationSec=laborSec).
- Costs/inputs for build should use resolveCosts/canAffordCosts/applyCosts (consumption vs requirement-only should be explicit).
- Completion should perform a small build-specific effect: spawn/activate the final structure (hub) or transform/modify an existing tile (env improvements).

SCOPE
Implement hub-structure construction convergence first (existing working system), then add the minimal hooks needed so the same mechanism can be applied to env tiles later.

FILES TO INSPECT / MODIFY (EXPECTED)
- src/model/commands.js
  - cmdBuildDesignate, cmdCancelBuild: change to create/cancel processes + cost application.
- src/model/hub-exec.js
  - Remove/retire bespoke stepConstructionForStructure; instead advance build via system ops (AdvanceWorkProcess) and apply completion logic.
- src/model/actions.js
  - Ensure BUILD_DESIGNATE and BUILD_CANCEL remain stable and serialized action schema unchanged (tSec/apCost behavior).
- src/model/costs.js
  - Reuse for build inputs; add any missing support only if necessary (avoid special cases).
- src/model/effects/ops/system-ops.js (or wherever CreateWorkProcess/AdvanceWorkProcess live)
  - Prefer using existing ops; if a completion callback is needed, implement it as a new effect op or a completionPolicy extension, keeping it deterministic and data-driven.
- src/defs/gamepieces/hub-structure-defs.js
  - Build defs currently: build: { laborSec, requirements: [{kind:"item", itemId, amount}] }.
  - Keep data-driven; do not embed imperative logic.
- src/defs/gamesystems/hub-system-defs.js + src/defs/gamesystems/env-systems-defs.js
  - Add a “build” system definition with stateDefaults that supports process queues and any tracking needed for UI.
- UI files (Pixi)
  - src/views/hub-tag-ui.js, src/views/board-tag-ui.js, src/views/chrome-pixi.js, src/views/board-pixi.js
  - Ensure build appears as a standard tag labeled “Build” with standard meters/progress bars, without bespoke rendering logic.
  - Prefer adapting existing generic meter components to read build system/process state.

IMPLEMENTATION PLAN (REQUIRED OUTPUT)
1) Analysis: summarize the current build pipeline vs system/process pipeline and identify duplicated concepts.
2) Data model: define the “build” system schema (stateDefaults) and how it maps to UI meters.
3) Commands:
   - Update cmdBuildDesignate to create a build process and record needed metadata (e.g. target structure def id, output structure id, location).
   - Update cmdCancelBuild to cancel the process and handle refunds (if applicable) deterministically.
4) Stepping:
   - Ensure build progress advances only through existing process advancement at second cadence.
   - Worker counting should use workersFrom:"hubAnchor" (existing logic).
5) Costs:
   - Decide whether build consumes inputs upfront or incrementally.
   - If incremental is required, implement it using costs infrastructure + deterministic partial progress accounting (avoid ad-hoc item scanning).
6) Completion:
   - On completion, apply the final change:
     - For hub: convert placeholder/under-construction structure into completed structure (or flip a flag).
     - For env later: apply modification/tag/transform to the underlying tile.
7) UI:
   - Build tag must render exactly like other tags/systems.
   - Progress should show “current / max” in the standard meter style.
8) Compatibility / Migration:
   - Provide a migration path for existing saves that have structure.build.
   - On load, detect legacy structure.build and convert to build system process state (including progress).
9) Tests / Smoke tests:
   - Determinism: same inputs produce same outputs; replay rebuild matches live.
   - Time travel: edit in past truncates future and rebuild stable.
   - Projection: forecasting does not mutate authoritative state and matches deterministic stepping.
   - Cancellation: canceling a build leaves no orphan occupancy/caches and is replay-safe.

WORKING RULES
- Avoid piecemeal changes that blur boundaries.
- Clearly explain for each changed file:
  - what changed
  - why it changed
  - how to smoke-test
  - remaining risks

DELIVERABLES
- A coherent code change set implementing hub construction as a system-backed work process + tag UI integration.
- A minimal documented path to extend the same mechanism to env tile improvements.