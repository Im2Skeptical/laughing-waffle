“Before coding, read AGENTS.md and ai-context.md, summarize key constraints, then proceed.”

# Implementation Prompt: Scroll Timegraphs V1

Use `ai/scroll-timegraph-goals.md` as the authoritative specification. Implement the feature end-to-end in this repo with full source access.

## Non-Negotiable Requirements

1. Scroll graphs open/close via click/tap on scroll items (basket-style interaction intent), while drag remains functional.
2. Add `grain` as an additional gameplay metric/resource; do not do a broad `gold -> grain` rename migration.
3. Timegraphs should be accessed through scroll items as the default player path.
4. Add a graph close button in the timegraph header, and move existing `Focus` button left.

## Deliverable Scope

1. Add V1 scroll item defs (20 items: 5 types x 4 subjects).
2. Add matching V1 recipes (20 recipes).
3. Ensure recipe availability in progression defaults (or explicit unlock nodes if you choose to gate).
4. Implement inventory interaction for scroll use (click/tap toggle open/close).
5. Implement graph orchestration per scroll behavior type.
6. Implement grain metric/resource tracking and graph support while leaving gold intact.
7. Update affected tests and definitions.

## Implementation Guidance

### A. Content defs

1. Update `src/defs/gamepieces/item-defs.js`
- Add scroll item kinds for:
  - prophecy/almanac/record/history/scripture x population/grain/food/systems.
- Use `maxStack: 1` for all scrolls.
- Add clear tooltip lines indicating click/tap to open.
- Store timegraph config fields in item state for deterministic behavior.
- Add defs-backed default constants for `120 tSec` horizon/window values.

2. Update `src/defs/gamepieces/recipes-defs.js`
- Add one recipe per scroll variant (20 total).
- Keep recipe structure simple and deterministic.

3. Update skill progression defaults in `src/defs/gamepieces/skill-tree-defs.js`
- Make new recipes available for V1 testing/feature use.

### B. Scroll interaction in inventory

1. Update `src/views/inventory-pixi.js`
- Add item-use callback plumbing (`onUseItem` style) and invoke it on click/tap resolution.
- Preserve existing drag and split-stack behavior.
- Implement click/tap resolution in a way consistent with existing basket interaction expectations.

2. Update `src/views/ui-root-pixi.js`
- Wire the new inventory item-use callback.
- Route scroll use to graph-open logic.

### C. Graph behavior orchestration

1. Add a dedicated helper module (recommended under `src/views/ui-root/`) for resolving scroll config -> graph behavior.
2. Implement behavior by type:
- `prophecy`: manufacture-anchored frozen projection window `[manufacturedSec, manufacturedSec + horizonSec]`
- `almanac`: manufacture-anchored live projection window `[manufacturedSec, manufacturedSec + horizonSec]`
- `record`: manufacture-anchored frozen history window `[manufacturedSec - historyWindowSec, manufacturedSec]`
- `history`: full historical record from tSec 0
- `scripture`: rolling editable revision graph within window, constrained by existing runner editable-history bounds policy
3. `systems` subject should open existing system graph path.
4. Remove/disable direct HUD metric-click graph opening as the default entry path.
5. Update timegraph header controls in `src/views/timegraphs-pixi.js`:
- Move `Focus` button to left side of header.
- Add `Close` button on right side that calls existing close behavior.

### D. Manufacture timestamp requirements

1. For prophecy/almanac/record outputs, persist `manufacturedSec` at craft completion time.
2. Do not set manufacture-anchor requirements for history/scripture.
3. Ensure serialization/replay determinism of this field.

### E. Grain metric addition (gold retained)

Implement `grain` as an additive metric/resource:

1. Update graph metric definitions:
- `src/model/graph-metrics.js`
- `src/model/projection.js`
- `src/model/timegraph/*` fallback references if needed so grain is fully supported.

2. Update state/bootstrap/scenario defaults that define gameplay resources:
- `src/model/state.js`
- `src/model/init.js`
- `src/defs/gamesettings/scenarios-defs.js`
- relevant gameplay-resource def files so `grain` is tracked.
- do not remove `gold` keys unless explicitly required by failing logic.

3. Update HUD labels/handlers only as needed for grain visibility:
- `src/views/chrome-pixi.js`
- `src/views/ui-root-pixi.js` graph controller/view wiring.

4. Update tests and determinism fixtures for new grain support:
- `scripts/test-*.mjs`
- `src/model/tests/*` as needed.


## Verification Requirements

After edits:

1. Run:
```powershell
npm run verify
```

2. If env defs were changed and strict gating is relevant, also run:
```powershell
set STRICT_ENV_DEFS=1 && npm run test
```

## Output Requirements

At completion, provide:

1. A concise summary of implemented behavior.
2. A file-by-file change list with purpose.
3. Test results from `npm run verify` (and strict env test if run).
4. Any deviations from `ai/scroll-timegraph-goals.md`, with reasons.
