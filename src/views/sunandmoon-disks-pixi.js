// src/views/sunandmoon-disks-pixi.js
// Two rotating HUD disks: Moon cycle + Season cycle.
// Pure view module: reads state, never mutates it.

import {
  BASE_EDITABLE_HISTORY_WINDOW_SEC,
  SEASON_DURATION_SEC,
  MOON_CYCLE_SEC,
  MOON_PHASE_OFFSET_SEC,
} from "../defs/gamesettings/gamerules-defs.js";

export const FORWARD_DRAG_STRATEGY = "B"; // "A" (target+catch-up) or "B" (commit-as-you-drag)

export const SUN_AND_MOON_DISKS_LAYOUT = {
  enabled: true,
  forwardDragStrategy: FORWARD_DRAG_STRATEGY,

  moon: {
    x: 1375,
    y: 30,
    scale: 0.5,
    alpha: 1.0,
    rotationOffsetRad: 3,
    clockwise: true,
    texturePath: "/images/MoonDisk_01.png",
  },

  season: {
    x: 1300,
    y: 200,
    scale: 0.75,
    alpha: 1.0,
    rotationOffsetRad: 0,
    clockwise: true,
    texturePath: "/images/SeasonDisk_01.png",
    quadrants: 4,
  },

  zIndex: 0,
};

const TWO_PI = Math.PI * 2;
const DRAG_MODE_FORWARD = "forward";
const DRAG_MODE_BACKWARD = "backward";

// ----------------------------------------------------------------------------

function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function clampInt(v, fallback) {
  const n = Math.floor(v);
  return Number.isFinite(n) ? n : fallback;
}

function clampNonNegativeSec(v, fallback = 0) {
  if (!Number.isFinite(v)) return Math.max(0, Math.floor(fallback));
  return Math.max(0, Math.floor(v));
}

function wrap01(v) {
  if (!Number.isFinite(v)) return 0;
  const wrapped = v - Math.floor(v);
  return clamp01(wrapped);
}

