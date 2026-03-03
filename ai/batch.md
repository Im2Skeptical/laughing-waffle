
Plan

Plan: Housing/Tag/Process/Graph UX Overhaul
Summary
Implement 8 coordinated UI/controller updates across board cards, tag rows, process widget recipe priority, timegraph header controls, and skill-tree save feedback.
All changes stay deterministic and replay-safe by keeping simulation/model logic unchanged (or read-only consumption of existing model state), with behavior implemented in view/controller layers.

Impact Analysis (Determinism, Serialization, Replay, Layering)
Determinism: No Math.random() use. No stochastic logic added.
Serialization: No non-serializable state added to GameState; new state is view-local only.
Replay: rebuildStateAtSecond(tSec) remains authoritative; UI reads existing state and does not mutate sim state outside existing action dispatches.
Layering: Changes are in views/controllers (board, process-widget, timegraphs, skill-tree) and keep model/UI boundaries intact.
DSL-first: No gamepiece behavior logic change required; no bespoke model behavior needed for these requests.
Public/Internal Interface Changes
createMetricGraphView(...) and createRunnerMetricGraph(...) will accept optional system-target-mode header control hooks:
getSystemTargetModeLabel?: () => string
onToggleSystemTargetMode?: () => void
createBoardView(...) will accept optional callback:
onGamepieceTapForSystemFocus?: (target) => void
Hub tag row builder internals (hub-tag-ui) will add an explicit flag to suppress process open affordance for housing rows:
allowProcessWidgetOpen?: boolean (internal-only option)
Tag view instances (board + hub) will gain view-local overflow scroll fields:
tagScrollOffsetY, tagScrollMaxY, fade indicator nodes/mask refs
Implementation Plan
Housing tag process window lockout (canHouse)
Implement in src/views/board/hub-tag-ui.js by removing process-open affordances for the housing tag and its rows (residents, faith) so neither tag cog nor system icon click can open process windows.
Keep board-pixi process routing unchanged for all other tags/systems.
Acceptance: Housing tag never opens process widget from cog or icon, while non-housing process-capable tags continue to work.

Residents + faith display upgrades on hub structures
Implement in src/views/board/hub-tag-ui.js updateSystemRow(...):

residents: show population/capacity with bar ratio population / max(1, capacity).
faith: show tier badge strip + streak bar using existing faith tier (structure.systemTiers.faith) and streak from state.populationTracker.faithGrowthStreak against FAITH_GROWTH_STREAK_FOR_UPGRADE.
Also add faith UI constants and compact tier badge rendering in-row.
Acceptance: Housing rows show informative progress (residents count, faith tier + streak) instead of generic full bars.
Skill tree save button pending/commit feedback
Implement in src/views/skill-tree/button.js and src/views/skill-tree-pixi.js:

Add button variant styling API (idle, pending, saved, error).
Drive save button color by queue state (bufferUnlockIds.size > 0 => pending).
On successful save click, flash saved style briefly, then return to idle.
On failed save, set error style until next state change.
Acceptance: User gets immediate visual “pending changes” and “saved” feedback from button color transitions.
Always expand actively worked tag
Implement in src/views/board/board-tag-ui.js and src/views/board/hub-tag-ui.js:

Remove manual toggle persistence logic (hasTagToggle gating for expansion).
Recompute expandedTagId every update from active assignment (current worker-driven top active tag).
Keep drag-reorder behavior intact.
Acceptance: Expanded section follows currently active tag continuously; no stale expansion on inactive tags.
Process widget recipe card auto-follow + skipped red outline
Implement in src/views/process-widget-pixi.js:

Replace manual recipe focus persistence with auto-focus resolution each render:
Choose first enabled recipe that is progressable now (requirements complete).
Fallback to first enabled recipe.
Recipe priority pills: apply red outline state to enabled recipes above active focused recipe that are currently blocked by unmet requirements (“skipped for missing mats”).
Keep disabled recipes in existing disabled style.
Acceptance: Main recipe card always shows currently workable recipe; blocked higher-priority entries visually call out as skipped (red outline).
Timegraph system target mode toggle (Hover vs Click)
Implement across src/views/timegraphs-pixi.js, src/views/ui-root/graph-view-builders.js, src/views/ui-root-pixi.js, and src/views/board-pixi.js:

