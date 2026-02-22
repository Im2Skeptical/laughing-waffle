// time-controls-pixi.js
// Pause/commit/time-lever controls, positioned under the sun/moon disks.

import { createTimeLeverView } from "./time-lever-pixi.js";

const BUTTON_WIDTH = 70;
const BUTTON_HEIGHT = 44;

export const TIME_CONTROLS_LAYOUT = {
  enabled: true,
  zIndex: 2,
  gap: 18,
  screenPadding: 16,
  verticalGapFromDiskPx: 0,
  diskTextureRadiusPx: 220,
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
    : Math.floor(app?.screen?.width ?? 1920) - 220;
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
  const commitButton = makeButton(root, "Commit", () => {
    onCommitPreview?.();
  });
  const timeLeverView = createTimeLeverView({
    app,
    layer: root,
    getTimeScale,
    setTimeScaleTarget,
  });

  const controls = [
    { node: pauseButton, width: BUTTON_WIDTH, height: BUTTON_HEIGHT },
    { node: commitButton, width: BUTTON_WIDTH, height: BUTTON_HEIGHT },
    {
      node: timeLeverView.container,
      width: timeLeverView.width,
      height: timeLeverView.height,
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
    const centerY = anchor.y + BUTTON_HEIGHT * 0.5;

    let x = startX;
    for (const control of visibleControls) {
      control.node.x = x;
      control.node.y = centerY - control.height * 0.5;
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
    const showCommit = !!commitState?.visible;
    const canCommit =
      showCommit &&
      commitState?.enabled !== false &&
      typeof onCommitPreview === "function";
    commitButton.visible = showCommit;
    commitButton.eventMode = canCommit ? "static" : "none";
    commitButton.cursor = canCommit ? "pointer" : "default";
    const commitBg = commitButton.children[0];
    if (commitBg) {
      commitBg.tint = canCommit ? 0x55aa55 : 0x666666;
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
  };
}
