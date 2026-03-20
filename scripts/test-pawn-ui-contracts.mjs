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
  /dropdownOffsetY:\s*-26/,
  "[test] pawn layout config should expose the dropdown vertical offset"
);
assert.match(
  pawnsSource,
  /dropdownSectionState:\s*isLeader[\s\S]*systems:\s*false[\s\S]*equipment:\s*false[\s\S]*skills:\s*false/,
  "[test] pawn menu should default leader sections to collapsed"
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
