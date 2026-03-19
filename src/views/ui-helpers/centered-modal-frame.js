import { MUCHA_UI_COLORS } from "./mucha-ui-palette.js";
import { installSolidUiHitArea } from "./solid-ui-hit-area.js";
import { createWindowHeader } from "./window-header.js";

const DEFAULT_SCREEN_WIDTH = 2424;
const DEFAULT_SCREEN_HEIGHT = 1080;
const OPEN_CLOSE_GUARD_MS = 140;

function ensurePositiveInt(value, fallback) {
  const n = Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(1, n);
}

function nowMs() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

export function createCenteredModalFrame({
  PIXI,
  layer = null,
  stage = null,
  getScreenSize = null,
  layout = null,
  defaultLayout = null,
  title = "Modal",
  titleStyle = null,
  headerHeight = 26,
  panelRadius = 12,
  bodyTopGap = 6,
  bodyPadding = 12,
  closeButtonWidth = 42,
  closeButtonHeight = 16,
  closeOffsetX = 8,
  panelBorderWidth = 2,
  panelFill = MUCHA_UI_COLORS.surfaces.panelDeep,
  panelFillAlpha = 0.97,
  panelBorder = MUCHA_UI_COLORS.surfaces.borderSoft,
  panelBorderAlpha = 0.95,
  backdropAlpha = 0.62,
  onRequestClose = null,
} = {}) {
  const resolvedLayout =
    layout && typeof layout === "object"
      ? layout
      : defaultLayout && typeof defaultLayout === "object"
        ? defaultLayout
        : {};

  const root = new PIXI.Container();
  root.visible = false;
  root.eventMode = "none";
  root.zIndex = Number.isFinite(resolvedLayout?.zIndex)
    ? Math.floor(resolvedLayout.zIndex)
    : 80;
  if (layer) {
    layer.sortableChildren = true;
    layer.addChild(root);
  }

  const backdrop = new PIXI.Graphics();
  let dismissGuardUntilMs = 0;
  backdrop.eventMode = "static";
  backdrop.cursor = "pointer";
  backdrop.on("pointertap", (ev) => {
    ev?.stopPropagation?.();
    if (nowMs() < dismissGuardUntilMs) return;
    onRequestClose?.("backdrop");
  });
  root.addChild(backdrop);

  const panel = new PIXI.Container();
  panel.eventMode = "static";
  panel.cursor = "default";
  let panelHitWidth = 1;
  let panelHitHeight = 1;
  const solidPanelHitArea = installSolidUiHitArea(panel, () => {
    return {
      x: 0,
      y: 0,
      width: panelHitWidth,
      height: panelHitHeight,
    };
  });
  root.addChild(panel);

  const panelBg = new PIXI.Graphics();
  panel.addChild(panelBg);

  const headerHost = new PIXI.Container();
  panel.addChild(headerHost);
  const header = createWindowHeader({
    stage,
    parent: headerHost,
    width: 400,
    height: headerHeight,
    radius: panelRadius,
    background: MUCHA_UI_COLORS.surfaces.header,
    title,
    titleStyle:
      titleStyle ||
      {
        fill: MUCHA_UI_COLORS.ink.primary,
        fontSize: 13,
        fontWeight: "bold",
      },
    paddingX: 10,
    paddingY: 5,
    showPin: false,
    showClose: true,
    closeOffsetX,
    closeButtonWidth,
    closeButtonHeight,
    onClose: () => onRequestClose?.("closeButton"),
  });

  const body = new PIXI.Container();
  panel.addChild(body);

  function getScreenSizeSafe() {
    if (typeof getScreenSize === "function") {
      const size = getScreenSize() || {};
      return {
        width: ensurePositiveInt(size?.width, DEFAULT_SCREEN_WIDTH),
        height: ensurePositiveInt(size?.height, DEFAULT_SCREEN_HEIGHT),
      };
    }
    return {
      width: ensurePositiveInt(stage?.hitArea?.width, DEFAULT_SCREEN_WIDTH),
      height: ensurePositiveInt(stage?.hitArea?.height, DEFAULT_SCREEN_HEIGHT),
    };
  }

  function setOpenVisible(open) {
    root.visible = !!open;
    root.eventMode = open ? "static" : "none";
    dismissGuardUntilMs = open ? nowMs() + OPEN_CLOSE_GUARD_MS : 0;
  }

  function layoutFrame({
    widthPx,
    heightPx,
    marginPx,
  } = {}) {
    const screen = getScreenSizeSafe();
    const margin = Number.isFinite(marginPx)
      ? Math.max(8, Math.floor(marginPx))
      : Math.max(8, Math.floor(resolvedLayout?.marginPx ?? 28));
    const targetWidth = Number.isFinite(widthPx)
      ? Math.floor(widthPx)
      : Math.floor(resolvedLayout?.widthPx ?? 1160);
    const targetHeight = Number.isFinite(heightPx)
      ? Math.floor(heightPx)
      : Math.floor(resolvedLayout?.heightPx ?? 680);
    const panelWidth = Math.max(520, Math.min(targetWidth, screen.width - margin * 2));
    const panelHeight = Math.max(360, Math.min(targetHeight, screen.height - margin * 2));

    panel.x = Math.floor((screen.width - panelWidth) * 0.5);
    panel.y = Math.floor((screen.height - panelHeight) * 0.5);
    panelHitWidth = panelWidth;
    panelHitHeight = panelHeight;

    backdrop.clear();
    backdrop.beginFill(0x000000, backdropAlpha);
    backdrop.drawRect(0, 0, screen.width, screen.height);
    backdrop.endFill();

    panelBg.clear();
    panelBg
      .lineStyle(panelBorderWidth, panelBorder, panelBorderAlpha)
      .beginFill(panelFill, panelFillAlpha)
      .drawRoundedRect(0, 0, panelWidth, panelHeight, panelRadius)
      .endFill();

    header.setWidth(panelWidth);

    body.x = bodyPadding;
    body.y = headerHeight + bodyTopGap + bodyPadding;
    solidPanelHitArea.refresh();

    return {
      screen,
      panelWidth,
      panelHeight,
      bodyX: body.x,
      bodyY: body.y,
      bodyWidth: Math.max(0, panelWidth - bodyPadding * 2),
      bodyHeight: Math.max(0, panelHeight - body.y - bodyPadding),
    };
  }

  function getScreenRect() {
    if (!root.visible || typeof root.getBounds !== "function") return null;
    return root.getBounds();
  }

  return {
    root,
    backdrop,
    panel,
    panelBg,
    header,
    body,
    setOpenVisible,
    getScreenSize: getScreenSizeSafe,
    layoutFrame,
    getScreenRect,
  };
}
