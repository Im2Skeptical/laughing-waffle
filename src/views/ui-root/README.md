# UI Root Modules

This folder contains extracted modules from `src/views/ui-root-pixi.js` to keep
the root orchestration file focused on wiring.

## Current modules

- `paused-action-queue.js`
  - Pause-first action queue used by inventory/process/board interactions.
  - Public API: `requestPauseForAction`, `queueActionWhenPaused`,
    `flushQueuedActions`, `clearQueuedActions`.
- `system-graph-model.js`
  - Hover-target resolution, system-series building, and throttled target
    updates for the systems graph.
  - Public API: `controller`, `refreshTargetThrottled`,
    `toggleGraphForHover`, `toggleGraphForOwner`.
- `graph-view-builders.js`
  - Shared builder for metric graph views that use runner timeline/cursor/
    preview/commit callbacks.
- `scroll-graph-orchestrator.js`
  - Per-item scroll timegraph window orchestration with deterministic cascading
    placement and per-scroll open/close lifecycle.
  - Public API: `handleUseItem`, `handleInvalidate`, `update`, `closeAllGraphs`.
- `projection-parity.js`
  - Debug probe utilities for projection parity checks.

## Conventions

- Keep modules focused and side-effect free except for explicit runner/view
  callbacks.
- Prefer passing dependencies (runner/controller/view callbacks) over reaching
  global state.
- Keep behavior-preserving refactors separate from logic changes.
