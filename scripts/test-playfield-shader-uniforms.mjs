import assert from "node:assert/strict";

import {
  computeTimeWarp,
  getVisualTimeSec,
} from "../src/views/filters/mucha-time-uniforms.js";
import {
  computeProfileAnimationWarp,
  normalizeMuchaStyleConfig,
} from "../src/views/playfield-mucha-style.js";

function assertClose(actual, expected, epsilon = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${expected}, got ${actual}`
  );
}

{
  const value = getVisualTimeSec({ tSec: 12, simStepIndex: 12 * 60 + 30 });
  assertClose(value, 12.5);
}

{
  const value = getVisualTimeSec({ tSec: 12, simStepIndex: 11 * 60 + 30 });
  assert.equal(value, 12);
}

{
  const value = getVisualTimeSec({ tSec: 7 });
  assert.equal(value, 7);
}

{
  const warp = computeTimeWarp({
    state: { tSec: 100 },
    timeline: { historyEndSec: 100 },
    preview: { active: false },
  });
  assert.equal(warp.warp, 0);
  assert.equal(warp.isFrontierView, true);
}

{
  const warp = computeTimeWarp({
    state: { tSec: 80 },
    timeline: { historyEndSec: 100 },
    preview: { active: false },
    driftWindowSec: 100,
    historyBoost: 0.18,
  });
  assertClose(warp.normalizedDistance, 0.2);
  assertClose(warp.warp, 0.38);
  assert.equal(warp.isHistoryView, true);
}

{
  const history = computeTimeWarp({
    state: { tSec: 80 },
    timeline: { historyEndSec: 100 },
    preview: { active: false },
    driftWindowSec: 100,
    historyBoost: 0.18,
  });
  const forecast = computeTimeWarp({
    state: { tSec: 80 },
    timeline: { historyEndSec: 100 },
    preview: { active: true, previewSec: 130, isForecastPreview: true },
    driftWindowSec: 100,
    forecastBoost: 0.35,
  });
  assert.ok(forecast.warp > history.warp);
  assert.equal(forecast.isForecastPreview, true);
}

{
  const warp = computeTimeWarp({
    state: { tSec: -1 },
    timeline: { historyEndSec: -10 },
    preview: { active: true, previewSec: -5, isForecastPreview: false },
    driftWindowSec: 0,
    historyBoost: 3,
    forecastBoost: 3,
  });
  assert.ok(warp.warp >= 0 && warp.warp <= 1);
  assert.ok(warp.normalizedDistance >= 0 && warp.normalizedDistance <= 1);
}

{
  const cfg = normalizeMuchaStyleConfig({
    intensity: 1.4,
    mottling: 0.9,
    warmth: 0.7,
    grain: 0.8,
    colorBleed: 0.25,
    profiles: {
      topbar: {
        intensity: 0.5,
        alwaysAnimated: true,
      },
    },
  });
  assert.equal(cfg.profiles.playfield.intensity, 1.4);
  assert.equal(cfg.profiles.playfield.mottling, 0.9);
  assert.equal(cfg.profiles.playfield.misregister, 0.25);
  assert.equal(cfg.profiles.backdrop.alwaysAnimated, true);
  assert.equal(cfg.profiles.topbar.intensity, 0.5);
  assert.equal(cfg.profiles.topbar.alwaysAnimated, true);
}

{
  const cfg = normalizeMuchaStyleConfig({
    profiles: {
      backdrop: {
        intensity: 9,
        vignetteInner: 0.95,
        vignetteOuter: 0.1,
        wobbleScale: 0,
        misregisterMode: 0.2,
      },
    },
  });
  assert.equal(cfg.profiles.backdrop.intensity, 1.5);
  assert.equal(cfg.profiles.backdrop.wobbleScale, 0.1);
  assert.equal(cfg.profiles.backdrop.misregisterMode, 0);
  assert.ok(
    cfg.profiles.backdrop.vignetteOuter > cfg.profiles.backdrop.vignetteInner
  );
}

{
  const frontierWarp = computeProfileAnimationWarp(0, false);
  const animatedWarp = computeProfileAnimationWarp(0, true);
  assert.equal(frontierWarp, 0);
  assert.ok(animatedWarp > 0);
}

console.log("[test] Playfield shader time uniforms OK");
