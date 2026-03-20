import {
  VIEWPORT_DESIGN_HEIGHT,
  VIEWPORT_DESIGN_WIDTH,
  VIEW_LAYOUT,
} from "./layout-pixi.js";
import { applyTextResolution } from "./ui-helpers/text-resolution.js";
import { MUCHA_UI_COLORS } from "./ui-helpers/mucha-ui-palette.js";
import { getDisplayObjectWorldScale } from "./ui-helpers/display-object-scale.js";
import { keywordDefs } from "../defs/gamesystems/keyword-defs.js";
import { normalizeTooltipSpec } from "./tooltip-spec.js";

const BG_FILL = MUCHA_UI_COLORS?.surfaces?.panelDeep ?? 0x2a241d;
const BG_STROKE = MUCHA_UI_COLORS?.surfaces?.border ?? 0x8f7c60;
const BODY_TEXT = MUCHA_UI_COLORS?.ink?.primary ?? 0xf5f0e6;
const MUTED_TEXT = MUCHA_UI_COLORS?.ink?.muted ?? 0xcdbda5;
const TABLE_BG = MUCHA_UI_COLORS?.surfaces?.panel ?? 0x4f4540;
const METER_BG = MUCHA_UI_COLORS?.surfaces?.panelSoft ?? 0x443a33;

function getKeywordStyle(keywordId) {
  const def = keywordDefs?.[keywordId] ?? null;
  return {
    label: def?.label ?? keywordId,
    color: Number.isFinite(def?.accentColor)
      ? def.accentColor
      : MUCHA_UI_COLORS?.accents?.glow ?? 0x7ae2d9,
  };
}

function createTextNode(text, style, scale) {
  const node = new PIXI.Text(text, style);
  applyTextResolution(node, scale);
  return node;
}

