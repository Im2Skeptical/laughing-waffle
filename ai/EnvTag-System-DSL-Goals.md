# Env Tag/System DSL Refactor Goals

## 1) Split execution lanes
- Passives run every second regardless of pawns.
- Intents remain pawn-gated and evaluated once per second in tag priority order.

## 2) Add passives to env tags (or equivalent)
- envTagDefs can declare always-on effects under passives.
- Passives execute even when hasPawn is false.
- Passives can define cadence and season hooks (e.g., every N seconds, on season change).

## 3) Introduce a generic process model
- Replace crop-specific batch logic with a generic process queue.
- Processes include startSec, durationSec, inputs, outputs, and metadata.
- Define a minimal process schema (ids, timestamps, inputs/outputs, and deterministic RNG hooks).

## 4) Move system behavior into defs
- envSystemDefs describe default state shape (meters/pools/queues).
- envSystemDefs describe passive tick rules (decay/accumulation).
- envSystemDefs hold curves/tables (hydration curves, fertility quality tables).
- Specify enable/disable semantics (cleanup/reset when tag/system is removed).

## 5) Expand effect ops (generic, data-driven)
- ConsumeItem
- TransferUnits (generic source/target)
- SpawnItem
- AddToSystemState
- ClampSystemState
- AccumulateRatio
- CreateProcess
- FinalizeProcess

## 6) Deterministic evaluation engine (gating stays outside effects)
- Extend env-exec.js to run passives and then intents per tile per second.
- effects.js remains pure execution (no gating).

## 7) Ordering contract (per second)
- Event onTick -> Tag passives -> Tag intents.
- For passives/intents within a tag, define evaluation order (list order) and whether multiple can run.

## 8) DSL remains data-only
- No inline logic in defs; effects are declarative ops only.
- Pools/process queues live under tile.systemState[systemId] unless otherwise specified.

## 9) Determinism / serialization / replay
- All randomness uses state.rng.
- All state remains JSON-serializable.
- Update env defs validation to cover new fields/ops and fail fast in DEV.

## 10) Clean refactor constraint
- No migration shims to keep the old farming behavior working.
- Use ai/Farming Feature Goals.md and repo history to restore intended farming design.
