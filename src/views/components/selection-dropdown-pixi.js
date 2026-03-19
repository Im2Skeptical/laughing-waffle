import { MUCHA_UI_COLORS } from "../ui-helpers/mucha-ui-palette.js";
import { installSolidUiHitArea } from "../ui-helpers/solid-ui-hit-area.js";

const OPEN_CLOSE_GUARD_MS = 140;

function nowMs() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

export function createSelectionDropdown(layer, app) {
  if (!layer || !app?.stage) return null;
  const container = new PIXI.Container();
  container.visible = false;
  container.zIndex = 180;
  const solidHitArea = installSolidUiHitArea(container, () => {
    const bounds = container.getLocalBounds?.() ?? null;
    return {
      x: 0,
      y: 0,
      width: bounds?.width ?? 0,
      height: bounds?.height ?? 0,
    };
  });
  layer.addChild(container);

  let outsideHandler = null;
  let onPick = null;
  let hoverHideTimeout = null;
  let outsideGuardUntilMs = 0;

  function clearHoverHide() {
    if (hoverHideTimeout == null) return;
    clearTimeout(hoverHideTimeout);
    hoverHideTimeout = null;
  }

  function scheduleHoverHide() {
    clearHoverHide();
    hoverHideTimeout = setTimeout(() => {
      if (container.visible) hide();
    }, 150);
  }

  container.on("pointerover", clearHoverHide);
  container.on("pointerout", scheduleHoverHide);

  function buildRow(entry, y, width, selected) {
    const hasDetail = !!entry?.detail;
    const rowHeight = hasDetail ? 36 : 22;
    const row = new PIXI.Container();
    row.x = 0;
    row.y = y;
    row.eventMode = "static";
    row.hitArea = new PIXI.Rectangle(0, 0, width, rowHeight);
    row.cursor = "pointer";

    const bg = new PIXI.Graphics();
    bg.beginFill(
      selected ? MUCHA_UI_COLORS.surfaces.panelSoft : MUCHA_UI_COLORS.surfaces.panelRaised,
      0.95
    );
    bg.drawRoundedRect(0, 0, width, rowHeight, 6);
    bg.endFill();
    row.addChild(bg);

    const name = new PIXI.Text(String(entry?.label ?? entry?.value ?? ""), {
      fill: MUCHA_UI_COLORS.ink.primary,
      fontSize: 11,
      fontWeight: "bold",
    });
    name.x = 8;
    name.y = 4;
    row.addChild(name);

    if (hasDetail) {
      const detail = new PIXI.Text(String(entry.detail), {
        fill: MUCHA_UI_COLORS.ink.secondary,
        fontSize: 9,
        wordWrap: true,
        wordWrapWidth: width - 12,
      });
      detail.x = 8;
      detail.y = 18;
      row.addChild(detail);
    }

    row.on("pointerdown", (ev) => {
      ev?.stopPropagation?.();
      onPick?.(entry?.value ?? null);
    });

    return { row, rowHeight };
  }

  function show({ options, selectedValue, anchor, onSelect, width = 210 }) {
    if (container.parent) {
      container.parent.addChild(container);
    }

    container.removeChildren();
    onPick = (value) => {
      onSelect?.(value);
      hide();
    };

    const list = Array.isArray(options) ? options : [];
    if (!list.length) return;

    let y = 0;
    const safeWidth = Math.max(160, Math.floor(width));
    const bg = new PIXI.Graphics();
    container.addChild(bg);

    for (const entry of list) {
      const built = buildRow(entry, y, safeWidth, entry?.value === selectedValue);
      container.addChild(built.row);
      y += built.rowHeight + 4;
    }
    if (y > 0) y -= 4;

    const height = Math.max(1, y);
    bg.beginFill(MUCHA_UI_COLORS.surfaces.panelDeep, 0.96);
    bg.drawRoundedRect(0, 0, safeWidth, height, 8);
    bg.endFill();
    container.setChildIndex(bg, 0);
    container.hitArea = new PIXI.Rectangle(0, 0, safeWidth, height);
    solidHitArea.refresh();

    const bounds = anchor || { x: 0, y: 0, width: 0, height: 0 };
    container.x = bounds.x;
    container.y = bounds.y + bounds.height + 6;
    container.visible = true;
    clearHoverHide();
    outsideGuardUntilMs = nowMs() + OPEN_CLOSE_GUARD_MS;

    if (outsideHandler) {
      app.stage.off("pointerdown", outsideHandler);
    }
    outsideHandler = (ev) => {
      if (nowMs() < outsideGuardUntilMs) return;
      const p = ev?.data?.global;
      if (!p) return;
      const b = container.getBounds();
      if (
        p.x < b.x ||
        p.x > b.x + b.width ||
        p.y < b.y ||
        p.y > b.y + b.height
      ) {
        hide();
      }
    };
    app.stage.on("pointerdown", outsideHandler);
  }

  function hide() {
    if (!container.visible) return;
    clearHoverHide();
    container.visible = false;
    container.removeChildren();
    if (outsideHandler) {
      app.stage.off("pointerdown", outsideHandler);
      outsideHandler = null;
    }
    outsideGuardUntilMs = 0;
    onPick = null;
  }

  return {
    show,
    hide,
    getScreenRect: () =>
      !container.visible || typeof container.getBounds !== "function"
        ? null
        : container.getBounds(),
  };
}
