import { MUCHA_UI_COLORS } from "../ui-helpers/mucha-ui-palette.js";
import { createWindowHeader } from "../ui-helpers/window-header.js";
import { applyTextResolution } from "../ui-helpers/text-resolution.js";

const MANUAL_UI_SCALE = 2;

function scaleUi(value) {
  return Math.max(1, Math.floor(Number(value || 0) * MANUAL_UI_SCALE));
}

const PANEL_RADIUS = scaleUi(12);
const HEADER_HEIGHT = scaleUi(26);
const PANEL_PAD = scaleUi(12);
const PANE_GAP = scaleUi(12);
const PANE_RADIUS = scaleUi(9);
const PANE_PAD = scaleUi(10);
const ROW_HEIGHT = scaleUi(28);
const ROW_GAP = scaleUi(6);
const LIST_TITLE_HEIGHT = scaleUi(18);
const ACTION_BUTTON_WIDTH = scaleUi(64);
const ACTION_BUTTON_HEIGHT = scaleUi(18);
const SCROLLBAR_WIDTH = scaleUi(8);

function clampInt(value, minValue, maxValue) {
  const n = Number.isFinite(value) ? Math.floor(value) : minValue;
  return Math.max(minValue, Math.min(maxValue, n));
}

function ensurePositiveInt(value, fallback) {
  const n = Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(1, n);
}

function buildScreenSignature(width, height) {
  return `${Math.max(1, Math.floor(width || 0))}x${Math.max(
    1,
    Math.floor(height || 0)
  )}`;
}

function fitTextToWidth(textNode, fullText, maxWidth, suffix = "...") {
  if (!textNode) return "";
  const safeText = String(fullText ?? "");
  const limit = Number.isFinite(maxWidth) ? Math.max(0, Math.floor(maxWidth)) : 0;
  if (limit <= 0) {
    textNode.text = "";
    return "";
  }

  textNode.text = safeText;
  if (textNode.width <= limit) return safeText;

  textNode.text = suffix;
  if (textNode.width > limit) {
    textNode.text = "";
    return "";
  }

  let lo = 0;
  let hi = safeText.length;
  let best = suffix;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const candidate = `${safeText.slice(0, mid)}${suffix}`;
    textNode.text = candidate;
    if (textNode.width <= limit) {
      best = candidate;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  textNode.text = best;
  return best;
}

function applyTextResolutionToTree(root, PIXIRef, uiScale = 1) {
  if (!root || !Array.isArray(root.children)) return 0;
  const scale = Number.isFinite(uiScale) ? Math.max(1, uiScale) : 1;
  let updated = 0;
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (node instanceof PIXIRef.Text) {
      if (applyTextResolution(node, scale)) updated += 1;
    }
    const children = Array.isArray(node.children) ? node.children : null;
    if (!children || children.length <= 0) continue;
    for (let i = 0; i < children.length; i += 1) {
      stack.push(children[i]);
    }
  }
  return updated;
}