function normalizeSignedAngleDeltaRad(deltaRad) {
  if (!Number.isFinite(deltaRad)) return 0;
  let d = deltaRad;
  while (d > Math.PI) d -= TWO_PI;
  while (d < -Math.PI) d += TWO_PI;
  return d;
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
  return (rotationOffsetRad || 0) + dir * p * TWO_PI;
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

function resolveForwardDragStrategy(layout) {
  const raw = layout?.forwardDragStrategy;
  if (raw === "A" || raw === "B") return raw;
  return FORWARD_DRAG_STRATEGY;
}

function getDiskSecondsPerRevolution(diskId, layout) {
  if (diskId === "season") {
    const quadrants = Math.max(1, clampInt(layout?.season?.quadrants, 4));
    return Math.max(1, clampInt(SEASON_DURATION_SEC, 30)) * quadrants;
  }
  return Math.max(1, clampInt(MOON_CYCLE_SEC, 30));
}

function getDiskPhase01AtTime(diskId, state, timeSec, layout) {
  if (diskId === "season") {
    const quadrants = Math.max(1, clampInt(layout?.season?.quadrants, 4));
    return getSeasonWheelPhase01(state, timeSec, quadrants);
  }
  return getMoonOrbitPhase01AtTime(timeSec);
}

function getDiskLayout(diskId, layout) {
  return diskId === "season" ? layout?.season : layout?.moon;
}

function getDiskRotationRadAtProjectedSecond({
  diskId,
  state,
  fromTimeSec,
  targetSec,
  layout,
}) {
  if (!state) return 0;
  const fromSec = Number.isFinite(fromTimeSec) ? fromTimeSec : 0;
  const toSec = Number.isFinite(targetSec) ? targetSec : fromSec;
  const secPerRev = getDiskSecondsPerRevolution(diskId, layout);
  const basePhase = getDiskPhase01AtTime(diskId, state, fromSec, layout);
  const deltaPhase = (toSec - fromSec) / Math.max(1, secPerRev);
  const phase = wrap01(basePhase + deltaPhase);
  return phase01ToRotationRad(phase, getDiskLayout(diskId, layout));
}

function getFrontierSec({ getTimeline, getState }) {
  const timeline = typeof getTimeline === "function" ? getTimeline() : null;
  const timelineSec = Math.floor(timeline?.historyEndSec ?? -1);
  if (Number.isFinite(timelineSec) && timelineSec >= 0) {
    return timelineSec;
  }
  const state = typeof getState === "function" ? getState() : null;
  return getTSecInt(state);
}

function getMinEditableSec({ getEditableHistoryBounds, frontierSec }) {
  const bounds =
    typeof getEditableHistoryBounds === "function"
      ? getEditableHistoryBounds()
      : null;
  const fromBounds = Math.floor(bounds?.minEditableSec ?? -1);
  if (Number.isFinite(fromBounds) && fromBounds >= 0) {
    return Math.min(frontierSec, fromBounds);
  }

  const fallbackWindowSec = clampNonNegativeSec(BASE_EDITABLE_HISTORY_WINDOW_SEC, 0);
  return Math.max(0, frontierSec - fallbackWindowSec);
}

function getSpritePointerAngleRad(sprite, globalPoint) {
  if (!sprite || !globalPoint) return null;
  const center = sprite.getGlobalPosition();
  const dx = globalPoint.x - center.x;
  const dy = globalPoint.y - center.y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  if (dx === 0 && dy === 0) return null;
  return Math.atan2(dy, dx);
}

// ----------------------------------------------------------------------------

export function createSunAndMoonDisksView({
  app,
  layer,
  getState,
  getTimeline,
  getEditableHistoryBounds,
  browseCursorSecond,
  setForwardTargetSec,
  clearForwardTargetSec,
  onForwardDragStart,
  onForwardDragEnd,
  getForwardStatus,
  layout = SUN_AND_MOON_DISKS_LAYOUT,
} = {}) {
  let root = null;
  let moonSprite = null;
  let seasonSprite = null;
  let feedbackGraphics = null;
  let feedbackText = null;
  let lastEnabled = null;

  let dragSession = null;
  let browseRafId = 0;
  let pendingBrowseSec = null;

  let stageMoveHandler = null;
  let stageUpHandler = null;
  let stageListenersBound = false;

  function getSpriteByDiskId(diskId) {
    return diskId === "season" ? seasonSprite : moonSprite;
  }

  function getActiveDiskIdForForwardFeedback(forwardStatus) {
    if (typeof forwardStatus?.diskId === "string") return forwardStatus.diskId;
    if (typeof dragSession?.diskId === "string") return dragSession.diskId;
    return "season";
  }

  function flushBrowseRequest() {
    browseRafId = 0;
    const sec = pendingBrowseSec;
    pendingBrowseSec = null;
    if (!Number.isFinite(sec)) return;
    browseCursorSecond?.(Math.max(0, Math.floor(sec)));
  }

  function queueBrowseSecond(sec) {
    pendingBrowseSec = Math.max(0, Math.floor(sec));
    if (browseRafId) return;

    if (typeof requestAnimationFrame === "function") {
      browseRafId = requestAnimationFrame(flushBrowseRequest);
      return;
    }

    flushBrowseRequest();
  }

  function clearForwardTarget(meta) {
    clearForwardTargetSec?.(meta || null);
  }

  function startDrag(diskId, event) {
    if (!event) return;
    if (layout?.enabled === false) return;

    const sprite = getSpriteByDiskId(diskId);
    if (!sprite) return;

    const angle = getSpritePointerAngleRad(sprite, event.global);
    if (!Number.isFinite(angle)) return;

    const frontierSec = getFrontierSec({ getTimeline, getState });

    dragSession = {
      diskId,
      pointerId: Number.isFinite(event.pointerId) ? event.pointerId : null,
      lastAngleRad: angle,
      dragStartFrontierSec: frontierSec,
      accumSec: 0,
      lastForwardTargetSec: null,
      lastMode: null,
    };

    if (moonSprite) moonSprite.cursor = "grabbing";
    if (seasonSprite) seasonSprite.cursor = "grabbing";

    clearForwardTarget({ reason: "dragStart", diskId, frontierSec });
    onForwardDragStart?.({ diskId, frontierSec });

    event.stopPropagation?.();
  }

  function endDrag() {
    if (!dragSession) return;

    const session = dragSession;
    dragSession = null;

    if (moonSprite) moonSprite.cursor = "grab";
    if (seasonSprite) seasonSprite.cursor = "grab";

    if (session.lastMode !== DRAG_MODE_FORWARD) {
      clearForwardTarget({ reason: "dragEndNoForward", diskId: session.diskId });
    }
    onForwardDragEnd?.({ diskId: session.diskId });
  }

  function updateDragFromPointerEvent(event) {
    if (!dragSession || !event) return;

    if (
      dragSession.pointerId != null &&
      Number.isFinite(event.pointerId) &&
      event.pointerId !== dragSession.pointerId
    ) {
      return;
    }

    const sprite = getSpriteByDiskId(dragSession.diskId);
    if (!sprite) return;

    const nextAngle = getSpritePointerAngleRad(sprite, event.global);
    if (!Number.isFinite(nextAngle)) return;

    const angleDelta = normalizeSignedAngleDeltaRad(
      nextAngle - dragSession.lastAngleRad
    );
    dragSession.lastAngleRad = nextAngle;

    const secPerRev = getDiskSecondsPerRevolution(dragSession.diskId, layout);
    const diskLayout = getDiskLayout(dragSession.diskId, layout) || {};
    const direction = diskLayout.clockwise ? 1 : -1;
    const deltaPhase = (angleDelta / TWO_PI) * direction;
    const deltaSec = deltaPhase * secPerRev;

    dragSession.accumSec += deltaSec;

    const frontierSec = getFrontierSec({ getTimeline, getState });
    const dragSec = Math.round(dragSession.dragStartFrontierSec + dragSession.accumSec);

    if (dragSec <= frontierSec) {
      const minEditableSec = getMinEditableSec({
        getEditableHistoryBounds,
        frontierSec,
      });
      const clampedSec = Math.max(minEditableSec, Math.min(frontierSec, dragSec));
      pendingBrowseSec = clampedSec;
      queueBrowseSecond(clampedSec);

      if (dragSession.lastMode !== DRAG_MODE_BACKWARD) {
        clearForwardTarget({ reason: "dragBackward", diskId: dragSession.diskId });
      }
      dragSession.lastMode = DRAG_MODE_BACKWARD;
      dragSession.lastForwardTargetSec = null;
      return;
    }

    pendingBrowseSec = null;
    if (dragSession.lastForwardTargetSec !== dragSec) {
      setForwardTargetSec?.(dragSec, {
        diskId: dragSession.diskId,
        frontierSec,
      });
      dragSession.lastForwardTargetSec = dragSec;
    }
    dragSession.lastMode = DRAG_MODE_FORWARD;
  }

  function bindStageInput() {
    if (stageListenersBound) return;
    if (!app?.stage) return;

    stageMoveHandler = (event) => {
      if (!dragSession) return;
      updateDragFromPointerEvent(event);
      event.stopPropagation?.();
    };

    stageUpHandler = (_event) => {
      endDrag();
    };

    app.stage.on("pointermove", stageMoveHandler);
    app.stage.on("pointerup", stageUpHandler);
    app.stage.on("pointerupoutside", stageUpHandler);
    stageListenersBound = true;
  }

  function unbindStageInput() {
    if (!stageListenersBound || !app?.stage) return;
    if (stageMoveHandler) app.stage.off("pointermove", stageMoveHandler);
    if (stageUpHandler) {
      app.stage.off("pointerup", stageUpHandler);
      app.stage.off("pointerupoutside", stageUpHandler);
    }
    stageMoveHandler = null;
    stageUpHandler = null;
    stageListenersBound = false;
  }

  function drawForwardFeedback({
    strategy,
    state,
    baseTimeSec,
    targetSec,
    frontierSec,
    forwardStatus,
  }) {
    if (!feedbackGraphics) return;

    feedbackGraphics.clear();
    if (feedbackText) {
      feedbackText.visible = false;
      feedbackText.text = "";
    }

    if (!Number.isFinite(targetSec)) return;
    if (targetSec <= frontierSec) return;

    const diskId = getActiveDiskIdForForwardFeedback(forwardStatus);
    const sprite = getSpriteByDiskId(diskId);
    if (!sprite || !state) return;

    const cx = sprite.x;
    const cy = sprite.y;
    const baseRadius = Math.max(sprite.width, sprite.height) * 0.5;
    const ringRadius = Number.isFinite(baseRadius) && baseRadius > 0 ? baseRadius + 10 : 36;

    if (strategy === "A") {
      feedbackGraphics.lineStyle(3, 0xffc965, 0.95);
      feedbackGraphics.drawCircle(cx, cy, ringRadius);
      feedbackGraphics.lineStyle(1, 0xffc965, 0.5);
      feedbackGraphics.drawCircle(cx, cy, ringRadius + 4);

      if (feedbackText) {
        feedbackText.text = `Catching up +${Math.max(0, targetSec - frontierSec)}s`;
        feedbackText.x = Math.round(cx - feedbackText.width * 0.5);
        feedbackText.y = Math.round(cy - ringRadius - feedbackText.height - 6);
        feedbackText.visible = true;
      }
      return;
    }

    const targetRot = getDiskRotationRadAtProjectedSecond({
      diskId,
      state,
      fromTimeSec: baseTimeSec,
      targetSec,
      layout,
    });

    const markerRadius = ringRadius;
    const mx = cx + Math.cos(targetRot) * markerRadius;
    const my = cy + Math.sin(targetRot) * markerRadius;

    feedbackGraphics.lineStyle(2, 0x87c7ff, 0.8);
    feedbackGraphics.drawCircle(cx, cy, ringRadius);
    feedbackGraphics.beginFill(0x87c7ff, 0.95);
    feedbackGraphics.drawCircle(mx, my, 5);
    feedbackGraphics.endFill();

    if (feedbackText) {
      feedbackText.text = `Target +${Math.max(0, targetSec - frontierSec)}s`;
      feedbackText.x = Math.round(cx - feedbackText.width * 0.5);
      feedbackText.y = Math.round(cy - ringRadius - feedbackText.height - 6);
      feedbackText.visible = true;
    }
  }

  function ensureCreated() {
    if (!layer) return { ok: false, reason: "noLayer" };
    if (root) return { ok: true };

    root = new PIXI.Container();
    root.eventMode = "passive";
    root.zIndex = layout?.zIndex ?? 0;

    // Season behind
    {
      const tex = PIXI.Texture.from(layout.season.texturePath);
      seasonSprite = new PIXI.Sprite(tex);
      seasonSprite.anchor.set(0.5);
      seasonSprite.eventMode = "static";
      seasonSprite.cursor = "grab";
      seasonSprite.on("pointerdown", (event) => startDrag("season", event));
      root.addChild(seasonSprite);
    }

    // Moon front
    {
      const tex = PIXI.Texture.from(layout.moon.texturePath);
      moonSprite = new PIXI.Sprite(tex);
      moonSprite.anchor.set(0.5);
      moonSprite.eventMode = "static";
      moonSprite.cursor = "grab";
      moonSprite.on("pointerdown", (event) => startDrag("moon", event));
      root.addChild(moonSprite);
    }

    feedbackGraphics = new PIXI.Graphics();
    feedbackGraphics.eventMode = "none";
    root.addChild(feedbackGraphics);

    feedbackText = new PIXI.Text("", {
      fill: 0xfff0b8,
      fontSize: 12,
      fontFamily: "Arial",
      fontWeight: "bold",
      align: "center",
      stroke: 0x111111,
      strokeThickness: 3,
    });
    feedbackText.eventMode = "none";
    feedbackText.visible = false;
    root.addChild(feedbackText);

    layer.addChild(root);
    bindStageInput();
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

    if (!enabled) {
      if (dragSession) endDrag();
      if (feedbackGraphics) feedbackGraphics.clear();
      if (feedbackText) feedbackText.visible = false;
      return;
    }

    const state = getState();
    if (!state) return;

    const strategy = resolveForwardDragStrategy(layout);
    const forwardStatus =
      typeof getForwardStatus === "function" ? getForwardStatus() : null;
    const targetSec = Number.isFinite(forwardStatus?.targetSec)
      ? Math.max(0, Math.floor(forwardStatus.targetSec))
      : null;
    const frontierSec = getFrontierSec({ getTimeline, getState });

    const baseTimeSec = getTimeSecForRotation(state);
    const showTargetAsMainRotation =
      strategy === "A" && Number.isFinite(targetSec) && targetSec > frontierSec;

    if (moonSprite) {
      if (showTargetAsMainRotation) {
        moonSprite.rotation = getDiskRotationRadAtProjectedSecond({
          diskId: "moon",
          state,
          fromTimeSec: baseTimeSec,
          targetSec,
          layout,
        });
      } else {
        const orbit01 = getMoonOrbitPhase01AtTime(baseTimeSec);
        moonSprite.rotation = phase01ToRotationRad(orbit01, layout.moon);
      }
    }

    if (seasonSprite) {
      if (showTargetAsMainRotation) {
        seasonSprite.rotation = getDiskRotationRadAtProjectedSecond({
          diskId: "season",
          state,
          fromTimeSec: baseTimeSec,
          targetSec,
          layout,
        });
      } else {
        const q =
          Number.isFinite(layout.season?.quadrants) && layout.season.quadrants > 0
            ? layout.season.quadrants
            : 4;
        const wheel01 = getSeasonWheelPhase01(state, baseTimeSec, q);
        seasonSprite.rotation = phase01ToRotationRad(wheel01, layout.season);
      }
    }

    drawForwardFeedback({
      strategy,
      state,
      baseTimeSec,
      targetSec,
      frontierSec,
      forwardStatus,
    });
  }

  function destroy() {
    endDrag();

    if (browseRafId && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(browseRafId);
    }
    browseRafId = 0;
    pendingBrowseSec = null;

    clearForwardTarget({ reason: "destroy" });

    unbindStageInput();

    if (!root) return;

    if (moonSprite) moonSprite.off("pointerdown");
    if (seasonSprite) seasonSprite.off("pointerdown");

    root.removeFromParent();
    root.destroy({ children: true });
    root = null;
    moonSprite = null;
    seasonSprite = null;
    feedbackGraphics = null;
    feedbackText = null;
  }

  return {
    init,
    update,
    applyLayout,
    destroy,
    getRoot: () => root,
  };
}