Add header button in system graph window: Target: Hover / Target: Click.
Mode behavior:
Hover: current behavior (toggleGraphForHover(..., { forceOpen: true })).
Click: target only updates when user clicks a gamepiece card; graph remains locked to clicked owner.
Wire board card taps to onGamepieceTapForSystemFocus(target) callback and resolve owner id to toggleGraphForOwner(..., { forceOpen: true }) when mode is click and graph is open.
Acceptance: User can explicitly switch between hover-follow targeting and click-to-lock targeting.
Hide flavor/orders until hover zoom, and enlarge zoom scale
Implement in src/views/board-pixi.js and src/views/layout-pixi.js:

Hide descriptive/flavor lines and Orders button while card is not hovered.
On hover (zoomed), show lines + Orders, then relayout tag/system area.
Increase hover zoom scale by +10% from 2.0 to 2.2 (GAMEPIECE_HOVER_SCALE).
Ensure no overlap regressions by recalculating tagStartY/tagMaxY on hover in/out.
Acceptance: Non-hover cards prioritize system details; hover reveals full card info and controls with adequate space.
Tag list overflow: scroll + fade hint + “more” indication
Implement in src/views/board/board-tag-ui.js, src/views/board/hub-tag-ui.js, and minimal wheel routing in src/views/board-pixi.js:

Replace hard-hide overflow behavior with masked scroll region for tag content.
Add top/bottom fade hints and bottom “more” indicator when clipped.
Add wheel scrolling for hovered card tag area; clamp to 0..maxScroll.
Reset scroll when context changes (new active tag, hover exit, rebuilt list).
Acceptance: Players can access full system list on crowded cards and can see clear indication when more content exists.
Test Cases and Scenarios
Housing process lockout
Hover/click housing tag cog and residents/faith icons on housing structures.
Confirm no process widget opens.
Confirm process widget still opens for cooking/crafting/build/deposit paths.
Residents/Faith row rendering
Housing active with varied population/capacity: verify residents bar text and ratio update.
Faith tier transitions and streak increments: verify badge and streak bar update from state.
Faith threshold edge: streak resets after upgrade/degrade outcome.
Skill save feedback
Queue skill unlocks and verify Save button enters pending color.
Click Save and verify saved color flash then idle.
Force save failure path (unpaused) and verify error color/state.
Active tag auto-expand
Reorder tags and move workers; verify expanded tag follows active tag each tick.
Verify no stale expansion when worker leaves or tag disabled.
Recipe auto-follow + skipped outlines
Create priority list where top recipe lacks materials and lower one is workable.
Verify card auto-focuses workable recipe.
Verify skipped blocked higher-priority entries are red outlined.
Verify behavior for growth/fireplace/workspace.
Timegraph target mode
Open system graph in Hover mode and confirm hover-follow works.
Switch to Click mode and confirm hover no longer retargets.
Click tile/hub cards and verify graph retargets clicked owner.
Switch back to Hover and confirm follow resumes immediately.
Card reveal behavior + zoom scale
Not hovered: lines/orders hidden.
Hovered: lines/orders visible and layout remains readable.
Validate no clipping/overlap on tile, hub, env structure cards.
Confirm hover scale increased to 2.2 and anchor/tooltips still align.
Overflow scroll UX
Force crowded tag/system content; verify fade hints and “more” indicator show.
Scroll wheel over hovered card tag area; verify smooth clamped scrolling.
Verify drag-reorder and row interactions still work with scroll offset.
Regression gates
Run npm run verify after implementation.
If env defs/types touched during implementation, run set STRICT_ENV_DEFS=1 && npm run test.
Assumptions and Defaults Locked In
Housing open behavior: disable all housing-based process opens.
Recipe focus: always auto-follow actively workable recipe (no sticky manual focus).
Card reveal trigger: reveal hidden details on hover zoom.
Faith visual: tier badges plus streak progress bar.
Active tag expansion: always follow active tag.
Timegraph toggle: explicit Hover/Click target mode button.
Skipped priority styling: any unmet requirements in higher-priority enabled recipe gets red outline when skipped.
Overflow behavior: scrollable list with fade hints and explicit “more” cue.
Hover scale change: +10% (2.0 -> 2.2).
