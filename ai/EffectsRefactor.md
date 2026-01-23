ROLE
You are a ChatGPT Codex agent refactoring a deterministic single-player JS simulation game. Your task is to modularize src/model/effects.js without changing gameplay behavior, determinism, replay, serialization, or projection invariants.

PRIMARY GOAL
Refactor effects.js into small, logically grouped ES module files that are easy to reason about and maintain, while preserving:
- exact semantics of EffectOp evaluation
- exact mutation behavior and ordering
- deterministic replay/projection behavior
- JSON-serializable state constraints

PROJECT NON-NEGOTIABLES (read and obey)
- Determinism: all randomness must flow through state.rng helpers; never use Math.random; no wall-clock dependencies. (See ai-context.md) :contentReference[oaicite:0]{index=0}
- Serialization: authoritative state must remain 100% JSON-serializable; avoid Maps/Sets/functions/classes in state. (ai-context.md) :contentReference[oaicite:1]{index=1}
- Separation of concerns: defs are data-only; model owns rules; views/controllers don’t contain gameplay rules. (ai-context.md) :contentReference[oaicite:2]{index=2}
- Simulation is second-boundary-driven for many systems: env step is run on integer second boundaries and uses runEffect; item second/season processing is invoked by cmdTickSimulation/cmdAdvanceSeason. :contentReference[oaicite:3]{index=3} :contentReference[oaicite:4]{index=4} :contentReference[oaicite:5]{index=5}

TARGET FUTURE ARCHITECTURE (must not block)
Effects should be prepared to support separate tag/system registries per host type:
- envTagDefs, envSystemDefs
- hubStructureTagDefs, hubStructureSystemDefs
- itemTagDefs, itemSystemDefs
- pawnTagDefs, pawnSystemDefs
Keep registries distinct, but enable reuse of EffectOps operators and targeting/resolution logic across host types.

CURRENT REALITY (what you are refactoring)
effects.js currently contains:
- normalizeEffectSpec + runEffect() interpreter with a large switch on effect.op (EffectOps DSL) :contentReference[oaicite:6]{index=6}
- targeting helpers for board targets and owner targets (tile occupants, layer selection, etc.) :contentReference[oaicite:7]{index=7}
- system state initialization based on envSystemDefs defaults :contentReference[oaicite:8]{index=8} :contentReference[oaicite:9]{index=9}
- inventory authority operations (move/stack/split handlers) :contentReference[oaicite:10]{index=10}
- item passive ticking and seasonal expiry processing called from commands :contentReference[oaicite:11]{index=11} :contentReference[oaicite:12]{index=12}
- process-related ops (CreateProcess/FinalizeProcess/etc.) (keep exact semantics)

REFRACTOR OUTCOME (deliverables)
1) A new folder structure under src/model/effects/ with multiple modules.
2) src/model/effects.js becomes a thin compatibility facade that preserves its public API:
   - export normalizeEffectSpec
   - export runEffect
   - export processSeasonChangeForItems
   - export processSecondChangeForItems
   Any other current exports must remain callable by existing imports.
3) No callsite changes outside effects.js unless strictly necessary (minimize blast radius).
4) A short “smoke test plan” in comments or a markdown note describing how to verify determinism and replay safety.

PROPOSED MODULE STRUCTURE (recommended)
Create src/model/effects/ with:
- index.js
  - exports: runEffect, normalizeEffectSpec, processSeasonChangeForItems, processSecondChangeForItems
  - owns the op-dispatch table (op -> handler function)
- core/
  - normalize.js: normalizeEffectSpec
  - registry.js: def registry resolution (items/crops/envSystems today; extensible later)
  - amount.js: resolveAmount (amount/var/systemKey/defKey + scaling)
  - clamp.js: clamp helper (single source)
  - context.js: small helpers for building derived context fields (no behavior change)
  - targets-board.js: resolveBoardTargets (layer/all/at/ref=self)
  - targets-owner.js: resolveOwnerTargets (tileOccupants / explicit ownerIds)
  - system-state.js: ensureSystemState / tier helpers (parameterize registry later)
