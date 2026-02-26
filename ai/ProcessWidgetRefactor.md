## Process Widget + Dropbox Refactor Plan (Cleanup, Simplification, Drag Affordance)

### Summary
1. Remove legacy “hidden process dropbox inventory” behavior for non-deposit processes.
2. Make process dropbox loading fully requirement-driven in model (already functionally close), with clearer status/reason contracts for UI.
3. Add pre-drop visual affordance on dropboxes while dragging: green (`valid`), red (`invalid`), orange (`capped`).
4. Reduce messy pathways by extracting high-friction logic into smaller reusable modules, prioritizing model dropbox logic and process-widget drop-target/window lifecycle seams.
5. Keep working deposit/granary/altar instant-dropbox behavior unchanged.

### Impact Analysis
1. Determinism: preserved. All new status evaluation functions are pure given `state`.
2. Serialization: preserved. No classes/maps/functions added to state.
3. Replay: preserved. All state mutation still occurs through command dispatch.
4. Layering: improved. Model dropbox logic centralized in model module; views remain input/render only.

### Scope and Defaults (locked from your clarifications)
1. Keep current recipe-select + immediate drop behavior as core path.
2. Remove non-essential invisible process dropbox inventory objects for non-deposit processes.
3. Add drag-over feedback colors before release:
   - green: drop will accept units
   - red: not acceptable (no recipe, wrong item, bad target)
   - orange: acceptable type but requirement already full/capped
4. Start with model cleanup first, then UI affordance, then modular splits.

### Public API / Interface Changes
1. Add model helper module exports:
   - `evaluateProcessDropboxDrop(state, spec)` -> `{ status: "valid"|"invalid"|"capped", reason, cap }` (pure)
   - `applyProcessDropboxLoad(state, spec)` -> command-side mutation helper for non-deposit process dropboxes
2. `createProcessWidgetView` API changes:
   - replace `getNearestProcessDropboxOwnerAtGlobalPos` usage path with stricter drop-target resolution API (single authoritative target lookup)
   - add methods for drag affordance state:
     - `setDropboxDragAffordance(ownerId, level)`
     - `clearDropboxDragAffordance(ownerId?)`
3. `createInventoryView` options add:
   - `getProcessDropboxDragStatus(spec)` callback for hover-time validation
4. `ui-root-pixi` wiring updates:
   - pass `getProcessDropboxDragStatus`
   - consume new process-widget drop-target resolver and affordance methods
5. No compatibility shim for old process-dropbox-inventory state (prototype rule).

### Implementation Plan

## Phase 1: Model Dropbox Simplification
1. Create `src/model/commands/process-dropbox-logic.js`.
2. Move/centralize from `inventory-commands.js`:
   - ownerId parsing for process/hub dropbox
   - process resolution + requirement-cap computation
   - requirement progress application + consumption ledger recording
3. Remove non-deposit process dependency on `state.ownerInventories["inv:dropbox:process:*"]`.
4. Remove preview-owner materialization complexity from dropbox command path where not required for core flow.
5. Keep deposit instant-dropbox path intact for:
   - `inv:dropbox:hub:*`
   - process type `depositItems`
6. Standardize drop result reasons for UI:
   - `dropboxNoProcess`
   - `dropboxNoRecipeSelected` (if applicable)
   - `dropboxItemNotRequired`
   - `dropboxRequirementCapReached`
   - `dropboxLoaded`

## Phase 2: Drag-over Affordance UX
1. In `process-widget-pixi.js` `buildDropboxModule`, add persistent drag-state styling layer:
   - neutral/default
   - valid/green
   - invalid/red
   - capped/orange
2. In `inventory-pixi.js` drag-move path:
   - resolve current external drop target
   - if process/hub dropbox target, call `getProcessDropboxDragStatus`
   - set/clear dropbox affordance as pointer moves
3. On drag end/cancel:
   - always clear affordance state
4. Keep existing flash-on-failure behavior, but color-coded by reason where possible.

## Phase 3: Process Widget Refactor for Smaller “Black Box” Units
1. Extract drop-target and window-hit logic:
   - `src/views/process-widget/drop-target-registry.js`
   - includes target registration, lookup, bounds fallback, flash/affordance hooks
2. Extract window lifecycle orchestration:
   - `src/views/process-widget/window-manager.js`
   - includes ensure/hide/destroy/update visibility/pinning
3. Extract hover + focus + tooltip lozenge logic:
   - `src/views/process-widget/endpoint-hover-ui.js`
4. Extract selection dropdown into reusable component:
   - `src/views/components/selection-dropdown-pixi.js`
5. Keep `createProcessWidgetView` as composition root only.

## Phase 4: Owner-ID Protocol Consolidation
1. Add `src/model/owner-id-protocol.js` with canonical parse/build helpers for:
   - `inv:dropbox:process:*`
   - `inv:dropbox:hub:*`
   - pool endpoint owner encodings as needed
2. Replace scattered `startsWith(...)` checks in:
   - `inventory-commands.js`
   - `owner-acceptance.js`
   - `ui-root-pixi.js`
   - `inventory-pixi.js`
   - `process-widget-pixi.js`

### Test Cases and Scenarios

## Automated
1. Extend `scripts/test-process-dropbox.mjs`:
   - valid drop immediately increases requirement progress
   - no non-deposit dropbox inventory accumulation
   - capped returns capped reason
   - wrong item returns invalid reason
   - deposit instant dropbox remains unchanged
2. Add targeted tests for pure hover evaluator:
   - `valid` / `invalid` / `capped` status mapping
3. Keep `npm run verify` as gate.

## Manual
1. Start game, select recipe, drag required item:
   - dropbox turns green before release
   - material progress updates immediately after drop
   - work starts next `tSec`
2. Drag non-required item:
   - dropbox turns red
   - drop rejected
3. Fill requirement completely, drag more of same item:
   - dropbox turns orange
   - additional drop rejected as capped
4. Deposit systems (granary/altar):
   - still instant-load and highlight behavior remains correct

### Cleanup Targets (Redundant / Messy Pathways)
1. Remove dead/legacy dropbox inventory migration paths once no longer needed.
2. Remove nearest-target permissive fallback if strict hit-testing + robust bounds fallback is sufficient.
3. Remove dropbox slot “open inventory window” interaction for non-deposit process dropboxes.
4. Remove duplicate requirement-progress helpers by consolidating in one module used by command/routing code.

### Assumptions and Defaults Chosen
1. “Preview process owner” complexity is reduced unless strictly needed for selected-recipe immediate flow.
2. Non-deposit process dropboxes are conceptual endpoints, not inventory windows.
3. Orange state means “item type is valid but requirement currently full.”
4. Strict, deterministic drop-target resolution is preferred over permissive nearest fallback.
5. Refactor is done without backward compatibility shims for old save structures.

### Delivery Order
1. Phase 1 model simplification.
2. Phase 2 drag affordance UX.
3. Phase 3 process-widget modular split.
4. Phase 4 owner-id protocol consolidation.
5. Verify and manual pass after each phase.
