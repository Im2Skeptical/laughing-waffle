// src/views/sunandmoon-disks-pixi.js
// Two rotating HUD disks: Moon cycle + Season cycle.
// Pure view module: reads state, never mutates it.

import {
  SEASON_DURATION_SEC,
  MOON_CYCLE_SEC,
  MOON_PHASE_OFFSET_SEC,
} from "../defs/gamesettings/gamerules-defs.js";

export const SUN_AND_MOON_DISKS_LAYOUT = {
  enabled: true,

  moon: {
    x: 1375,
    y: -10,
    scale: 0.5,
    alpha: 1.0,
    rotationOffsetRad: 3,
    clockwise: true,
    texturePath: "/images/MoonDisk_01.png",
  },

  season: {
    x: 1300,
    y: -10,
    scale: 0.75,
    alpha: 1.0,
    rotationOffsetRad: 0,
    clockwise: true,
    texturePath: "/images/SeasonDisk_01.png",
    quadrants: 4,
  },

  zIndex: 0,
};

// ----------------------------------------------------------------------------

function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function clampInt(v, fallback) {
  const n = Math.floor(v);
  return Number.isFinite(n) ? n : fallback;
}

function getTSecInt(state) {
  const t = Math.floor(state?.tSec ?? 0);
  return Number.isFinite(t) ? Math.max(0, t) : 0;
}

// Scrub correctness: prefer tSec (graph boundary time).
// Live smoothness: if simStepIndex is consistent with tSec, use it for fractional seconds.
function getTimeSecForRotation(state) {
  const tSec = getTSecInt(state);

  const steps = state?.simStepIndex;
  if (Number.isFinite(steps)) {
    const tf = Math.max(0, steps / 60);
    // Only trust simStepIndex if it corresponds to the same boundary second.
    if (Math.floor(tf) === tSec) return tf;
  }

  // Fallback: exact boundary time (scrub-safe)
  return tSec;
}

function phase01ToRotationRad(phase01, { clockwise, rotationOffsetRad }) {
  const p = clamp01(phase01);
  const dir = clockwise ? 1 : -1;
  return (rotationOffsetRad || 0) + dir * p * Math.PI * 2;
}

// Monotonic orbit phase: 0..1 wrapping, never reverses.
function getMoonOrbitPhase01AtTime(timeSec) {
  const cycleSec = Math.max(1, clampInt(MOON_CYCLE_SEC, 30));
  const offsetSec = clampInt(MOON_PHASE_OFFSET_SEC, Math.floor(cycleSec / 2));
  const t = Math.max(0, Number.isFinite(timeSec) ? timeSec : 0);
  const phaseSec = (t + offsetSec) % cycleSec;
  return clamp01(phaseSec / cycleSec);
}

// Season progress within current season (0..1).
function getSeasonProgress01(state, timeSec) {
  const seasonLen = Math.max(1, clampInt(SEASON_DURATION_SEC, 30));

  // Prefer countdown value if present (matches chrome usage)
  const remaining = state?.seasonTimeRemaining;
  if (Number.isFinite(remaining)) {
    return clamp01(1 - remaining / seasonLen);
  }

  // Next preference: explicit clock
  const clock = state?.seasonClockSec;
  if (Number.isFinite(clock)) {
    const raw = clock / seasonLen;
    const wrapped = raw - Math.floor(raw);
    return clamp01(wrapped);
  }

  // Fallback: derive from time modulo
  const t = Math.max(0, Number.isFinite(timeSec) ? timeSec : 0);
  return clamp01(((t % seasonLen) / seasonLen) || 0);
}

// Full wheel phase (0..1) including season index quadrant.
function getSeasonWheelPhase01(state, timeSec, quadrants) {
  const q = Math.max(1, clampInt(quadrants, 4));

  const idxRaw = state?.currentSeasonIndex;
  const idx = Number.isFinite(idxRaw) ? Math.floor(idxRaw) : 0;
  const wrappedIdx = ((idx % q) + q) % q;

  const p = getSeasonProgress01(state, timeSec);

  return clamp01((wrappedIdx + p) / q);
}

// ----------------------------------------------------------------------------

export function createSunAndMoonDisksView({
  layer,
  getState,
  layout = SUN_AND_MOON_DISKS_LAYOUT,
} = {}) {
  let root = null;
  let moonSprite = null;
  let seasonSprite = null;
  let lastEnabled = null;

  function ensureCreated() {
    if (!layer) return { ok: false, reason: "noLayer" };
    if (root) return { ok: true };

    root = new PIXI.Container();
    root.eventMode = "none";
    root.zIndex = layout?.zIndex ?? 0;

    // Season behind
    {
      const tex = PIXI.Texture.from(layout.season.texturePath);
      seasonSprite = new PIXI.Sprite(tex);
      seasonSprite.anchor.set(0.5);
      seasonSprite.eventMode = "none";
      root.addChild(seasonSprite);
    }

    // Moon front
    {
      const tex = PIXI.Texture.from(layout.moon.texturePath);
      moonSprite = new PIXI.Sprite(tex);
      moonSprite.anchor.set(0.5);
      moonSprite.eventMode = "none";
      root.addChild(moonSprite);
    }

    layer.addChild(root);
    return { ok: true };
  }

  function applyLayout() {
    if (!root) return;

    const enabled = layout?.enabled !== false;
    root.visible = enabled;

    if (moonSprite) {
      moonSprite.x = layout.moon.x;
      moonSprite.y = layout.moon.y;
      moonSprite.scale.set(layout.moon.scale);
      moonSprite.alpha = layout.moon.alpha;
    }

    if (seasonSprite) {
      seasonSprite.x = layout.season.x;
      seasonSprite.y = layout.season.y;
      seasonSprite.scale.set(layout.season.scale);
      seasonSprite.alpha = layout.season.alpha;
    }
  }

  function init() {
    const res = ensureCreated();
    if (!res.ok) return res;
    applyLayout();
    lastEnabled = layout?.enabled !== false;
    return { ok: true };
  }

  function update(_frameDt) {
    if (!root || !getState) return;

    const enabled = layout?.enabled !== false;
    if (enabled !== lastEnabled) {
      applyLayout();
      lastEnabled = enabled;
    }
    if (!enabled) return;

    const state = getState();
    if (!state) return;

    const timeSec = getTimeSecForRotation(state);

    if (moonSprite) {
      const orbit01 = getMoonOrbitPhase01AtTime(timeSec);
      moonSprite.rotation = phase01ToRotationRad(orbit01, layout.moon);
    }

    if (seasonSprite) {
      const q =
        Number.isFinite(layout.season?.quadrants) && layout.season.quadrants > 0
          ? layout.season.quadrants
          : 4;

      const wheel01 = getSeasonWheelPhase01(state, timeSec, q);
      seasonSprite.rotation = phase01ToRotationRad(wheel01, layout.season);
    }
  }

  function destroy() {
    if (!root) return;
    root.removeFromParent();
    root.destroy({ children: true });
    root = null;
    moonSprite = null;
    seasonSprite = null;
  }

  return {
    init,
    update,
    applyLayout,
    destroy,
    getRoot: () => root,
  };
}
