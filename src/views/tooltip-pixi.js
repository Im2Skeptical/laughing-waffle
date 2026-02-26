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

  function init() {}

  function show(spec, anchor) {
    const { title, lines = [], maxWidth = defaultMaxWidth } = spec;
    // anchor can be {x, y} or {x, y, width, height}
    const { x, y } = anchor;
    const aw = anchor.width ?? 0;
    const ah = anchor.height ?? 0;
    const scale =
      (spec && Number.isFinite(spec.scale) ? spec.scale : null) ??
      (anchor && Number.isFinite(anchor.scale) ? anchor.scale : null) ??
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

    const scaledWidth = totalWidth * scale;
    const scaledHeight = totalHeight * scale;

    // ------------ placement: LEFT of the anchor rect ------------
    const margin = 12;

    // default: to the left, vertically centred on the anchor rect
    let posX = x - scaledWidth - margin;
    let posY = y + (ah ? (ah - scaledHeight) / 2 : 0);

    // If that would go off-screen on the left, flip to the right side
    if (posX < 10) {
      posX = x + aw + margin;
    }

    // Clamp inside the design rect
    const screen = getScreenSize();
    if (posX + scaledWidth > screen.width - clampMargin) {
      posX = screen.width - scaledWidth - clampMargin;
    }
    if (posX < clampMargin) posX = clampMargin;
    if (posY < clampMargin) posY = clampMargin;
    if (posY + scaledHeight > screen.height - clampMargin) {
      posY = screen.height - scaledHeight - clampMargin;
    }

    container.x = posX;
    container.y = posY;
    container.scale.set(scale);
    container.visible = true;
  }

  function hide() {
    if (hideTimeoutId !== null) {
      clearTimeout(hideTimeoutId);
    }
    hideTimeoutId = setTimeout(() => {
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

  function update(dt) {}

  return {
    init,
    show,
    hide,
    isVisible,
    getContainer,
    update,
  };
}
