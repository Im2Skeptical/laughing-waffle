import assert from "node:assert/strict";

import {
  clampCameraToBounds,
  computeScreenPointForWorldPoint,
  computeWorldPointAtScreenPoint,
  computeZoomAtPoint,
  isPointInsideRect,
  resolvePanBounds,
} from "../src/views/playfield-camera.js";

function assertClose(actual, expected, epsilon = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${expected}, got ${actual}`
  );
}

{
  const camera = { scale: 1.25, x: 140, y: -60 };
  const screenPoint = { x: 512, y: 333 };
  const worldPoint = computeWorldPointAtScreenPoint(screenPoint, camera);
  const screenRoundTrip = computeScreenPointForWorldPoint(worldPoint, camera);
  assertClose(screenRoundTrip.x, screenPoint.x);
  assertClose(screenRoundTrip.y, screenPoint.y);
}

{
  const camera = { scale: 1, x: 0, y: 0 };
  const anchor = { x: 480, y: 270 };
  const worldBefore = computeWorldPointAtScreenPoint(anchor, camera);
  const next = computeZoomAtPoint(camera, anchor, 1.5, {
    minZoom: 0.75,
    maxZoom: 1.8,
  });
  const worldAfter = computeWorldPointAtScreenPoint(anchor, next);
  assertClose(worldAfter.x, worldBefore.x);
  assertClose(worldAfter.y, worldBefore.y);
}

{
  const start = { scale: 1.2, x: -90, y: 45 };
  const anchor = { x: 620, y: 410 };
  const zoomed = computeZoomAtPoint(start, anchor, 0.6, {
    minZoom: 0.75,
    maxZoom: 1.8,
  });
  assert.equal(zoomed.scale, 0.75);
}

{
  const rect = { x: 10, y: 20, width: 100, height: 80 };
  assert.equal(isPointInsideRect({ x: 15, y: 25 }, rect), true);
  assert.equal(isPointInsideRect({ x: 9, y: 25 }, rect), false);
  assert.equal(isPointInsideRect({ x: 15, y: 101 }, rect), false);
}

{
  const bounds = resolvePanBounds({
    panBounds: {
      width: 2424 * 2,
      height: 1080 * 2,
      centerX: 2424 * 0.5,
      centerY: 1080 * 0.5,
    },
  });
  const clamped = clampCameraToBounds(
    { scale: 1, x: 9999, y: 9999 },
    { width: 2424, height: 1080 },
    bounds
  );
  assert.equal(clamped.x, 1212);
  assert.equal(clamped.y, 540);
}

console.log("[test] Playfield camera math OK");
