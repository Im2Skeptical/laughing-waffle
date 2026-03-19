// board-tile-panels.js
// Crop dropdown panel for the board view.

import { cropDefs } from "../../defs/gamepieces/crops-defs.js";
import { envTileDefs } from "../../defs/gamepieces/env-tiles-defs.js";
import { INTENT_AP_COSTS } from "../../defs/gamesettings/action-costs-defs.js";
import { ActionKinds } from "../../model/actions.js";
import { MUCHA_UI_COLORS } from "../ui-helpers/mucha-ui-palette.js";
import { installSolidUiHitArea } from "../ui-helpers/solid-ui-hit-area.js";

const OPEN_CLOSE_GUARD_MS = 140;

function nowMs() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

export function createTilePanels(opts) {
  const {
    app,
    interaction,
    actionPlanner,
    getTilePlanPreview,
    queueActionWhenPaused,
    dispatchAction,
    dropdownLayer,
    flashActionGhost,
  } = opts;

  const cropDropdown = createCropDropdown(dropdownLayer, app);

  function getCropList() {
    const crops = Object.values(cropDefs || {}).filter(Boolean);
    return [
      {
        cropId: null,
        name: "Pause planting",
        isPauseOption: true,
      },
      ...crops,
    ];
  }

  function openCropDropdown(view, anchorRect) {
    if (!cropDropdown || !view?.tile) return;
    const canEdit = true;
    const envCol = Number.isFinite(view.tile?.col)
      ? Math.floor(view.tile.col)
      : view.col;
    const preview = getTilePlanPreview?.(envCol) ?? null;
    const growth = view.tile.systemState?.growth;
    const selectedId = preview?.cropId ?? growth?.selectedCropId ?? null;
    const options = getCropList();

    cropDropdown.show({
      options,
      anchor: anchorRect,
      selectedId,
      canEdit,
      onSelect: (cropId) => {
        const nextCrop = cropId ?? null;
        const tileDef = envTileDefs?.[view.tile?.defId];
        const tileName =
          tileDef?.name || view.tile?.defId || `Tile ${envCol}`;
        const cropName =
          cropId != null ? cropDefs?.[cropId]?.name || cropId : "None";
        const ghostSpec = {
          description: `Crop > ${tileName}: ${cropName}`,
          cost: Math.max(
            0,
            Math.floor(
              INTENT_AP_COSTS?.tilePlan ?? INTENT_AP_COSTS?.tileCropSelect ?? 0
            )
          ),
        };
        const runWhenPaused = () => {
          if (actionPlanner?.setTileCropSelectionIntent) {
            const res = actionPlanner.setTileCropSelectionIntent({
              envCol,
              cropId: nextCrop,
            });
            if (
              res?.ok === false &&
              res?.reason === "insufficientAP" &&
              typeof flashActionGhost === "function"
            ) {
              flashActionGhost(ghostSpec, "fail");
            }
            return res;
          }
          if (!dispatchAction) return { ok: false, reason: "noDispatch" };
          dispatchAction(
            ActionKinds.SET_TILE_CROP_SELECTION,
            { envCol, cropId: nextCrop },
            { apCost: 10 }
          );
          return { ok: true };
        };
        const runWhenLive = () => {
          if (!dispatchAction) return { ok: false, reason: "noDispatch" };
          return dispatchAction(
            ActionKinds.SET_TILE_CROP_SELECTION,
            { envCol, cropId: nextCrop },
            {
              apCost: Math.max(
                0,
                Math.floor(
                  INTENT_AP_COSTS?.tilePlan ?? INTENT_AP_COSTS?.tileCropSelect ?? 0
                )
              ),
            }
          );
        };
        if (typeof queueActionWhenPaused === "function") {
          queueActionWhenPaused({ runWhenPaused, runWhenLive });
          return;
        }
        runWhenPaused();
      },
    });
  }

  // Crop selection handled via tile tag UI, not the inspector panel.

  return {
    openCropDropdown,
    hideCropDropdown: () => cropDropdown?.hide?.(),
    isCropDropdownVisible: () => cropDropdown?.isVisible?.() ?? false,
    cropDropdownContainsPoint: (pos) => cropDropdown?.containsPoint?.(pos),
    cropDropdown,
  };
}

function createCropDropdown(layer, app) {
  if (!layer) return null;
  const container = new PIXI.Container();
  container.visible = false;
  container.zIndex = 40;
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

  function buildRow(entry, y, width, canEdit, selected) {
    const row = new PIXI.Container();
    row.x = 0;
    row.y = y;
    row.eventMode = "static";
    row.hitArea = new PIXI.Rectangle(0, 0, width, 34);

    const bg = new PIXI.Graphics()
      .beginFill(
        selected
          ? MUCHA_UI_COLORS.surfaces.panelSoft
          : MUCHA_UI_COLORS.surfaces.panelRaised,
        0.95
      )
      .drawRoundedRect(0, 0, width, 34, 6)
      .endFill();
    row.addChild(bg);

    const name = new PIXI.Text(entry.name || entry.cropId, {
      fill: MUCHA_UI_COLORS.ink.primary,
      fontSize: 11,
      fontWeight: "bold",
    });
    name.x = 8;
    name.y = 4;
    row.addChild(name);

    const detailText = entry.isPauseOption
      ? "Planting paused"
      : `Seasons: ${
          Array.isArray(entry.plantSeasons)
            ? entry.plantSeasons.join(", ")
            : "any"
        } | ${entry.maturitySec ?? "?"}s`;
    const detail = new PIXI.Text(detailText, {
      fill: MUCHA_UI_COLORS.ink.secondary,
      fontSize: 9,
    });
    detail.x = 8;
    detail.y = 18;
    row.addChild(detail);

    if (canEdit) {
      row.cursor = "pointer";
      row.on("pointerdown", (ev) => {
        ev?.stopPropagation?.();
        onPick?.(entry.cropId);
      });
    } else {
      row.cursor = "default";
      row.alpha = 0.6;
    }

    return row;
  }

  function show({ options, anchor, selectedId, canEdit, onSelect }) {
    container.removeChildren();
    onPick = (cropId) => {
      onSelect?.(cropId);
      hide();
    };

    const list = Array.isArray(options) ? options : [];
    const width = 180;
    let y = 0;

    const bg = new PIXI.Graphics();
    container.addChild(bg);

    for (const entry of list) {
      const row = buildRow(
        entry,
        y,
        width,
        canEdit,
        entry.cropId === selectedId
      );
      container.addChild(row);
      y += 38;
    }

    const height = Math.max(1, y);
    bg.beginFill(MUCHA_UI_COLORS.surfaces.panelDeep, 0.95);
    bg.drawRoundedRect(0, 0, width, height, 8);
    bg.endFill();
    container.setChildIndex(bg, 0);
    container.hitArea = new PIXI.Rectangle(0, 0, width, height);
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

  function containsPoint(globalPos) {
    if (!container.visible || !globalPos) return false;
    const b = container.getBounds();
    return (
      globalPos.x >= b.x &&
      globalPos.x <= b.x + b.width &&
      globalPos.y >= b.y &&
      globalPos.y <= b.y + b.height
    );
  }

  return {
    show,
    hide,
    isVisible: () => container.visible,
    containsPoint,
    getScreenRect: () =>
      !container.visible || typeof container.getBounds !== "function"
        ? null
        : container.getBounds(),
  };
}
