# Scroll-Timegraph Goals (V1)

## 1. Feature Summary

Timegraph access moves from direct HUD/resource clicks to crafted item artifacts ("scrolls").
In V1, players craft purpose-specific scrolls and click/tap the scroll item to toggle the related graph open/closed.

This document also includes a paired resource/metric expansion: add `grain` as a tracked resource/graph metric while retaining legacy `gold`.

## 2. Decisions Confirmed

1. Scroll interaction must mirror current basket-open interaction intent: simple click/tap toggles open/close, while drag still moves the item.
2. The second scroll type is `Almanac Scroll` (no `Literature Scroll` artifacts should be introduced).
3. `Grain` is added as an additional resource metric and graph subject.
4. `Gold` remains as legacy/test resource data and does not require migration in this feature.
5. Prophecy, Almanac, and Record scrolls are manufacture-date anchored.
6. Default horizon/window values are `120 tSec` and must be defined in defs (future tiering can modify them later).
7. V1 uses explicit per-subject recipes (population, grain, food, systems), not tag-driven dynamic recipe composition.

## 3. V1 Scroll Types

1. `Prophecy Scroll`
2. `Almanac Scroll`
3. `Record Scroll`
4. `History Scroll`
5. `Scripture Scroll`

## 4. V1 Subjects

1. `population`
2. `grain`
3. `food`
4. `systems` (universal systems graph)

Total first-pass outputs: `5 scroll types x 4 subjects = 20 scroll items + 20 recipes`.

## 5. Behavioral Contract Per Scroll Type

### 5.1 Prophecy Scroll
- Uses manufacture completion second as anchor (`manufacturedSec`).
- Displays only `manufacturedSec` through `manufacturedSec + horizonSec`.
- Frozen: values intentionally stay stale after manufacture (no live recompute updates).
- Non-editable.

### 5.2 Almanac Scroll
- Uses manufacture completion second as anchor (`manufacturedSec`).
- Displays only `manufacturedSec` through `manufacturedSec + horizonSec`.
- Live/updatable: reflects timeline changes within that fixed anchored range.
- Non-editable.

### 5.3 Record Scroll
- Uses manufacture completion second as anchor (`manufacturedSec`).
- Displays only `manufacturedSec - historyWindowSec` through `manufacturedSec`.
- Frozen/stale after manufacture.
- Non-editable.

### 5.4 History Scroll
- Historical record from tSec 0 through current time.
- No manufacture anchor requirement.
- Live-updating historical view.
- Non-editable.

### 5.5 Scripture Scroll
- Rolling revision window behavior (no manufacture anchor requirement).
- Live-updating.
- Commit/edit operations allowed only within editable window policy.
- Editable policy must honor existing runner logic based on `maxReachedHistoryEndSec` (via `getEditableHistoryBounds()`), so trivial repeated near-frontier edits do not extend unlimited backward edits.

## 6. Interaction and UX Requirements

1. Scrolls toggle graph open/close on click/tap of the item.
2. Drag behavior remains available; click/tap must not degrade inventory movement.
3. Interaction pattern should align with existing basket behavior expectations (click-ish open action distinct from intentional movement).
4. HUD resource clicks no longer act as the primary timegraph open path.
5. Tooltip/help text for scroll items must state the open interaction clearly.
6. Timegraph UI must include an explicit close button in the header.
7. Existing `Focus` button should be moved left to make room for the close button on the right.

## 7. Data and Content Requirements

### 7.1 Item defs
- Add new scroll item defs in `src/defs/gamepieces/item-defs.js`.
- All scrolls must be unique-instance items (`maxStack: 1`) so per-item timegraph state does not merge.
- Each scroll carries structured graph configuration in item state (scroll type, subject, horizon/window/edit policy, frozen/live flags, manufacture anchor policy where needed).
- Manufacture-anchored scrolls must store `manufacturedSec` at craft completion.

### 7.2 Recipe defs
- Add 20 recipes in `src/defs/gamepieces/recipes-defs.js`.
- Keep V1 recipe shape simple and deterministic.
- One recipe per scroll type + subject combination.

### 7.3 Skill progression defaults
- Ensure scroll recipes are unlockable in V1 by default progression settings, unless explicitly staged behind skill nodes.
- If gated, must include clear acceptance criteria and test coverage for unlock state.

## 8. Grain Metric Addition Goals

This is in scope for this feature pass.

1. Add `grain` as a first-class gameplay resource metric and graph metric.
2. Track `grain` in simulation/state and expose it to timegraph systems.
3. Keep `gold` data path intact as legacy/test resource support unless a specific follow-up task removes it.
4. Prefer grain-focused player-facing graph/scroll usage; gold graph path can remain but should be de-emphasized/ignored for this feature.
5. Keep tier vocabulary (`bronze/silver/gold/diamond`) unchanged in quality-tier systems.
6. Update scenarios/default state/bootstrap so `grain` is initialized and validated correctly.
7. Update tests/fixtures for new `grain` behavior without forcing removal of `gold`.

## 9. Technical Constraints

1. Determinism must be preserved.
2. Timeline/rebuild/projection correctness must remain intact.
3. State must remain JSON-serializable.
4. Model/View/Controller layering rules remain unchanged.
5. No destructive migration shims are required for old save compatibility in this prototype phase.

## 10. Acceptance Criteria

1. Players can craft and possess all 20 scroll variants.
2. Clicking/tapping a scroll item toggles the intended graph open/close.
3. Dragging scroll items still moves them; click/tap behavior does not break drag workflows.
4. Prophecy and Record scrolls stay intentionally stale after manufacture.
5. Prophecy/Almanac/Record ranges are anchored to `manufacturedSec` and do not slide.
6. Almanac and History scrolls update with timeline changes.
7. Scripture scroll enforces revision/editability constraints using existing `maxReachedHistoryEndSec`-based policy.
8. Timegraph header includes both `Focus` (left side) and `Close` (right side) controls.
9. Close button always closes the graph immediately.
10. Grain metric exists and is usable by grain scroll variants.
11. Gold metric/data remains intact (legacy/test) and is not a blocker for this feature.
12. No direct non-item access path remains as the default way to open player metric graphs.
13. `npm run verify` passes.

## 11. Out of Scope (V1)

1. Durability/consumption systems for scrolls.
2. Tier-scaled horizon or edit window balancing.
3. Dynamic recipe synthesis from consumed item tags.
4. Full redesign of system graph subject targeting beyond universal systems scroll entry.

## 12. Risks and Mitigations

1. Click-vs-drag ambiguity in inventory input.
- Mitigation: use a clear click/tap resolution path and preserve drag threshold/flow semantics.

2. Grain addition touching broader code than scroll feature itself.
- Mitigation: avoid broad rename; implement grain as additive metric and limit touches to required paths.

3. Hidden references to `resources.gold` in tests/debug UI.
- Mitigation: perform repository-wide reference sweep and update all gameplay-resource uses.

## 13. Done Definition

The feature is done when all acceptance criteria are met, verification passes, and the implementation summary documents:
1. Changed files and why.
2. Final scroll behavior matrix.
3. Any intentional deviations from this goals doc.
