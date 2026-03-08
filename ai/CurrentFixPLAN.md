# Plan: Fix Discovery Visibility and Frontier Movement for `devPlaytesting01`

## Summary
Refine the hidden-frontier onboarding flow so it behaves consistently with skill unlocks and board discovery.

Two concrete corrections are required:
1. Revealed tile tags should only appear when the run has globally unlocked that tag. `Explore` and `Delve` are special onboarding tags and must bypass normal unlock gating.
2. Pawn movement onto newly exposed frontier tiles must use the visible-board layout everywhere, including the top-level drop-target resolver in `ui-root-pixi`, not just the pawn/board subviews.

This keeps the current global unlock model and avoids introducing pawn-specific tag visibility.

## Current Findings
- The movement failure is caused by [ui-root-pixi.js](d:/Misc/IdleGameIdea%20-%20Civilization%20Survivor/laughing-waffle/src/views/ui-root-pixi.js) still resolving pawn drop targets against the full authoritative board width (`12` cols) using the old `getBoardColumnCenterX` path.
- The board and pawn views already use visible-column layout helpers, so the drag ghost and rendered cards can disagree with the actual drop target.
- Tag visibility currently hides non-`explore` tags while a tile is unrevealed, but after reveal it still relies on the normal env-tag unlock path. Because `explore`/`delve` also go through that same path, they need an explicit bypass.
- Current unlock infrastructure is global to the run (`hasEnvTagUnlock(state, tagId)`), not per-pawn. The chosen policy is to keep that model.

## Chosen Behavior
- `Explore` and `Delve` are always visible/usable when present on a tile, regardless of skill unlock state.
- All other env tags on a revealed tile are shown only if globally unlocked for the run.
- Unrevealed tiles still show only `Explore`.
- Movement to exposed tiles is allowed as soon as `discovery.envCols[col].exposed === true`.
- Hidden/unexposed tiles remain non-targetable for drag/drop and command placement.
- No per-pawn tag visibility model is introduced.

## Important API / Interface / Type Changes
- No new state shape is required.
- Introduce a small view-only notion of “always-visible discovery tags”:
  - likely a local constant such as `DISCOVERY_ALWAYS_VISIBLE_ENV_TAG_IDS = new Set(["explore", "delve"])`
- Reuse existing discovery helpers:
  - `getVisibleEnvColCount(state)`
  - `isEnvColExposed(state, col)`
  - `isEnvColRevealed(state, col)`

## Implementation Changes

### 1. Env tag visibility policy
Patch env tag visibility in:
- [board-pixi.js](d:/Misc/IdleGameIdea%20-%20Civilization%20Survivor/laughing-waffle/src/views/board-pixi.js)
- [board-tag-ui.js](d:/Misc/IdleGameIdea%20-%20Civilization%20Survivor/laughing-waffle/src/views/board/board-tag-ui.js)
- [tag-orders-panel.js](d:/Misc/IdleGameIdea%20-%20Civilization%20Survivor/laughing-waffle/src/views/board/tag-orders-panel.js)

Rules:
- `explore` and `delve` bypass `hasEnvTagUnlock`.
- Other tags require:
  - tile is revealed
  - tag is not hidden by tag-state
  - tag is globally unlocked
  - tag is not player-disabled
- Orders panel should not list locked tags or hidden unrevealed tags.
- `Delve` remains visible only when present on the tile and after the Levee reveal removed the unrevealed mask.

### 2. UI-root pawn drop target alignment
Patch [ui-root-pixi.js](d:/Misc/IdleGameIdea%20-%20Civilization%20Survivor/laughing-waffle/src/views/ui-root-pixi.js) so `onPawnDropped(...)` uses discovery-aware visible widths and visible-column center calculations instead of full-board helpers.

Required behavior:
- For env row targeting, compute `envCols` from `getVisibleEnvColCount(runner.getState())`.
- For hub row targeting, compute `hubCols` as `0` while hidden and full slot count once visible.
- Use the same visible-column center math as the updated board/pawn views.
- Do not use `getBoardColumnCenterX` / `getHubColumnCenterX` directly for discovery-concealed layouts.

Recommended implementation:
- Extract or duplicate the same visible-column layout math already used in `board-pixi` / `pawns-pixi`.
- Keep it view-only. Do not mutate model state here.

### 3. Planner-side placement validation
Patch [action-planner.js](d:/Misc/IdleGameIdea%20-%20Civilization%20Survivor/laughing-waffle/src/controllers/actionmanagers/action-planner.js) so planner intent creation rejects hidden targets early.

Add discovery-aware validation to:
- `setPawnMoveIntent`
- `buildPawnMoveIntentForPreview`
- affordability preview if needed

Rules:
- Env move intent to hidden col returns a discovery-aware failure such as `envColHidden`.
- Hub move intent while hub is hidden returns `hubHidden`.
- This should mirror [pawn-skill-commands.js](d:/Misc/IdleGameIdea%20-%20Civilization%20Survivor/laughing-waffle/src/model/commands/pawn-skill-commands.js), so planner preview and command execution agree.

### 4. Centralize visible-board geometry if practical
To reduce repeat drift, introduce a small shared view helper or local utility for:
- visible env col count
- visible hub col count
- visible board column center X
- visible hub column center X

Good target:
- either a new lightweight helper under `src/views/`
- or move enough of the duplicated visible-column math into [layout-pixi.js](d:/Misc/IdleGameIdea%20-%20Civilization%20Survivor/laughing-waffle/src/views/layout-pixi.js)

Constraint:
- keep it view-only; do not pull UI concepts into the model.

### 5. Preserve current onboarding semantics
Do not change:
- process durations
- discovery state structure
- sample-drop package behavior
- Temple Ruins rebuild flow
- rename sync behavior
- global unlock system

## Test Cases and Scenarios

### Discovery visibility
- Initial state:
  - tile `0` shows `Explore`
  - tile `0` does not show `Forage` / `Herd`
  - tile `1+` not rendered
- After first explore:
  - tile `0` reveals title
  - only globally unlocked tags on tile `0` appear
  - tile `1` appears as `???` with `Explore`
  - `Ancient Ruins` marker appears
- After Levee explore:
  - tile `1` reveals
  - `Delve` appears even if normal env unlock checks would hide it
  - locked non-onboarding tags remain hidden

### Frontier movement
- Start state:
  - pawn can only target visible env col `0`
  - dragging toward hidden cols does not resolve to hidden targets
- After first explore:
  - dragging to visible env col `1` creates a move intent to absolute col `1`
  - move preview/ghost label matches the visible tile
  - command execution succeeds
- Planner parity:
  - if a drop is mapped to a hidden col, preview rejects with the same reason command execution would reject
- Hub reveal:
  - before `Delve`, hub drop targets do not exist
  - after `Delve`, hub drop targets resolve correctly against visible hub columns

### Regression coverage
Update or add tests to cover:
- discovery-tag visibility policy for `explore` / `delve`
- drag/drop targeting after visible env width changes from `1` to `2`
- planner preview parity with command placement on exposed vs hidden cols
- `devPlaytesting01` sequence still passes end-to-end

## Verification
- Run `set STRICT_ENV_DEFS=1 && npm run test`
- Run `npm run verify`

## Assumptions and Defaults Chosen
- “Pawn has access” means current global run unlocks, not per-pawn unlock ownership.
- `Explore` and `Delve` are onboarding exceptions and must bypass normal env-tag unlock gating.
- Discovery-concealed movement should be blocked in both preview and execution, with matching reasons.
- No new save migration work is needed beyond existing prototype tolerance.
