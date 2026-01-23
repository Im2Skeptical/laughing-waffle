// board-tile-panels.js
// Tile inspector + crop dropdown panels for the board view.

import { cropDefs } from "../../defs/gamepieces/crops-defs.js";
import { ActionKinds } from "../../model/actions.js";

export function createTilePanels(opts) {
  const {
    app,
    interaction,
    actionPlanner,
    dispatchAction,
    inspectorLayer,
    dropdownLayer,
    getTileUi,
  } = opts;

  const tileInspector = createTileInspector(inspectorLayer);
  const cropDropdown = createCropDropdown(dropdownLayer, app);
  let inspectedTile = null;

  function getCropList() {
    return Object.values(cropDefs || {}).filter(Boolean);
  }

  function positionTileInspector(anchor) {
    if (!tileInspector || !anchor) return;
    const margin = 12;
    const width = tileInspector.width;
    const height = tileInspector.height;
    const screenW = app.screen.width;
    const screenH = app.screen.height;

    let x = anchor.x + anchor.width + margin;
    if (x + width > screenW - 10) {
      x = anchor.x - width - margin;
    }
    let y = anchor.y;
    if (y + height > screenH - 10) {
      y = screenH - height - 10;
    }
    if (y < 10) y = 10;

    tileInspector.container.x = x;
    tileInspector.container.y = y;
  }

  function updateTileInspector() {
    if (!tileInspector || !inspectedTile) return;
    const systemState = inspectedTile.systemState || {};
    const hydration = systemState.hydration || null;
    const growth = systemState.growth || {};
    const pool = growth.maturedPool || {};
    const ui = typeof getTileUi === "function" ? getTileUi(inspectedTile) : null;
    tileInspector.titleText.text = ui?.title || "Tile Inspector";

    const cur =
      hydration && Number.isFinite(hydration.cur)
        ? Math.floor(hydration.cur)
        : null;
    const max =
      hydration && Number.isFinite(hydration.max)
        ? Math.floor(hydration.max)
        : null;
    tileInspector.hydrationText.text =
      cur != null && max != null
        ? `Hydration: ${cur}/${max}`
        : "Hydration: --/--";

    const fertilityTier = inspectedTile.systemTiers?.fertility ?? "bronze";
    tileInspector.fertilityText.text = `Fertility: ${fertilityTier}`;

    const selectedCrop = growth.selectedCropId ?? null;
    tileInspector.cropText.text = `Crop: ${selectedCrop ?? "None"}`;
    tileInspector.plantedText.text = `Planted: ${
      Array.isArray(growth.processes) ? growth.processes.length : 0
    }`;
    tileInspector.maturedText.text = `Matured: D${
      pool.diamond ?? 0
    } G${pool.gold ?? 0} S${pool.silver ?? 0} B${pool.bronze ?? 0}`;

    // Inspector no longer exposes crop selection controls.
  }

  function showTileInspector(view, anchor) {
    if (!tileInspector || !view?.tile) return;
    inspectedTile = view.tile;
    tileInspector.container.visible = true;
    updateTileInspector();
    positionTileInspector(anchor);
  }

  function hideTileInspector() {
    if (!tileInspector) return;
    inspectedTile = null;
    tileInspector.container.visible = false;
  }

  function openCropDropdown(view, anchorRect) {
    if (!cropDropdown || !view?.tile) return;
    const canEdit =
      typeof interaction?.isPlanningPhase === "function" &&
      interaction.isPlanningPhase();
    const growth = view.tile.systemState?.growth;
    const selectedId = growth?.selectedCropId ?? null;
    const options = getCropList();

    cropDropdown.show({
      options,
      anchor: anchorRect,
      selectedId,
      canEdit,
      onSelect: (cropId) => {
        const envCol = Number.isFinite(view.tile?.col)
          ? Math.floor(view.tile.col)
          : view.col;
        const nextCrop = cropId ?? null;
        if (actionPlanner?.setTileCropSelectionIntent) {
          actionPlanner.setTileCropSelectionIntent({
            envCol,
            cropId: nextCrop,
          });
          return;
        }
        if (!dispatchAction) return;
        dispatchAction(
          ActionKinds.SET_TILE_CROP_SELECTION,
          { envCol, cropId: nextCrop },
          { apCost: 10 }
        );
      },
    });
  }

  // Crop selection handled via tile tag UI, not the inspector panel.

  return {
    showTileInspector,
    hideTileInspector,
    updateTileInspector,
    isInspectorVisible: () => !!tileInspector?.container.visible,
    openCropDropdown,
    hideCropDropdown: () => cropDropdown?.hide?.(),
    isCropDropdownVisible: () => cropDropdown?.isVisible?.() ?? false,
    cropDropdownContainsPoint: (pos) => cropDropdown?.containsPoint?.(pos),
  };
}