- ops/
  - game-ops.js: AddResource etc.
  - item-ops.js: TransformItem, RemoveItem, ExpireItemChance, TickItemSeasonExpiry
  - system-ops.js: AddToSystemState, ClampSystemState, AdjustSystemState, ResetSystemState, AccumulateRatio, process queue ops
  - tag-ops.js: AddTag/RemoveTag/DisableTag/etc. (if present)
  - event-ops.js: env event ops (if present)
  - inventory-ops.js: inventory handler ops + internal helpers
- item-tick/
  - item-passives.js: runItemPassives + timing predicates
  - item-season.js: season change processing
  - item-second.js: per-second processing

IMPORTANT: The exact boundaries can differ, but keep files small and cohesive.

BEST PRACTICES (must follow)
Behavioral preservation
- Do not change any op semantics, ordering, or “changed” return values.
- Preserve all early-return behavior and null-guard logic.
- Preserve deterministic iteration order (avoid object key iteration unless already present; keep array iteration order).

API compatibility
- Keep the runEffect signature identical and allow the same context shapes.
- Keep normalizeEffectSpec behavior identical. :contentReference[oaicite:13]{index=13}

No new state mutations outside existing patterns
- Do not add new fields to authoritative state during refactor (except harmless internal locals).
- Do not introduce Maps/Sets into state (locals are okay).

Avoid circular dependencies
- core modules should not import ops modules.
- ops modules may import core modules.
- index.js is the only place that wires op -> handler mapping.

Extensibility for multi-host system/tag registries
- When you touch ensureSystemState / registry resolution, structure it so it can later accept:
  - registryName or registry object
  - hostKind inference (env/hub/item/pawn)
But do NOT implement new host kinds in this refactor unless unavoidable.

WHAT TO LOOK FOR (opportunities to reduce length safely)
- Centralize repeated clamp/min/max logic used in multiple ops into one helper (no semantic change).
- Centralize repeated “resolve targets or fall back to context.source” pattern.
- Keep the complex inventory/process logic intact; only move it.

VALIDATION / SMOKE TEST PLAN (minimum)
After refactor, verify:
1) Build runs, imports resolve, no circular import errors.
2) Run a deterministic scenario start and simulate N seconds:
   - compare serialized snapshots (or canonicalized snapshots) at checkpoints before/after refactor.
   - ensure the same results across replay rebuild (timeline rebuildStateAtSecond) and forward sim. (ai-context + timeline/projection invariants) :contentReference[oaicite:14]{index=14}
3) Exercise inventory ops (move/stack/split) and confirm identical outcomes and inventory version bumps.
4) Exercise env tick integration:
   - stepEnvSecond continues to call runEffect successfully. :contentReference[oaicite:15]{index=15}
5) Exercise item seasonal and per-second processing:
   - cmdAdvanceSeason calls processSeasonChangeForItems; cmdTickSimulation calls processSecondChangeForItems. :contentReference[oaicite:16]{index=16}
6) Ensure projection remains pure (no accidental mutation of passed-in states during refactor). (projection constraints) :contentReference[oaicite:17]{index=17}

EXECUTION OUTLINE (how to do the refactor)
Step 0: Freeze behavior
- Do not “clean up logic” in the same change. Only move code + minimal glue.

Step 1: Create new folder and move pure helpers first
- Extract normalizeEffectSpec, clamp, cloneSerializable, registry resolution, resolveAmount, target resolvers.

Step 2: Convert switch cases into handler functions grouped by module
- Keep each case logic identical, just wrapped in function (state, effect, context) -> boolean
- Put handler table in effects/index.js:
  const handlers = { AddResource: handleAddResource, ... }

Step 3: Keep effects.js as a facade
- Re-export the same public functions by importing from effects/index.js.

Step 4: Run smoke tests (above) and fix any import/cycle issues.

OUTPUT FORMAT
- Provide patches as full file replacements (preferred).
- If creating new files, output complete contents for each new file and the updated effects.js.
- Include a brief changelog and the smoke-test checklist at the end.

DO NOT
- Introduce new gameplay features.
- Rename ops or change DSL schema.
- Change timing semantics (second vs season).
- Change action/timeline behavior or pause gating.
