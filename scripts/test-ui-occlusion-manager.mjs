import assert from "node:assert/strict";

import { createInteractionController } from "../src/views/interaction-controler-pixi.js";
import { createUiOcclusionManager } from "../src/views/ui-root/ui-occlusion-manager.js";

{
  const occlusion = createUiOcclusionManager();
  occlusion.registerProvider(() => [
    { x: 10, y: 20, width: 100, height: 50 },
    null,
    { x: 0, y: 0, width: 0, height: 20 },
  ]);
  occlusion.registerProvider(() => [{ x: 200, y: 30, width: 40, height: 40 }]);

  const rects = occlusion.getRects();
  assert.equal(rects.length, 2);
  assert.deepEqual(rects[0], { x: 10, y: 20, width: 100, height: 50 });
  assert.deepEqual(rects[1], { x: 200, y: 30, width: 40, height: 40 });

  assert.equal(occlusion.isOccluded({ x: 15, y: 25 }), true);
  assert.equal(occlusion.isOccluded({ x: 210, y: 35 }), true);
  assert.equal(occlusion.isOccluded({ x: 160, y: 25 }), false);
}

{
  const interaction = createInteractionController({
    getPhase: () => "planning",
  });
  const occlusion = createUiOcclusionManager();
  occlusion.registerProvider(() => [{ x: 50, y: 60, width: 120, height: 80 }]);

  interaction.setWorldUiOcclusionResolver((point) => occlusion.isOccluded(point));

  interaction.setPointerStagePos({ x: 10, y: 10 });
  assert.equal(interaction.canShowWorldHoverUI(), true);

  interaction.setPointerStagePos({ x: 80, y: 90 });
  assert.equal(interaction.isWorldUiOccludedAt(), true);
  assert.equal(interaction.canShowWorldHoverUI(), false);

  interaction.startDrag({ type: "window", id: "test" });
  interaction.setPointerStagePos({ x: 10, y: 10 });
  assert.equal(interaction.canShowHoverUI(), false);
  assert.equal(interaction.canShowWorldHoverUI(), false);
  interaction.endDrag();
}

console.log("[test] UI occlusion manager OK");