function createTileInspector(layer) {
  if (!layer) return null;

  const width = 240;
  const height = 130;
  const container = new PIXI.Container();
  container.visible = false;
  container.zIndex = 30;
  layer.addChild(container);

  const bg = new PIXI.Graphics()
    .beginFill(0x141b2b, 0.95)
    .drawRoundedRect(0, 0, width, height, 10)
    .endFill();
  container.addChild(bg);

  const titleText = new PIXI.Text("Tile Inspector", {
    fill: 0xffffff,
    fontSize: 12,
    fontWeight: "bold",
  });
  titleText.x = 10;
  titleText.y = 8;
  container.addChild(titleText);

  const hydrationText = new PIXI.Text("Hydration: --/--", {
    fill: 0xbad7ff,
    fontSize: 11,
  });
  hydrationText.x = 10;
  hydrationText.y = 30;
  container.addChild(hydrationText);

  const fertilityText = new PIXI.Text("Fertility: --", {
    fill: 0xbad7ff,
    fontSize: 11,
  });
  fertilityText.x = 10;
  fertilityText.y = 48;
  container.addChild(fertilityText);

  const cropText = new PIXI.Text("Crop: None", {
    fill: 0xffffff,
    fontSize: 11,
  });
  cropText.x = 10;
  cropText.y = 66;
  container.addChild(cropText);

  const plantedText = new PIXI.Text("Planted: 0", {
    fill: 0xffffff,
    fontSize: 11,
  });
  plantedText.x = 10;
  plantedText.y = 84;
  container.addChild(plantedText);

  const maturedText = new PIXI.Text("Matured: D0 G0 S0 B0", {
    fill: 0xffffff,
    fontSize: 11,
  });
  maturedText.x = 10;
  maturedText.y = 102;
  container.addChild(maturedText);

  return {
    container,
    width,
    height,
    titleText,
    hydrationText,
    fertilityText,
    cropText,
    plantedText,
    maturedText,
  };
}

function createCropDropdown(layer, app) {
  if (!layer) return null;
  const container = new PIXI.Container();
  container.visible = false;
  container.zIndex = 40;
  container.eventMode = "static";
  container.interactiveChildren = true;
  container.on("pointerdown", (ev) => {
    ev?.stopPropagation?.();
  });
  layer.addChild(container);

  let outsideHandler = null;
  let onPick = null;
  let hoverHideTimeout = null;

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
      .beginFill(selected ? 0x303a55 : 0x1f263d, 0.95)
      .drawRoundedRect(0, 0, width, 34, 6)
      .endFill();
    row.addChild(bg);

    const name = new PIXI.Text(entry.name || entry.cropId, {
      fill: 0xffffff,
      fontSize: 11,
      fontWeight: "bold",
    });
    name.x = 8;
    name.y = 4;
    row.addChild(name);

    const seasonText = Array.isArray(entry.plantSeasons)
      ? entry.plantSeasons.join(", ")
      : "";
    const detail = new PIXI.Text(
      `Seasons: ${seasonText || "any"} | ${entry.maturitySec ?? "?"}s`,
      {
        fill: 0xc7d2ee,
        fontSize: 9,
      }
    );
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

    const bounds = anchor || { x: 0, y: 0, width: 0, height: 0 };
    container.x = bounds.x;
    container.y = bounds.y + bounds.height + 6;
    container.visible = true;
    clearHoverHide();

    if (outsideHandler) {
      app.stage.off("pointerdown", outsideHandler);
    }
    outsideHandler = (ev) => {
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
  };
}
