import {
  VIEWPORT_DESIGN_HEIGHT,
  VIEWPORT_DESIGN_WIDTH,
  VIEW_LAYOUT,
} from "./layout-pixi.js";
import { applyTextResolution } from "./ui-helpers/text-resolution.js";

export function createTooltipView({ layer, interaction, app, layout = null }) {
  const container = new PIXI.Container();
  container.visible = false;

  // Tooltip must not intercept mouse events
  container.eventMode = "none";
  layer.addChild(container);

  const padding = 6;
  const defaultMaxWidth = 260;
  const bg = new PIXI.Graphics();
  container.addChild(bg);

  const tooltipLayout =
    layout && typeof layout === "object" ? layout : VIEW_LAYOUT.tooltip;
  const clampMargin = Number.isFinite(tooltipLayout?.margin)
    ? Math.max(0, Math.floor(tooltipLayout.margin))
    : 10;
  let activeAnchor = null;
  let activeScale = 1;
  let activeWidth = 0;
  let activeHeight = 0;

  function getScreenSize() {
    return {
      width: Number.isFinite(app?.screen?.width)
        ? Math.max(1, Math.floor(app.screen.width))
        : VIEWPORT_DESIGN_WIDTH,
      height: Number.isFinite(app?.screen?.height)
        ? Math.max(1, Math.floor(app.screen.height))
        : VIEWPORT_DESIGN_HEIGHT,
    };
  }

  let hideTimeoutId = null;

  function resolveAnchor(anchor) {
    let source = anchor;
    if (typeof source === "function") {
      source = source();
    }
    if (source && typeof source.getAnchorRect === "function") {
      const next = source.getAnchorRect();
      if (!next || typeof next !== "object") return null;
      source = {
        ...next,
        coordinateSpace: source.coordinateSpace ?? next.coordinateSpace,
      };
    }
    if (!source || typeof source !== "object") return null;
    return {
      x: Number(source.x) || 0,
      y: Number(source.y) || 0,
      width: Number(source.width) || 0,
      height: Number(source.height) || 0,
      scale: Number.isFinite(source.scale) ? source.scale : null,
      coordinateSpace:
        source.coordinateSpace === "parent" ? "parent" : "screen",
    };
  }

  function positionTooltip(anchor, scale, totalWidth, totalHeight) {
    if (!anchor) return;
    const scaledWidth = totalWidth * scale;
    const scaledHeight = totalHeight * scale;
    const margin = 12;
    let posX = anchor.x - scaledWidth - margin;
    let posY = anchor.y + (anchor.height ? (anchor.height - scaledHeight) / 2 : 0);

    if (posX < 10) {
      posX = anchor.x + anchor.width + margin;
    }

    if (anchor.coordinateSpace === "screen") {
      const screen = getScreenSize();
      if (posX + scaledWidth > screen.width - clampMargin) {
        posX = screen.width - scaledWidth - clampMargin;
      }
      if (posX < clampMargin) posX = clampMargin;
      if (posY < clampMargin) posY = clampMargin;
      if (posY + scaledHeight > screen.height - clampMargin) {
        posY = screen.height - scaledHeight - clampMargin;
      }
      const parentPoint =
        typeof container.parent?.toLocal === "function"
          ? container.parent.toLocal({ x: posX, y: posY })
          : { x: posX, y: posY };
      container.x = parentPoint.x;
      container.y = parentPoint.y;
      return;
    }

    container.x = posX;
    container.y = posY;
  }

  function init() {}

  function show(spec, anchor) {
    const { title, lines = [], maxWidth = defaultMaxWidth } = spec;
    const resolvedAnchor = resolveAnchor(anchor);
    if (!resolvedAnchor) return;
    const scale =
      (spec && Number.isFinite(spec.scale) ? spec.scale : null) ??
      (resolvedAnchor && Number.isFinite(resolvedAnchor.scale)
        ? resolvedAnchor.scale
        : null) ??
      1;

    if (hideTimeoutId !== null) {
      clearTimeout(hideTimeoutId);
      hideTimeoutId = null;
    }

    while (container.children.length > 1) {
      container.removeChildAt(1);
    }
    bg.clear();

    const titleText = new PIXI.Text(title ?? "", {
      fill: 0xffffff,
      fontSize: 12,
      fontWeight: "bold",
      wordWrap: true,
      wordWrapWidth: maxWidth,
    });
    applyTextResolution(titleText, scale);
    titleText.x = padding;
    titleText.y = padding;
    container.addChild(titleText);

    let cy = padding + titleText.height + 4;

    for (const line of lines) {
      if (!line) continue;
      const lt = new PIXI.Text(line, {
        fill: 0xffffff,
        fontSize: 11,
        wordWrap: true,
        wordWrapWidth: maxWidth,
      });
      applyTextResolution(lt, scale);
      lt.x = padding;
      lt.y = cy;
      container.addChild(lt);
      cy += lt.height + 2;
    }

    const totalWidth = maxWidth + padding * 2;
    const totalHeight = cy + padding;

    bg.beginFill(0x000000, 0.9);
    bg.drawRoundedRect(0, 0, totalWidth, totalHeight, 8);
    bg.endFill();

    activeAnchor = anchor;
    activeScale = scale;
    activeWidth = totalWidth;
    activeHeight = totalHeight;
    positionTooltip(resolvedAnchor, scale, totalWidth, totalHeight);
    container.scale.set(scale);
    container.visible = true;
  }

  function hide() {
    if (hideTimeoutId !== null) {
      clearTimeout(hideTimeoutId);
    }
    hideTimeoutId = setTimeout(() => {
      activeAnchor = null;
      container.visible = false;
      hideTimeoutId = null;
    }, 0);
  }

  function isVisible() {
    return container.visible;
  }

  function getContainer() {
    return container;
  }

  function update(dt) {
    if (!container.visible || !activeAnchor) return;
    const resolvedAnchor = resolveAnchor(activeAnchor);
    if (!resolvedAnchor) return;
    positionTooltip(resolvedAnchor, activeScale, activeWidth, activeHeight);
  }

  return {
    init,
    show,
    hide,
    isVisible,
    getContainer,
    update,
  };
}