export function createTooltipView({ layer, interaction, app, layout = null }) {
  const container = new PIXI.Container();
  container.visible = false;
  container.eventMode = "none";
  layer.addChild(container);

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
  let activeSpec = null;
  let activeResolvedAnchor = null;
  let hideTimeoutId = null;

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

  function resolveAnchor(anchor) {
    let source = anchor;
    if (typeof source === "function") source = source();
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
      side: source.side === "right" ? "right" : "left",
      alignY: source.alignY === "top" ? "top" : "center",
      offsetX: Number(source.offsetX) || 0,
      offsetY: Number(source.offsetY) || 0,
      scale: Number.isFinite(source.scale) ? source.scale : null,
      coordinateSpace:
        source.coordinateSpace === "parent" ? "parent" : "screen",
    };
  }

  function positionTooltip(anchor, scale, totalWidth, totalHeight) {
    if (!anchor) return;
    const scaledWidth = totalWidth * scale;
    const scaledHeight = totalHeight * scale;
    const margin = 14;
    let posX =
      anchor.side === "right"
        ? anchor.x + anchor.width + margin
        : anchor.x - scaledWidth - margin;
    let posY =
      anchor.alignY === "top"
        ? anchor.y
        : anchor.y + (anchor.height ? (anchor.height - scaledHeight) / 2 : 0);

    posX += anchor.offsetX || 0;
    posY += anchor.offsetY || 0;

    if (anchor.side !== "right" && posX < clampMargin) {
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

  function getAnchorRectForDisplayObject(displayObject, coordinateSpace = "parent") {
    if (!displayObject || typeof displayObject.getBounds !== "function") return null;
    const bounds = displayObject.getBounds();
    if (!bounds) return null;
    if (coordinateSpace === "screen") {
      return {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        coordinateSpace: "screen",
      };
    }
    const parent = container.parent;
    if (!parent || typeof parent.toLocal !== "function") {
      return {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        coordinateSpace: "screen",
      };
    }
    const topLeft = parent.toLocal({ x: bounds.x, y: bounds.y });
    const bottomRight = parent.toLocal({
      x: bounds.x + bounds.width,
      y: bounds.y + bounds.height,
    });
    return {
      x: topLeft.x,
      y: topLeft.y,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y,
      coordinateSpace: "parent",
    };
  }

  function clearChildren() {
    while (container.children.length > 1) {
      container.removeChildAt(1);
    }
  }

  function renderParagraph(section, x, y, maxWidth, scale) {
    let cursorY = y;
    if (section.title) {
      const titleNode = createTextNode(
        section.title,
        {
          fill: MUTED_TEXT,
          fontSize: 10,
          fontWeight: "bold",
        },
        scale
      );
      titleNode.x = x;
      titleNode.y = cursorY;
      container.addChild(titleNode);
      cursorY += titleNode.height + 2;
    }

    const row = new PIXI.Container();
    row.x = x;
    row.y = cursorY;
    container.addChild(row);
    let cursorX = 0;
    let rowHeight = 0;
    for (const segment of section.segments || []) {
      const keywordStyle =
        segment.kind === "keyword" ? getKeywordStyle(segment.keywordId) : null;
      const node = createTextNode(
        segment.text,
        {
          fill: keywordStyle?.color ?? BODY_TEXT,
          fontSize: 11,
          fontWeight: keywordStyle ? "bold" : "normal",
        },
        scale
      );
      node.x = cursorX;
      node.y = 0;
      row.addChild(node);
      cursorX += node.width + 3;
      rowHeight = Math.max(rowHeight, node.height);
      if (cursorX > maxWidth && row.children.length === 1) {
        node.style.wordWrap = true;
        node.style.wordWrapWidth = maxWidth;
        node.x = 0;
        cursorX = node.width;
        rowHeight = Math.max(rowHeight, node.height);
      }
    }
    return cursorY + rowHeight;
  }

  function renderMeter(section, x, y, maxWidth, scale) {
    const labelNode = createTextNode(
      section.label || "",
      {
        fill: BODY_TEXT,
        fontSize: 11,
        fontWeight: "bold",
      },
      scale
    );
    labelNode.x = x;
    labelNode.y = y;
    container.addChild(labelNode);

    const meterY = y + labelNode.height + 4;
    const meterWidth = maxWidth;
    const meterHeight = 14;
    const bgBar = new PIXI.Graphics();
    bgBar.beginFill(METER_BG, 0.95);
    bgBar.lineStyle(1, BG_STROKE, 0.9);
    bgBar.drawRoundedRect(x, meterY, meterWidth, meterHeight, 7);
    bgBar.endFill();
    container.addChild(bgBar);

    const ratio =
      section.max > 0 ? Math.max(0, Math.min(1, section.value / section.max)) : 0;
    if (ratio > 0) {
      const fill = new PIXI.Graphics();
      fill.beginFill(section.accentColor ?? 0xb9845c, 0.95);
      fill.drawRoundedRect(x + 1, meterY + 1, Math.max(2, (meterWidth - 2) * ratio), meterHeight - 2, 6);
      fill.endFill();
      container.addChild(fill);
    }

    const textNode = createTextNode(
      section.text ?? `${Math.round(section.value)}/${Math.round(section.max)}`,
      {
        fill: BODY_TEXT,
        fontSize: 10,
        fontWeight: "bold",
      },
      scale
    );
    textNode.x = x + 6;
    textNode.y = meterY - 1;
    container.addChild(textNode);
    return meterY + meterHeight;
  }

  function renderTable(section, x, y, maxWidth, scale) {
    let cursorY = y;
    if (section.title) {
      const titleNode = createTextNode(
        section.title,
        {
          fill: MUTED_TEXT,
          fontSize: 10,
          fontWeight: "bold",
        },
        scale
      );
      titleNode.x = x;
      titleNode.y = cursorY;
      container.addChild(titleNode);
      cursorY += titleNode.height + 4;
    }
    const rowHeight = 20;
    const labelWidth = Math.floor(maxWidth * 0.58);
    for (const row of section.rows || []) {
      const rowBg = new PIXI.Graphics();
      rowBg.beginFill(TABLE_BG, 0.92);
      rowBg.drawRoundedRect(x, cursorY, maxWidth, rowHeight, 4);
      rowBg.endFill();
      container.addChild(rowBg);

      const labelNode = createTextNode(
        row.label,
        {
          fill: BODY_TEXT,
          fontSize: 10,
          fontWeight: "bold",
        },
        scale
      );
      labelNode.x = x + 8;
      labelNode.y = cursorY + 3;
      labelNode.style.wordWrap = true;
      labelNode.style.wordWrapWidth = labelWidth - 12;
      container.addChild(labelNode);

      const valueNode = createTextNode(
        row.value,
        {
          fill: BODY_TEXT,
          fontSize: 10,
          fontWeight: "bold",
        },
        scale
      );
      valueNode.x = x + labelWidth;
      valueNode.y = cursorY + 3;
      container.addChild(valueNode);

      cursorY += rowHeight + 4;
    }
    return cursorY - 4;
  }

  function renderKeywordRow(section, x, y, maxWidth, scale) {
    let cursorY = y;
    if (section.title) {
      const titleNode = createTextNode(
        section.title,
        {
          fill: MUTED_TEXT,
          fontSize: 10,
          fontWeight: "bold",
        },
        scale
      );
      titleNode.x = x;
      titleNode.y = cursorY;
      container.addChild(titleNode);
      cursorY += titleNode.height + 4;
    }
    let cursorX = x;
    let rowHeight = 0;
    for (const entry of section.entries || []) {
      const keywordStyle = getKeywordStyle(entry.keywordId);
      const pill = createTextNode(
        entry.text,
        {
          fill: keywordStyle.color,
          fontSize: 10,
          fontWeight: "bold",
        },
        scale
      );
      if (cursorX + pill.width > x + maxWidth) {
        cursorX = x;
        cursorY += rowHeight + 4;
        rowHeight = 0;
      }
      pill.x = cursorX;
      pill.y = cursorY;
      container.addChild(pill);
      cursorX += pill.width + 8;
      rowHeight = Math.max(rowHeight, pill.height);
    }
    return cursorY + rowHeight;
  }

  function renderSections(spec, padding, scale) {
    const maxWidth = spec.maxWidth;
    const contentWidth = maxWidth;
    let cursorY = padding;
    if (spec.title) {
      const titleNode = createTextNode(
        spec.title,
        {
          fill: BODY_TEXT,
          fontSize: 16,
          fontWeight: "bold",
        },
        scale
      );
      titleNode.x = padding;
      titleNode.y = cursorY;
      container.addChild(titleNode);
      cursorY += titleNode.height + 2;
    }
    if (spec.subtitle) {
      const subtitleNode = createTextNode(
        spec.subtitle,
        {
          fill: MUTED_TEXT,
          fontSize: 10,
          fontWeight: "bold",
        },
        scale
      );
      subtitleNode.x = padding;
      subtitleNode.y = cursorY;
      container.addChild(subtitleNode);
      cursorY += subtitleNode.height + 6;
    }
    for (const section of spec.sections || []) {
      let bottomY = cursorY;
      if (section.type === "meter") {
        bottomY = renderMeter(section, padding, cursorY, contentWidth, scale);
      } else if (section.type === "table") {
        bottomY = renderTable(section, padding, cursorY, contentWidth, scale);
      } else if (section.type === "keywordRow") {
        bottomY = renderKeywordRow(section, padding, cursorY, contentWidth, scale);
      } else {
        bottomY = renderParagraph(section, padding, cursorY, contentWidth, scale);
      }
      cursorY = bottomY + 8;
    }
    return {
      width: contentWidth + padding * 2,
      height: cursorY - 2 + padding,
    };
  }

  function getTooltipLayerWorldScale() {
    return getDisplayObjectWorldScale(container.parent, 1);
  }

  function getRelativeDisplayScale(displayObject, fallback = 1) {
    const objectScale = getDisplayObjectWorldScale(displayObject, fallback);
    const layerScale = getTooltipLayerWorldScale();
    const relativeScale =
      Number.isFinite(layerScale) && layerScale > 0
        ? objectScale / layerScale
        : objectScale;
    if (!Number.isFinite(relativeScale) || relativeScale <= 0) {
      return fallback;
    }
    return relativeScale;
  }

  function summarizeAnchor(anchor) {
    if (!anchor) return null;
    return {
      x: Number(anchor.x) || 0,
      y: Number(anchor.y) || 0,
      width: Number(anchor.width) || 0,
      height: Number(anchor.height) || 0,
      side: anchor.side === "right" ? "right" : "left",
      alignY: anchor.alignY === "top" ? "top" : "center",
      coordinateSpace:
        anchor.coordinateSpace === "parent" ? "parent" : "screen",
      scale: Number.isFinite(anchor.scale) ? anchor.scale : null,
    };
  }

  function show(spec, anchor) {
    const resolvedAnchor = resolveAnchor(anchor);
    if (!resolvedAnchor) return;
    if (hideTimeoutId !== null) {
      clearTimeout(hideTimeoutId);
      hideTimeoutId = null;
    }
    clearChildren();
    bg.clear();

    const normalizedSpec = normalizeTooltipSpec(spec);
    const scale =
      normalizedSpec.scale ??
      resolvedAnchor.scale ??
      1;
    const padding = 10;
    const contentSize = renderSections(normalizedSpec, padding, scale);

    bg.beginFill(BG_FILL, 0.96);
    bg.lineStyle(2, normalizedSpec.accentColor ?? BG_STROKE, 0.9);
    bg.drawRoundedRect(0, 0, contentSize.width, contentSize.height, 10);
    bg.endFill();

    activeAnchor = anchor;
    activeScale = Number.isFinite(scale) ? scale : 1;
    activeWidth = contentSize.width;
    activeHeight = contentSize.height;
    activeSpec = normalizedSpec;
    activeResolvedAnchor = summarizeAnchor(resolvedAnchor);
    positionTooltip(resolvedAnchor, activeScale, activeWidth, activeHeight);
    container.scale.set(activeScale);
    container.visible = true;
  }

  function hide() {
    if (hideTimeoutId !== null) clearTimeout(hideTimeoutId);
    hideTimeoutId = setTimeout(() => {
      activeAnchor = null;
      activeSpec = null;
      activeResolvedAnchor = null;
      container.visible = false;
      hideTimeoutId = null;
    }, 0);
  }

  function update() {
    if (!container.visible || !activeAnchor) return;
    const resolvedAnchor = resolveAnchor(activeAnchor);
    if (!resolvedAnchor) return;
    activeResolvedAnchor = summarizeAnchor(resolvedAnchor);
    positionTooltip(resolvedAnchor, activeScale, activeWidth, activeHeight);
  }

  function init() {}

  return {
    init,
    show,
    hide,
    isVisible: () => container.visible,
    getContainer: () => container,
    getAnchorRectForDisplayObject,
    getRelativeDisplayScale,
    getActiveSpec: () => activeSpec,
    getDebugState: () => ({
      visible: container.visible === true,
      x: Number(container.x) || 0,
      y: Number(container.y) || 0,
      scale: Number.isFinite(activeScale) ? activeScale : 1,
      width: Number(activeWidth) || 0,
      height: Number(activeHeight) || 0,
      layerScale: getTooltipLayerWorldScale(),
      sourceKind: activeSpec?.sourceKind ?? null,
      sourceId: activeSpec?.sourceId ?? null,
      title: activeSpec?.title ?? "",
      anchor: activeResolvedAnchor,
    }),
    update,
  };
}
