// time-controls-pixi.js
// Pause/commit/time-lever controls, positioned under the sun/moon disks.

import { createTimeLeverView } from "./time-lever-pixi.js";
import { VIEWPORT_DESIGN_WIDTH } from "./layout-pixi.js";

const BUTTON_WIDTH = 70;
const BUTTON_HEIGHT = 44;
const BASIC_TIME_LEVER_UI_MAX_ABS_SPEED = 4;
const BASIC_TIME_LEVER_LOCK_SPEEDS = Object.freeze([-4, -2, 2, 4]);
const BASIC_TIME_LEVER_LOCK_SNAP_NORM_RADIUS = 0.07;

export const TIME_CONTROLS_LAYOUT = {
  enabled: true,
  zIndex: 2,
  gap: 18,
  screenPadding: 16,
  verticalGapFromDiskPx: 0,
  diskTextureRadiusPx: 220,
  // Relative alignment of button baselines against the lever track center.
  // Positive moves buttons downward; negative moves buttons upward.
  buttonAlignOffsetY: 1,
};

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function makeButton(layer, label, onClick) {
  const container = new PIXI.Container();

  const bg = new PIXI.Graphics()
    .beginFill(0x444444)
    .drawRoundedRect(0, 0, BUTTON_WIDTH, BUTTON_HEIGHT, 10)
    .endFill();

  const text = new PIXI.Text(label, {
    fill: 0xffffff,
    fontSize: 18,
  });
  text.anchor.set(0.5, 0.5);
  text.position.set(BUTTON_WIDTH * 0.5, BUTTON_HEIGHT * 0.5);

  container.addChild(bg, text);
  container.eventMode = "static";
  container.cursor = "pointer";

  container.on("pointerover", () => {
    bg.tint = 0x888888;
  });
  container.on("pointerout", () => {
    bg.tint = 0xffffff;
  });
  container.on("pointertap", () => {
    onClick?.();
  });

  layer?.addChild(container);
  return container;
}

function getControlsAnchor(layout, sunMoonLayout, app) {
  const seasonX = Number.isFinite(sunMoonLayout?.season?.x)
    ? sunMoonLayout.season.x
    : Math.floor(app?.screen?.width ?? VIEWPORT_DESIGN_WIDTH) - 220;
  const seasonY = Number.isFinite(sunMoonLayout?.season?.y)
    ? sunMoonLayout.season.y
    : 400;
  const seasonScale = Number.isFinite(sunMoonLayout?.season?.scale)
    ? Math.max(0, sunMoonLayout.season.scale)
    : 0.75;
  const diskRadiusPx = Math.max(48, Number(layout?.diskTextureRadiusPx ?? 256));
  const gapY = Math.max(0, Number(layout?.verticalGapFromDiskPx ?? 18));
  return {
    x: seasonX,
    y: seasonY + diskRadiusPx * seasonScale + gapY,
  };
}

