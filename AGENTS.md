# Agent Instructions

Local instructions for Codex agents working in this repo.

## Project context
- Read `ai/ai-context.md` before making changes.

## Current goal context
- General feature buildout and fixes.

## Core constraints (non-negotiable)
- Determinism: no `Math.random()`; all randomness must go through `state.rng`.
- Serialization: `GameState` must stay JSON-serializable (no classes/functions/Maps/Sets).
- Replay: `rebuildStateAtSecond(tSec)` must be authoritative and deterministic.
- Time: `tSec` is the authoritative axis; time only advances via simulation ticks.
- Layering: Model has no UI imports; Views are render/input only; Controllers orchestrate.
- DSL-first gamepiece behaviors: when creating or updating gamepieces, first express behavior with existing DSL ops; if not possible, add a generalized DSL capability and then implement the behavior as data using that capability (avoid bespoke one-off model logic when a reusable DSL affordance can cover it).

## AI workflow
- Before coding, do an impact analysis (determinism, serialization, replay, layering).
- Mention how to test any behavior you touch.
- Refactors are to be clean with no migratory shim style code. We are prototyping and so there is no need to preserve functionality of older saves



- After any code change, run `npm run verify` before finalizing.
- Use `set STRICT_ENV_DEFS=1 && npm run test` when env def changes should be a hard gate.
