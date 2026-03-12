import assert from "node:assert/strict";

import {
  getLiveUiTimeSec,
  shouldSnapProgressAnimation,
  stepAnimatedRatio,
} from "../src/views/ui-helpers/progress-animation.js";
import { getHubRecipeRowSignature } from "../src/views/board/hub-tag-ui.js";

function testGetLiveUiTimeSec() {
  assert.equal(
    getLiveUiTimeSec({ tSec: 3, simStepIndex: 210 }),
    3.5,
    "live UI time should use fractional simStepIndex when it matches tSec"
  );
  assert.equal(
    getLiveUiTimeSec({ tSec: 3, simStepIndex: 250 }),
    3,
    "live UI time should fall back to integer tSec when simStepIndex is inconsistent"
  );
}

function testShouldSnapProgressAnimation() {
  assert.equal(
    shouldSnapProgressAnimation(null, { tSec: 0, simStepIndex: 0, paused: false }),
    true,
    "missing previous sample should snap"
  );
  assert.equal(
    shouldSnapProgressAnimation(4.25, { tSec: 4, simStepIndex: 255, paused: true }),
    true,
    "paused state should snap"
  );
  assert.equal(
    shouldSnapProgressAnimation(4.25, { tSec: 3, simStepIndex: 180, paused: false }),
    true,
    "backward time travel should snap"
  );
  assert.equal(
    shouldSnapProgressAnimation(2.2, { tSec: 4, simStepIndex: 240, paused: false }),
    true,
    "large forward jumps should snap"
  );
  assert.equal(
    shouldSnapProgressAnimation(2.2, { tSec: 2, simStepIndex: 140, paused: false }),
    false,
    "normal live advancement should not snap"
  );
}

function testStepAnimatedRatio() {
  const next = stepAnimatedRatio(0.2, 0.8, 1 / 60);
  assert.ok(next > 0.2 && next < 0.8, "animated ratio should move toward target");

  const clamped = stepAnimatedRatio(-1, 2, 1 / 60, { snap: true });
  assert.equal(clamped, 1, "snap mode should clamp directly to the target ratio");

  const settled = stepAnimatedRatio(0.7999, 0.8, 1 / 30);
  assert.ok(
    settled >= 0.7999 && settled <= 0.8,
    "animated ratio should approach target monotonically"
  );
}

function testHubRecipeRowSignature() {
  const baseRows = [
    {
      kind: "recipeRequirement",
      recipeId: "berryMeal",
      index: 0,
      amount: 2,
      progress: 0,
      label: "Berries",
    },
    {
      kind: "recipeLabor",
      recipeId: "berryMeal",
      mode: "work",
      duration: 5,
      progress: 1,
    },
  ];
  const progressOnlyRows = [
    {
      kind: "recipeRequirement",
      recipeId: "berryMeal",
      index: 0,
      amount: 2,
      progress: 2,
      label: "Berries",
    },
    {
      kind: "recipeLabor",
      recipeId: "berryMeal",
      mode: "work",
      duration: 5,
      progress: 4,
    },
  ];
  const shapeChangedRows = [
    {
      kind: "recipeRequirement",
      recipeId: "berryMeal",
      index: 0,
      amount: 3,
      progress: 2,
      label: "Berries",
    },
    {
      kind: "recipeLabor",
      recipeId: "berryMeal",
      mode: "work",
      duration: 5,
      progress: 4,
    },
  ];

  assert.equal(
    getHubRecipeRowSignature("cook", baseRows),
    getHubRecipeRowSignature("cook", progressOnlyRows),
    "recipe row signature should ignore live progress changes"
  );
  assert.notEqual(
    getHubRecipeRowSignature("cook", baseRows),
    getHubRecipeRowSignature("cook", shapeChangedRows),
    "recipe row signature should change when row shape changes"
  );
}

testGetLiveUiTimeSec();
testShouldSnapProgressAnimation();
testStepAnimatedRatio();
testHubRecipeRowSignature();

console.log("test-tag-progress-animation: ok");