export function createRecipeManualWindow({
  PIXI,
  app,
  layer,
  layout = null,
  resolveViewModel = null,
  onToggleRecipe = null,
} = {}) {
  const root = new PIXI.Container();
  root.visible = false;
  root.eventMode = "none";
  root.zIndex = Number.isFinite(layout?.zIndex) ? Math.floor(layout.zIndex) : 80;
  if (layer) {
    layer.sortableChildren = true;
    layer.addChild(root);
  }

  const backdrop = new PIXI.Graphics();
  backdrop.eventMode = "static";
  backdrop.cursor = "pointer";
  backdrop.on("pointertap", (ev) => {
    ev?.stopPropagation?.();
    close("backdrop");
  });
  root.addChild(backdrop);

  const panel = new PIXI.Container();
  panel.eventMode = "static";
  panel.on("pointerdown", (ev) => ev?.stopPropagation?.());
  panel.on("pointertap", (ev) => ev?.stopPropagation?.());
  root.addChild(panel);

  const panelBg = new PIXI.Graphics();
  panel.addChild(panelBg);

  const headerHost = new PIXI.Container();
  panel.addChild(headerHost);
  const header = createWindowHeader({
    stage: app?.stage,
    parent: headerHost,
    width: 400,
    height: HEADER_HEIGHT,
    radius: PANEL_RADIUS,
    background: MUCHA_UI_COLORS.surfaces.header,
    title: "Recipies",
    titleStyle: {
      fill: MUCHA_UI_COLORS.ink.primary,
      fontSize: scaleUi(13),
      fontWeight: "bold",
    },
    paddingX: 10,
    paddingY: 5,
    showPin: false,
    showClose: true,
    closeOffsetX: 8,
    closeButtonWidth: 42,
    closeButtonHeight: 16,
    onClose: () => close("closeButton"),
  });

  const body = new PIXI.Container();
  body.y = HEADER_HEIGHT + 6;
  panel.addChild(body);

  const leftPane = new PIXI.Container();
  body.addChild(leftPane);
  const leftBg = new PIXI.Graphics();
  leftPane.addChild(leftBg);
  const leftTitle = new PIXI.Text("Unlocked Recipies", {
    fill: MUCHA_UI_COLORS.ink.primary,
    fontSize: scaleUi(12),
    fontWeight: "bold",
  });
  leftPane.addChild(leftTitle);

  const leftViewport = new PIXI.Container();
  leftPane.addChild(leftViewport);
  const leftRows = new PIXI.Container();
  leftViewport.addChild(leftRows);
  const leftMask = new PIXI.Graphics();
  leftPane.addChild(leftMask);
  leftViewport.mask = leftMask;

  const leftScrollbarTrack = new PIXI.Graphics();
  leftPane.addChild(leftScrollbarTrack);
  const leftScrollbarThumb = new PIXI.Graphics();
  leftPane.addChild(leftScrollbarThumb);

  const leftEmptyText = new PIXI.Text("No unlocked recipes available.", {
    fill: MUCHA_UI_COLORS.ink.secondary,
    fontSize: scaleUi(11),
    wordWrap: true,
    breakWords: true,
  });
  leftPane.addChild(leftEmptyText);

  const rightPane = new PIXI.Container();
  body.addChild(rightPane);
  const rightBg = new PIXI.Graphics();
  rightPane.addChild(rightBg);
  const rightHeader = new PIXI.Text("Recipe Details", {
    fill: MUCHA_UI_COLORS.ink.primary,
    fontSize: scaleUi(12),
    fontWeight: "bold",
  });
  rightPane.addChild(rightHeader);
  const rightDetails = new PIXI.Text("", {
    fill: MUCHA_UI_COLORS.ink.secondary,
    fontSize: scaleUi(12),
    wordWrap: true,
    breakWords: true,
    lineHeight: scaleUi(16),
  });
  rightPane.addChild(rightDetails);

  let openContext = null;
  let selectedRecipeId = null;
  let scrollOffset = 0;
  let leftListMaxScroll = 0;
  let currentModelSignature = "";
  let currentScreenSignature = "";
  let panelWidth = 0;
  let panelHeight = 0;
  let leftViewportWidth = 0;
  let leftViewportHeight = 0;
  let leftViewportX = 0;
  let leftViewportY = 0;

  function getScreenSize() {
    return {
      width: ensurePositiveInt(app?.renderer?.width, 2424),
      height: ensurePositiveInt(app?.renderer?.height, 1080),
    };
  }

  function toStageCoordsFromClient(clientX, clientY) {
    const rect = app?.view?.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    const rw = ensurePositiveInt(app?.renderer?.width, rect.width);
    const rh = ensurePositiveInt(app?.renderer?.height, rect.height);
    const x = ((Number(clientX) - rect.left) / rect.width) * rw;
    const y = ((Number(clientY) - rect.top) / rect.height) * rh;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return new PIXI.Point(x, y);
  }

  function clampScroll() {
    scrollOffset = clampInt(scrollOffset, 0, leftListMaxScroll);
    leftRows.y = -scrollOffset;
  }

  function computeDefaultSelection(model) {
    if (!model || !Array.isArray(model.rows) || model.rows.length <= 0) return null;
    const ids = new Set(model.rows.map((row) => row?.id).filter((id) => !!id));
    if (selectedRecipeId && ids.has(selectedRecipeId)) return selectedRecipeId;
    if (model.defaultRecipeId && ids.has(model.defaultRecipeId)) {
      return model.defaultRecipeId;
    }
    return model.rows[0]?.id ?? null;
  }

  function buildModelSignature(model, selectedId = null) {
    if (!model || !Array.isArray(model.rows)) return "none";
    const rowSig = model.rows
      .map((row) => {
        const id = String(row?.id || "");
        const name = String(row?.name || "");
        const inList = row?.inList ? "1" : "0";
        const enabled = row?.enabled ? "1" : "0";
        const action = String(row?.actionLabel || "");
        const status = String(row?.statusText || "");
        const snapshot = String(row?.snapshotText || "");
        const gate = String(row?.gateText || "");
        const detail = Array.isArray(row?.detailLines)
          ? row.detailLines.map((entry) => String(entry || "")).join("~")
          : "";
        return `${id}:${name}:${inList}:${enabled}:${action}:${status}:${snapshot}:${gate}:${detail}`;
      })
      .join("|");
    return `${String(model?.title || "")}#${String(
      model?.defaultRecipeId || ""
    )}#${String(selectedId || "")}#${rowSig}`;
  }

  function clearLeftRows() {
    leftRows.removeChildren();
  }

  function drawScrollbar() {
    leftScrollbarTrack.clear();
    leftScrollbarThumb.clear();
    if (leftViewportHeight <= 0 || leftListMaxScroll <= 0) return;

    const trackX = leftViewportX + leftViewportWidth + 2;
    const trackY = leftViewportY;
    const trackH = leftViewportHeight;

    leftScrollbarTrack
      .lineStyle(1, MUCHA_UI_COLORS.surfaces.borderSoft, 0.8)
      .beginFill(MUCHA_UI_COLORS.surfaces.panelDeep, 0.92)
      .drawRoundedRect(trackX, trackY, SCROLLBAR_WIDTH, trackH, 4)
      .endFill();

    const thumbRatio = Math.max(
      0.1,
      Math.min(1, leftViewportHeight / (leftViewportHeight + leftListMaxScroll))
    );
    const thumbH = Math.max(20, Math.floor(trackH * thumbRatio));
    const usable = Math.max(0, trackH - thumbH);
    const scrollRatio = leftListMaxScroll > 0 ? scrollOffset / leftListMaxScroll : 0;
    const thumbY = trackY + Math.floor(usable * scrollRatio);

    leftScrollbarThumb
      .lineStyle(1, MUCHA_UI_COLORS.surfaces.border, 0.95)
      .beginFill(MUCHA_UI_COLORS.surfaces.panelSoft, 0.98)
      .drawRoundedRect(trackX + 1, thumbY, SCROLLBAR_WIDTH - 2, thumbH, 3)
      .endFill();
  }

  function drawPaneBoxes(innerHeight, leftWidth, rightWidth) {
    panelBg.clear();
    panelBg
      .lineStyle(2, MUCHA_UI_COLORS.surfaces.borderSoft, 0.95)
      .beginFill(MUCHA_UI_COLORS.surfaces.panelDeep, 0.97)
      .drawRoundedRect(0, 0, panelWidth, panelHeight, PANEL_RADIUS)
      .endFill();

    leftBg.clear();
    leftBg
      .lineStyle(1, MUCHA_UI_COLORS.surfaces.borderSoft, 0.9)
      .beginFill(MUCHA_UI_COLORS.surfaces.panel, 0.95)
      .drawRoundedRect(0, 0, leftWidth, innerHeight, PANE_RADIUS)
      .endFill();

    rightBg.clear();
    rightBg
      .lineStyle(1, MUCHA_UI_COLORS.surfaces.borderSoft, 0.9)
      .beginFill(MUCHA_UI_COLORS.surfaces.panel, 0.95)
      .drawRoundedRect(0, 0, rightWidth, innerHeight, PANE_RADIUS)
      .endFill();
  }

  function layoutPanel() {
    const screen = getScreenSize();
    const marginPx = Number.isFinite(layout?.marginPx)
      ? Math.max(8, Math.floor(layout.marginPx))
      : 28;
    const widthPx = Number.isFinite(layout?.widthPx)
      ? Math.max(520, Math.floor(layout.widthPx))
      : 1160;
    const heightPx = Number.isFinite(layout?.heightPx)
      ? Math.max(360, Math.floor(layout.heightPx))
      : 680;
    const maxWidth = Math.max(520, screen.width - marginPx * 2);
    const maxHeight = Math.max(360, screen.height - marginPx * 2);
    panelWidth = Math.max(520, Math.min(widthPx, maxWidth));
    panelHeight = Math.max(360, Math.min(heightPx, maxHeight));

    panel.x = Math.floor((screen.width - panelWidth) * 0.5);
    panel.y = Math.floor((screen.height - panelHeight) * 0.5);

    backdrop.clear();
    backdrop.beginFill(0x000000, 0.62);
    backdrop.drawRect(0, 0, screen.width, screen.height);
    backdrop.endFill();

    header.setWidth(panelWidth);

    const innerWidth = Math.max(240, panelWidth - PANEL_PAD * 2);
    const innerHeight = Math.max(
      160,
      panelHeight - (HEADER_HEIGHT + 6) - PANEL_PAD * 2
    );
    body.x = PANEL_PAD;
    body.y = HEADER_HEIGHT + 6 + PANEL_PAD;

    const leftWidth = Math.max(220, Math.floor((innerWidth - PANE_GAP) * 0.4));
    const rightWidth = Math.max(220, innerWidth - leftWidth - PANE_GAP);

    leftPane.x = 0;
    leftPane.y = 0;
    rightPane.x = leftWidth + PANE_GAP;
    rightPane.y = 0;

    drawPaneBoxes(innerHeight, leftWidth, rightWidth);

    leftTitle.x = PANE_PAD;
    leftTitle.y = PANE_PAD;
    fitTextToWidth(leftTitle, "Unlocked Recipies", leftWidth - PANE_PAD * 2);

    leftViewportX = PANE_PAD;
    leftViewportY = PANE_PAD + LIST_TITLE_HEIGHT;
    leftViewportWidth = Math.max(
      80,
      leftWidth - PANE_PAD * 2 - (SCROLLBAR_WIDTH + 2)
    );
    leftViewportHeight = Math.max(
      40,
      innerHeight - leftViewportY - PANE_PAD
    );
    leftViewport.x = leftViewportX;
    leftViewport.y = leftViewportY;
    leftMask.clear();
    leftMask.beginFill(0xffffff, 1);
    leftMask.drawRoundedRect(
      leftViewportX,
      leftViewportY,
      leftViewportWidth,
      leftViewportHeight,
      6
    );
    leftMask.endFill();

    leftEmptyText.x = leftViewportX;
    leftEmptyText.y = leftViewportY + 4;
    leftEmptyText.style.wordWrapWidth = leftViewportWidth;

    rightHeader.x = PANE_PAD;
    rightHeader.y = PANE_PAD;
    fitTextToWidth(rightHeader, "Recipe Details", rightWidth - PANE_PAD * 2);
    rightDetails.x = PANE_PAD;
    rightDetails.y = rightHeader.y + rightHeader.height + 6;
    rightDetails.style.wordWrapWidth = Math.max(80, rightWidth - PANE_PAD * 2);

    applyTextResolutionToTree(root, PIXI, MANUAL_UI_SCALE);
  }

  function buildDetailsText(row) {
    if (!row) return "Select a recipe from the left list to inspect details.";
    const lines = [];
    lines.push(String(row?.name || "Recipe"));
    if (row?.kindLabel) lines.push(String(row.kindLabel));
    if (row?.statusText) lines.push(`Status: ${row.statusText}`);
    if (row?.snapshotText) lines.push(`${row.snapshotText}`);
    if (row?.gateText) lines.push(`Gate: ${row.gateText}`);
    const detailLines = Array.isArray(row?.detailLines) ? row.detailLines : [];
    for (const line of detailLines) {
      if (!line) continue;
      lines.push(String(line));
    }
    return lines.join("\n");
  }

  function redrawRows(model) {
    clearLeftRows();
    const rows = Array.isArray(model?.rows) ? model.rows : [];
    leftEmptyText.visible = rows.length <= 0;
    if (rows.length <= 0) {
      leftListMaxScroll = 0;
      scrollOffset = 0;
      leftRows.y = 0;
      drawScrollbar();
      rightDetails.text =
        String(model?.emptyDetailText || "") ||
        "No unlocked recipes are available for this structure.";
      applyTextResolution(rightDetails, MANUAL_UI_SCALE);
      return;
    }

    const rowWidth = Math.max(80, leftViewportWidth);
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const rowId = row?.id;
      if (!rowId) continue;

      const rowRoot = new PIXI.Container();
      rowRoot.y = i * (ROW_HEIGHT + ROW_GAP);
      rowRoot.eventMode = "static";
      rowRoot.cursor = "pointer";
      rowRoot.hitArea = new PIXI.Rectangle(0, 0, rowWidth, ROW_HEIGHT);
      rowRoot.on("pointertap", (ev) => {
        ev?.stopPropagation?.();
        selectedRecipeId = rowId;
      });

      const rowBg = new PIXI.Graphics();
      const selected = selectedRecipeId === rowId;
      const borderColor = selected
        ? MUCHA_UI_COLORS.accents.gold
        : MUCHA_UI_COLORS.surfaces.borderSoft;
      const fillColor = selected
        ? MUCHA_UI_COLORS.surfaces.panelRaised
        : MUCHA_UI_COLORS.surfaces.panelDeep;
      rowBg
        .lineStyle(1, borderColor, 0.95)
        .beginFill(fillColor, 0.97)
        .drawRoundedRect(0, 0, rowWidth, ROW_HEIGHT, 7)
        .endFill();
      rowRoot.addChild(rowBg);

      const label = new PIXI.Text(String(row?.name || rowId), {
        fill: MUCHA_UI_COLORS.ink.primary,
        fontSize: scaleUi(11),
        fontWeight: selected ? "bold" : "normal",
      });
      label.x = 8;
      label.y = Math.floor((ROW_HEIGHT - label.height) * 0.5);
      fitTextToWidth(
        label,
        String(row?.name || rowId),
        Math.max(24, rowWidth - ACTION_BUTTON_WIDTH - 18)
      );
      rowRoot.addChild(label);
      applyTextResolution(label, MANUAL_UI_SCALE);

      const actionButton = new PIXI.Container();
      actionButton.eventMode = "static";
      actionButton.cursor = "pointer";
      actionButton.x = rowWidth - ACTION_BUTTON_WIDTH - 6;
      actionButton.y = Math.floor((ROW_HEIGHT - ACTION_BUTTON_HEIGHT) * 0.5);
      actionButton.on("pointertap", (ev) => {
        ev?.stopPropagation?.();
        selectedRecipeId = rowId;
        onToggleRecipe?.({
          targetRef: openContext?.targetRef || null,
          systemId: openContext?.systemId || null,
          recipeId: rowId,
        });
      });

      const actionBg = new PIXI.Graphics();
      const actionFill =
        String(row?.actionLabel || "Add").toLowerCase() === "remove"
          ? MUCHA_UI_COLORS.intent.warnPop
          : MUCHA_UI_COLORS.surfaces.borderSoft;
      actionBg
        .lineStyle(1, MUCHA_UI_COLORS.surfaces.border, 0.95)
        .beginFill(actionFill, 0.97)
        .drawRoundedRect(0, 0, ACTION_BUTTON_WIDTH, ACTION_BUTTON_HEIGHT, 7)
        .endFill();
      actionButton.addChild(actionBg);

      const actionText = new PIXI.Text(String(row?.actionLabel || "Add"), {
        fill: MUCHA_UI_COLORS.ink.primary,
        fontSize: scaleUi(10),
        fontWeight: "bold",
      });
      actionText.x = Math.floor((ACTION_BUTTON_WIDTH - actionText.width) * 0.5);
      actionText.y = Math.floor((ACTION_BUTTON_HEIGHT - actionText.height) * 0.5);
      actionButton.addChild(actionText);
      applyTextResolution(actionText, MANUAL_UI_SCALE);

      rowRoot.addChild(actionButton);
      leftRows.addChild(rowRoot);
    }

    const contentHeight = Math.max(
      0,
      rows.length * (ROW_HEIGHT + ROW_GAP) - ROW_GAP
    );
    leftListMaxScroll = Math.max(0, contentHeight - leftViewportHeight);
    clampScroll();
    drawScrollbar();

    const selectedRow = rows.find((row) => row?.id === selectedRecipeId) || null;
    rightDetails.text = buildDetailsText(selectedRow);
    applyTextResolution(rightDetails, MANUAL_UI_SCALE);
  }

  function setOpenVisible(open) {
    root.visible = !!open;
    root.eventMode = open ? "static" : "none";
  }

  function ensureLayout(force = false) {
    if (!isOpen() && !force) return;
    const screen = getScreenSize();
    const screenSig = buildScreenSignature(screen.width, screen.height);
    if (!force && currentScreenSignature === screenSig) return;
    currentScreenSignature = screenSig;
    layoutPanel();
    currentModelSignature = "";
    drawScrollbar();
  }

  function close(reason = "unknown") {
    openContext = null;
    selectedRecipeId = null;
    scrollOffset = 0;
    leftListMaxScroll = 0;
    currentModelSignature = "";
    setOpenVisible(false);
    clearLeftRows();
    rightDetails.text = "";
    leftEmptyText.visible = false;
    drawScrollbar();
    return reason;
  }

  function isOpen() {
    return !!openContext;
  }

  function open({ targetRef, systemId } = {}) {
    if (!targetRef || typeof systemId !== "string" || systemId.length <= 0) return;
    openContext = { targetRef, systemId };
    selectedRecipeId = null;
    scrollOffset = 0;
    leftListMaxScroll = 0;
    currentModelSignature = "";
    setOpenVisible(true);
    ensureLayout(true);
  }

  function update(state) {
    if (!isOpen()) return;
    if (!state || typeof resolveViewModel !== "function") {
      close("noState");
      return;
    }

    ensureLayout(false);
    const model = resolveViewModel({
      state,
      targetRef: openContext.targetRef,
      systemId: openContext.systemId,
      selectedRecipeId,
    });
    if (!model || typeof model !== "object") {
      close("invalidTarget");
      return;
    }

    selectedRecipeId = computeDefaultSelection(model);
    header.setTitle(String(model?.title || "Recipies"));
    const nextSignature = buildModelSignature(model, selectedRecipeId);
    if (nextSignature === currentModelSignature) {
      return;
    }
    currentModelSignature = nextSignature;
    redrawRows(model);
  }

  function resize() {
    ensureLayout(true);
  }

  function onWheel(ev) {
    if (!isOpen() || leftListMaxScroll <= 0) return;
    const stagePoint = toStageCoordsFromClient(ev?.clientX, ev?.clientY);
    if (!stagePoint) return;
    const local = leftViewport.toLocal(stagePoint);
    if (
      local.x < 0 ||
      local.y < 0 ||
      local.x > leftViewportWidth ||
      local.y > leftViewportHeight
    ) {
      return;
    }
    ev.preventDefault();
    scrollOffset = clampInt(scrollOffset + Math.round(ev.deltaY), 0, leftListMaxScroll);
    clampScroll();
    drawScrollbar();
  }

  app?.view?.addEventListener?.("wheel", onWheel, { passive: false });

  return {
    open,
    close,
    isOpen,
    update,
    resize,
  };
}
