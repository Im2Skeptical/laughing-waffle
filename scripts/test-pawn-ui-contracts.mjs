import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const inventorySource = await readFile("src/views/inventory-pixi.js", "utf8");
const pawnsSource = await readFile("src/views/pawns-pixi.js", "utf8");
const uiRootSource = await readFile("src/views/ui-root-pixi.js", "utf8");
const debugOverlaySource = await readFile("src/views/debug-overlay-pixi.js", "utf8");

assert.match(
  inventorySource,
  /getExternalEquipmentSlotAt\s*=\s*null/,
  "[test] inventory view should accept external equipment slot hit-testing"
);
assert.match(
  inventorySource,
  /beginDragExternalEquippedItem:\s*\(\{/,
  "[test] inventory view should expose external equipped-item dragging"
);
assert.match(
  inventorySource,
  /const leader = null;/,
  "[test] pawn inventory windows should no longer build embedded leader panels"
);
assert.match(
  pawnsSource,
  /showOnHover\?\.\(pawnData\.id,\s*buildPawnInventoryAnchor\(view\)\)/,
  "[test] pawn hover should restore hover-open inventory windows"
);
assert.match(
  pawnsSource,
  /hideOnHoverOut\?\.\(pawnData\?\.id\)/,
  "[test] pawn hover teardown should release hover-open inventory windows"
);
assert.match(
  pawnsSource,
  /dropdownHideDelayMs:\s*260/,
  "[test] pawn layout config should expose the hover grace window"
);
assert.match(
  pawnsSource,
  /dropdownOffsetY:\s*-?\d+/,
  "[test] pawn layout config should expose the dropdown vertical offset"
);
assert.match(
  pawnsSource,
  /tooltipGap:\s*\d+/,
  "[test] pawn layout config should expose tooltip positioning controls"
);
assert.match(
  pawnsSource,
  /inventoryGap:\s*\d+/,
  "[test] pawn layout config should expose inventory positioning controls"
);
assert.match(
  pawnsSource,
  /getLeaderInventorySectionCapabilities/,
  "[test] pawn dropdown should consult leader inventory section capabilities"
);
assert.match(
  pawnsSource,
  /const sectionCaps =[\s\S]*getPawnDropdownSectionCapabilities\(state,\s*pawnData\)/,
  "[test] pawn dropdown should derive leader section gating from current state"
);
assert.match(
  pawnsSource,
  /if \(!sectionCaps\.skills\) view\.dropdownSectionState\.skills = false;/,
  "[test] pawn dropdown should collapse locked skill sections"
);
assert.match(
  pawnsSource,
  /showLeaderSection\("skills"\) && view\.dropdownSectionState\.skills === true/,
  "[test] pawn dropdown should only render leader skill content when unlocked"
);
assert.match(
  pawnsSource,
  /showLeaderSection\("prestige"\) && view\.dropdownSectionState\.prestige === true/,
  "[test] pawn dropdown should only render prestige content when unlocked"
);
assert.match(
  pawnsSource,
  /showLeaderSection\("build"\) && view\.dropdownSectionState\.build === true/,
  "[test] pawn dropdown should only render build content when unlocked"
);
assert.match(
  pawnsSource,
  /dropdownSectionState:\s*isLeader[\s\S]*systems:\s*false[\s\S]*equipment:\s*false[\s\S]*skills:\s*false/,
  "[test] pawn menu should default leader sections to collapsed"
);
assert.doesNotMatch(
  pawnsSource,
  /renderDropdownSectionHeader\(view\.dropdownContent,\s*"skills",\s*"Skills",\s*8,\s*cursorY,\s*innerWidth\);\s*cursorY \+= 26;\s*if \(view\.dropdownSectionState\.skills === true\)/,
  "[test] pawn dropdown should not render skills unconditionally"
);
assert.match(
  pawnsSource,
  /buildPawnTooltipAnchor\(view\)/,
  "[test] pawn tooltip should use a dedicated top-aligned anchor"
);
assert.match(
  pawnsSource,
  /buildPawnInventoryAnchor\(view\)/,
  "[test] pawn inventory should use a dedicated top-aligned anchor"
);
assert.match(
  pawnsSource,
  /interactionSafe\.getPointerStagePos\?\.\(\) \?\? null/,
  "[test] pawn dropdown hide should consult current pointer position"
);
assert.match(
  pawnsSource,
  /function drawBubbleMeter\(bubble,\s*bubbleSpec\)/,
  "[test] pawn bubbles should render a dedicated meter fill"
);
assert.match(
  pawnsSource,
  /fillGraphics\.mask = fillMask;/,
  "[test] pawn bubbles should clip fill graphics with a mask"
);
assert.match(
  pawnsSource,
  /bubble\.valueBadge\.visible =[\s\S]*activeSpec\?\.hoverText/,
  "[test] pawn bubble hover should reveal a current-max value badge when available"
);
assert.match(
  pawnsSource,
  /fillRatio:\s*bubble\.fillRatio[\s\S]*hoverText:\s*bubble\.hoverText/,
  "[test] pawn bubble redraws should react to meter ratio and hover text changes"
);
assert.match(
  pawnsSource,
  /getPawnBubbleSpecs\(pawnData,\s*getStateSafe\(\),\s*\{[\s\S]*hoverActive:\s*view\.selfHover\s*===\s*true[\s\S]*\}\)/,
  "[test] pawn bubbles should key off hover state"
);
assert.match(
  pawnsSource,
  /beginDragExternalEquippedItem\?\.\(\{/,
  "[test] pawn dropdown equipment should delegate dragging to inventory view"
);
assert.match(
  pawnsSource,
  /function getEquipmentSlotAtGlobalPos\(globalPos\)/,
  "[test] pawn dropdown should expose equipment slot hit targets"
);
assert.match(
  uiRootSource,
  /getExternalEquipmentSlotAt:\s*\(pos\)\s*=>\s*pawnsView\?\.getEquipmentSlotAtGlobalPos\?\.\(pos\) \?\? null/,
  "[test] ui root should wire pawn dropdown slots into inventory drag logic"
);
assert.match(
  debugOverlaySource,
  /Raw Inspector: OFF/,
  "[test] debug overlay should expose raw inspector toggle"
);

console.log("[test] Pawn UI contract checks passed");
