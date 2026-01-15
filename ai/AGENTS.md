# AGENTS.md

Local instructions for Codex agents working in this repo.

## Project context
- Read `src/ai-context.md` before making changes.
- Preferred location for AI context files is `ai/ai-context.md` or `docs/ai-context.md`
  (the repo already has `ai/`, so `ai/ai-context.md` is a good home if you move it).

## Core constraints (non-negotiable)
- Determinism: no `Math.random()`; all randomness must go through `state.rng`.
- Serialization: `GameState` must stay JSON-serializable (no classes/functions/Maps/Sets).
- Replay: `rebuildStateAtSecond(tSec)` must be authoritative and deterministic.
- Time: `tSec` is the authoritative axis; time only advances via simulation ticks.
- Layering: Model has no UI imports; Views are render/input only; Controllers orchestrate.

## AI workflow
- Before coding, do an impact analysis (determinism, serialization, replay, layering).
- Mention how to test any behavior you touch.
