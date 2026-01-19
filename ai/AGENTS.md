# AGENTS.md

Local instructions for Codex agents working in this repo.

## Project context
- Read `ai/ai-context.md` before making changes.

## Current goal context
- Read `ai/Gamepiece Def Schema.md` and `ai/GameplaySystemRefactor - Goals 01.md` for the refactor stage you are working on

## Core constraints (non-negotiable)
- Determinism: no `Math.random()`; all randomness must go through `state.rng`.
- Serialization: `GameState` must stay JSON-serializable (no classes/functions/Maps/Sets).
- Replay: `rebuildStateAtSecond(tSec)` must be authoritative and deterministic.
- Time: `tSec` is the authoritative axis; time only advances via simulation ticks.
- Layering: Model has no UI imports; Views are render/input only; Controllers orchestrate.

## AI workflow
- Before coding, do an impact analysis (determinism, serialization, replay, layering).
- Mention how to test any behavior you touch.
