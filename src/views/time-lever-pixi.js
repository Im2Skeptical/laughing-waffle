// time-lever-pixi.js
// Time lever widget (Pixi): drag to set time scale with magnetic lock points.

export function createTimeLeverView({
  app,
  layer,
  getTimeScale,
  setTimeScaleTarget,
  width = 220,
  height = 50,
  handleWidth = 44,
  handleHeight = 28,
  margin = 4,
  curve = 1.5,
  stickySpeed = 0.5,
  uiMaxAbsSpeed = 4,
  lockSpeeds = [-4, -2, 2, 4],
  lockSnapNormRadius = 0.07,
  labelGap = 4,
  labelFontSize = 12,
} = {}) {
  const timeLever = new PIXI.Container();
  const leverTrack = new PIXI.Graphics();
  const leverHandle = new PIXI.Graphics();
  const leverHit = new PIXI.Graphics();
  const leverLabel = new PIXI.Text("", {
    fill: 0xffffff,
    fontSize: labelFontSize,
  });
  timeLever.addChild(leverTrack, leverHandle, leverHit, leverLabel);
  if (layer) layer.addChild(timeLever);

  const LABEL_HEIGHT = 18;
  const fullHeight = height + labelGap + LABEL_HEIGHT;

  let leverDragging = false;
  let leverDragNorm = 0;
  let leverDragSpeed = 1;
  let lastHandleColor = null;
  let lastTrackSignature = "";

  timeLever.visible =
    typeof getTimeScale === "function" || typeof setTimeScaleTarget === "function";

  function getTimeScaleMax() {
    const ts = typeof getTimeScale === "function" ? getTimeScale() : null;
    const max = ts && Number.isFinite(ts.max) ? ts.max : 16;
    return Math.max(1, Math.floor(max));
  }

  function getActiveUiMaxSpeed() {
    const engineMax = getTimeScaleMax();
    const uiMax = Number.isFinite(uiMaxAbsSpeed)
      ? Math.max(1, Math.floor(uiMaxAbsSpeed))
      : 4;
    return Math.min(engineMax, uiMax);
  }

  function clampNorm(norm) {
    if (!Number.isFinite(norm)) return 0;
    return Math.max(-1, Math.min(1, norm));
  }

  function leverNormToSpeed(norm) {
    const maxSpeed = getActiveUiMaxSpeed();
    const n = Math.max(-1, Math.min(1, norm));
    const t = Math.pow(Math.abs(n), curve);
    if (n >= 0) return 1 + t * (maxSpeed - 1);
    return 1 - t * (maxSpeed + 1);
  }

  function speedToLeverNorm(speed) {
    const maxSpeed = getActiveUiMaxSpeed();
    const s = Number.isFinite(speed) ? speed : 1;
    if (s >= 1) {
      const t = (s - 1) / Math.max(1, maxSpeed - 1);
      return Math.pow(Math.max(0, Math.min(1, t)), 1 / curve);
    }
    const t = (1 - s) / Math.max(1, maxSpeed + 1);
    return -Math.pow(Math.max(0, Math.min(1, t)), 1 / curve);
  }

  function leverNormToHandleX(norm) {
    const minX = margin;
    const maxX = width - margin - handleWidth;
    const t = (clampNorm(norm) + 1) / 2;
    return minX + t * (maxX - minX);
  }

  function leverNormToTrackX(norm) {
    return leverNormToHandleX(norm) + handleWidth * 0.5;
  }

  function getActiveLockSpeeds() {
    const maxSpeed = getActiveUiMaxSpeed();
    const source = Array.isArray(lockSpeeds) ? lockSpeeds : [];
    const unique = new Set();
    for (const value of source) {
      if (!Number.isFinite(value)) continue;
      const speed = Number(value);
      if (speed === 0) continue;
      if (Math.abs(speed) > maxSpeed) continue;
      unique.add(speed);
    }
    return Array.from(unique).sort((a, b) => a - b);
  }

  function applyLockSnap(rawNorm) {
    const norm = clampNorm(rawNorm);
    const radius = Number.isFinite(lockSnapNormRadius)
      ? Math.max(0, Number(lockSnapNormRadius))
      : 0;
    if (radius <= 0) return norm;

    const activeLocks = getActiveLockSpeeds();
    if (!activeLocks.length) return norm;

    let closestNorm = norm;
    let closestDist = Number.POSITIVE_INFINITY;
    for (const speed of activeLocks) {
      const lockNorm = speedToLeverNorm(speed);
      const dist = Math.abs(lockNorm - norm);
      if (dist < closestDist) {
        closestNorm = lockNorm;
        closestDist = dist;
      }
    }

    return closestDist <= radius ? closestNorm : norm;
  }

  function drawTimeLeverBase() {
    const maxSpeed = getActiveUiMaxSpeed();
    const activeLocks = getActiveLockSpeeds();
    const signature = `${maxSpeed}|${activeLocks.join(",")}`;
    if (signature === lastTrackSignature) return;
    lastTrackSignature = signature;

    leverTrack.clear();
    leverTrack.beginFill(0x444444, 0.95);
    leverTrack.drawRoundedRect(0, 0, width, height, height / 2);
    leverTrack.endFill();
    leverTrack.beginFill(0x6a6a6a, 0.9);
    leverTrack.drawRoundedRect(
      3,
      3,
      width - 6,
      height - 6,
      (height - 6) / 2
    );
    leverTrack.endFill();
    leverTrack.lineStyle(1, 0x333333, 0.7);
    leverTrack.moveTo(width / 2, 6);
    leverTrack.lineTo(width / 2, height - 6);

    for (const speed of activeLocks) {
      const notchX = leverNormToTrackX(speedToLeverNorm(speed));
      const isMajor = Math.abs(speed) >= 4;
      const notchInset = isMajor ? 7 : 9;
      const notchColor = isMajor ? 0xe4dcc5 : 0xc4baa1;
      const notchAlpha = isMajor ? 0.92 : 0.78;
      const notchWidth = isMajor ? 2 : 1;
      leverTrack.lineStyle(notchWidth, notchColor, notchAlpha);
      leverTrack.moveTo(notchX, notchInset);
      leverTrack.lineTo(notchX, height - notchInset);
    }

    leverHit.clear();
    leverHit.beginFill(0xffffff);
    leverHit.drawRoundedRect(0, 0, width, height, height / 2);
    leverHit.endFill();
    leverHit.alpha = 0;
  }

  function drawLeverHandle(color) {
    leverHandle.clear();
    leverHandle.beginFill(color);
    leverHandle.drawRoundedRect(
      0,
      0,
      handleWidth,
      handleHeight,
      handleHeight / 2
    );
    leverHandle.endFill();
  }

  function updateTimeLever(state) {
    if (!timeLever.visible) return;
    drawTimeLeverBase();

    const ts = typeof getTimeScale === "function" ? getTimeScale() : null;
    const speed = ts && Number.isFinite(ts.current) ? ts.current : 1;
    const displaySpeed = leverDragging ? leverDragSpeed : speed;
    const norm = leverDragging ? leverDragNorm : speedToLeverNorm(displaySpeed);

    leverHandle.x = leverNormToHandleX(norm);
    leverHandle.y = (height - handleHeight) / 2;

    let color = 0xdddddd;
    if (Math.abs(displaySpeed) < stickySpeed) {
      color = 0xffcc66;
    } else if (displaySpeed < 0) {
      color = 0xcc8888;
    } else if (displaySpeed > 1.05) {
      color = 0x88cc88;
    }

    if (color !== lastHandleColor) {
      drawLeverHandle(color);
      lastHandleColor = color;
    }

    const speedAbs = Math.abs(displaySpeed);
    const speedText = `${displaySpeed < 0 ? "-" : ""}x${speedAbs.toFixed(1)}`;
    const showPauseHint = speedAbs < stickySpeed && !leverDragging;
    const pauseText = showPauseHint || state?.paused ? " (release: pause)" : "";

    leverLabel.text = `Time: ${speedText}${pauseText}`;
    leverLabel.x = (width - leverLabel.width) / 2;
    leverLabel.y = height + labelGap;
  }

  function updateLeverFromPointer(globalPos) {
    const local = timeLever.toLocal(globalPos);
    const minX = margin;
    const maxX = width - margin - handleWidth;
    const handleX = Math.max(
      minX,
      Math.min(maxX, local.x - handleWidth / 2)
    );
    const ratio = (handleX - minX) / Math.max(1, maxX - minX);
    const norm = ratio * 2 - 1;
    const snappedNorm = applyLockSnap(norm);
    leverDragNorm = snappedNorm;
    leverDragSpeed = leverNormToSpeed(snappedNorm);

    if (typeof setTimeScaleTarget === "function") {
      setTimeScaleTarget(leverDragSpeed, { unpause: leverDragSpeed !== 0 });
    }
  }

  function endLeverDrag() {
    if (!leverDragging) return;
    leverDragging = false;

    const shouldPause = Math.abs(leverDragSpeed) < stickySpeed;
    if (typeof setTimeScaleTarget === "function") {
      if (shouldPause) {
        setTimeScaleTarget(0, { requestPause: true });
      } else {
        setTimeScaleTarget(leverDragSpeed, { unpause: true });
      }
    }
  }

  if (typeof setTimeScaleTarget === "function") {
    leverHit.eventMode = "static";
    leverHit.cursor = "pointer";
    leverHit.on("pointerdown", (e) => {
      leverDragging = true;
      updateLeverFromPointer(e.global);
    });
    app?.stage?.on("pointermove", (e) => {
      if (!leverDragging) return;
      updateLeverFromPointer(e.global);
    });
    app?.stage?.on("pointerup", endLeverDrag);
    app?.stage?.on("pointerupoutside", endLeverDrag);
  } else {
    leverHit.eventMode = "none";
  }

  drawTimeLeverBase();
  drawLeverHandle(0xdddddd);

  return {
    container: timeLever,
    width,
    trackHeight: height,
    height: fullHeight,
    update: updateTimeLever,
  };
}