export function createTimeControlsView({
  app,
  layer,
  getGameState,
  togglePause,
  isPausePending,
  getCommitPreviewState,
  onCommitPreview,
  getReturnToPresentState,
  onReturnToPresent,
  getTimeScale,
  setTimeScaleTarget,
  layout = TIME_CONTROLS_LAYOUT,
  sunMoonLayout = null,
} = {}) {
  const root = new PIXI.Container();
  root.sortableChildren = true;
  root.zIndex = Number.isFinite(layout?.zIndex) ? layout.zIndex : 2;
  layer?.addChild(root);

  const pauseButton = makeButton(root, "Pause", () => {
    togglePause?.();
  });
  let actionButtonMode = "commit";
  let actionButtonTargetSec = null;
  const commitButton = makeButton(root, "Commit", () => {
    if (actionButtonMode === "present") {
      if (Number.isFinite(actionButtonTargetSec)) {
        onReturnToPresent?.(actionButtonTargetSec);
        return;
      }
      onReturnToPresent?.();
      return;
    }
    onCommitPreview?.();
  });
  const timeLeverView = createTimeLeverView({
    app,
    layer: root,
    getTimeScale,
    setTimeScaleTarget,
    uiMaxAbsSpeed: BASIC_TIME_LEVER_UI_MAX_ABS_SPEED,
    lockSpeeds: BASIC_TIME_LEVER_LOCK_SPEEDS,
    lockSnapNormRadius: BASIC_TIME_LEVER_LOCK_SNAP_NORM_RADIUS,
  });

  const controls = [
    {
      node: pauseButton,
      width: BUTTON_WIDTH,
      height: BUTTON_HEIGHT,
      alignHeight: BUTTON_HEIGHT,
      role: "button",
    },
    {
      node: commitButton,
      width: BUTTON_WIDTH,
      height: BUTTON_HEIGHT,
      alignHeight: BUTTON_HEIGHT,
      role: "button",
    },
    {
      node: timeLeverView.container,
      width: timeLeverView.width,
      height: timeLeverView.height,
      alignHeight: timeLeverView.trackHeight,
      role: "lever",
    },
  ];

  function applyLayout() {
    if (!app?.screen) return;
    const visibleControls = controls.filter((c) => c.node.visible !== false);
    if (!visibleControls.length) return;

    const gap = Math.max(0, Number(layout?.gap ?? 18));
    const screenPadding = Math.max(0, Number(layout?.screenPadding ?? 16));
    const totalWidth =
      visibleControls.reduce((sum, c) => sum + c.width, 0) +
      gap * (visibleControls.length - 1);

    const anchor = getControlsAnchor(layout, sunMoonLayout, app);
    const unclampedStartX = anchor.x - totalWidth * 0.5;
    const maxStartX = Math.max(screenPadding, app.screen.width - totalWidth - screenPadding);
    const startX = clamp(unclampedStartX, screenPadding, maxStartX);
    const trackHeight = Number.isFinite(timeLeverView.trackHeight)
      ? Math.max(1, timeLeverView.trackHeight)
      : BUTTON_HEIGHT;
    const rowCenterY = anchor.y + trackHeight * 0.5;
    const buttonAlignOffsetY = Number.isFinite(layout?.buttonAlignOffsetY)
      ? Number(layout.buttonAlignOffsetY)
      : 0;

    let x = startX;
    for (const control of visibleControls) {
      control.node.x = x;
      const alignHeight = Number.isFinite(control.alignHeight)
        ? Math.max(1, control.alignHeight)
        : control.height;
      const alignOffsetY = control.role === "button" ? buttonAlignOffsetY : 0;
      control.node.y = rowCenterY - alignHeight * 0.5 + alignOffsetY;
      x += control.width + gap;
    }
  }

  function update(frameDt) {
    const enabled = layout?.enabled !== false;
    root.visible = enabled;
    if (!enabled) return;

    const state = typeof getGameState === "function" ? getGameState() : null;
    if (!state) return;

    const pausePending =
      typeof isPausePending === "function" ? !!isPausePending() : false;
    const pauseLabel = pauseButton.children[1];
    const pauseBg = pauseButton.children[0];

    if (state.paused) {
      pauseLabel.text = "Paused";
      pauseBg.tint = 0x55aa55;
    } else if (pausePending) {
      pauseLabel.text = "Pausing...";
      pauseBg.tint = 0xffcc66;
    } else {
      pauseLabel.text = "Pause";
      pauseBg.tint = 0xffffff;
    }

    const commitState =
      typeof getCommitPreviewState === "function"
        ? getCommitPreviewState()
        : null;
    const returnState =
      typeof getReturnToPresentState === "function"
        ? getReturnToPresentState()
        : null;
    const showCommit = !!commitState?.visible;
    const showReturn = !showCommit && !!returnState?.visible;
    const showActionButton = showCommit || showReturn;
    const canCommit =
      showCommit &&
      commitState?.enabled !== false &&
      typeof onCommitPreview === "function";
    const canReturn =
      showReturn &&
      returnState?.enabled !== false &&
      typeof onReturnToPresent === "function";
    const canAction = showCommit ? canCommit : canReturn;
    actionButtonMode = showReturn ? "present" : "commit";
    actionButtonTargetSec =
      showReturn && Number.isFinite(returnState?.targetSec)
        ? Math.floor(returnState.targetSec)
        : null;

    commitButton.visible = showActionButton;
    commitButton.eventMode = canAction ? "static" : "none";
    commitButton.cursor = canAction ? "pointer" : "default";
    const commitBg = commitButton.children[0];
    const commitLabel = commitButton.children[1];
    if (commitLabel) {
      commitLabel.text = showReturn ? "Present" : "Commit";
    }
    if (commitBg) {
      commitBg.tint = canAction ? 0x55aa55 : 0x666666;
    }

    timeLeverView.update(state, frameDt);
    applyLayout();
  }

  function init() {
    applyLayout();
  }

  function refresh() {
    applyLayout();
  }

  return {
    init,
    refresh,
    update,
    getScreenRect: () =>
      !root.visible || typeof root.getBounds !== "function"
        ? null
        : root.getBounds(),
  };
}
