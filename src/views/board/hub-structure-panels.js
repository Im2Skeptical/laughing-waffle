// hub-structure-panels.js
// Recipe dropdown panel for hub structures.

import { recipeDefs } from "../../defs/gamepieces/recipes-defs.js";
import { itemDefs } from "../../defs/gamepieces/item-defs.js";
import { hubStructureDefs } from "../../defs/gamepieces/hub-structure-defs.js";
import { INTENT_AP_COSTS } from "../../defs/gamesettings/action-costs-defs.js";
import { ActionKinds } from "../../model/actions.js";
import { computeAvailableRecipesAndBuildings } from "../../model/skills.js";
import { MUCHA_UI_COLORS } from "../ui-helpers/mucha-ui-palette.js";
import { installSolidUiHitArea } from "../ui-helpers/solid-ui-hit-area.js";

const OPEN_CLOSE_GUARD_MS = 140;

function nowMs() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

const SYSTEM_RECIPE_KIND = {
  cook: { kind: "cook", pauseLabel: "Pause cooking" },
  craft: { kind: "craft", pauseLabel: "Pause crafting" },
};

export function createHubPanels(opts) {
  const {
    app,
    actionPlanner,
    getHubPlanPreview,
    queueActionWhenPaused,
    dispatchAction,
    dropdownLayer,
    flashActionGhost,
    getGameState,
    onOpenRecipeWidget,
  } = opts;

  const recipeDropdown = createRecipeDropdown(dropdownLayer, app);

  function getRecipeList(systemId) {
    const config = SYSTEM_RECIPE_KIND[systemId];
    if (!config) return [];
    const { kind, pauseLabel } = config;
    const state = typeof getGameState === "function" ? getGameState() : null;
    const availability = computeAvailableRecipesAndBuildings(state);
    const list = Object.values(recipeDefs || {})
      .filter(Boolean)
      .filter((recipe) => recipe.kind === kind)
      .filter((recipe) => availability.recipeIds?.has(recipe.id));
    return [
      {
        recipeId: null,
        name: pauseLabel,
        isPauseOption: true,
      },
      ...list.map((recipe) => ({
        recipeId: recipe.id,
        name: recipe.name || recipe.id,
        recipe,
      })),
    ];
  }

  function getHubPlanCost() {
    return Math.max(
      0,
      Math.floor(
        INTENT_AP_COSTS?.hubPlan ??
          INTENT_AP_COSTS?.hubRecipeSelect ??
          INTENT_AP_COSTS?.hubTagOrder ??
          0
      )
    );
  }

  function openRecipeDropdown(view, systemId, anchorRect) {
    if (typeof onOpenRecipeWidget === "function") {
      onOpenRecipeWidget(view, systemId, anchorRect);
      return;
    }
    if (!recipeDropdown || !view?.structure || !systemId) return;
    const structure = view.structure;
    const options = getRecipeList(systemId);
    if (!options.length) return;

    const systemState = structure.systemState?.[systemId] || null;
    const preview = getHubPlanPreview?.(hubCol) ?? null;
    const selectedId =
      preview?.recipeIdBySystemId?.[systemId] ?? systemState?.selectedRecipeId ?? null;

    const hubCol = Number.isFinite(structure?.col)
      ? Math.floor(structure.col)
      : Number.isFinite(view.col)
      ? Math.floor(view.col)
      : null;
    if (!Number.isFinite(hubCol)) return;
    const def = structure?.defId ? hubStructureDefs?.[structure.defId] : null;
    const hubName = def?.name || structure?.defId || `Hub ${hubCol ?? "?"}`;

    recipeDropdown.show({
      options,
      anchor: anchorRect,
      selectedId,
      canEdit: true,
      onSelect: (recipeId) => {
        const nextRecipe = recipeId ?? null;
        const recipeName = recipeId
          ? recipeDefs?.[recipeId]?.name || recipeId
          : "None";
        const ghostSpec = {
          description: `Recipe > ${hubName}: ${recipeName}`,
          cost: getHubPlanCost(),
        };

        const runWhenPaused = () => {
          const sameSelection = (selectedId ?? null) === (nextRecipe ?? null);
          if (sameSelection) {
            if (!dispatchAction) return { ok: false, reason: "noDispatch" };
            return dispatchAction(
              ActionKinds.SET_HUB_RECIPE_SELECTION,
              { hubCol, systemId, recipeId: nextRecipe },
              { apCost: 0 }
            );
          }
          if (actionPlanner?.setHubRecipeSelectionIntent) {
            const res = actionPlanner.setHubRecipeSelectionIntent({
              hubCol,
              systemId,
              recipeId: nextRecipe,
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
            ActionKinds.SET_HUB_RECIPE_SELECTION,
            { hubCol, systemId, recipeId: nextRecipe },
            { apCost: getHubPlanCost() }
          );
          return { ok: true };
        };
        const runWhenLive = () => {
          if (!dispatchAction) return { ok: false, reason: "noDispatch" };
          const sameSelection = (selectedId ?? null) === (nextRecipe ?? null);
          return dispatchAction(
            ActionKinds.SET_HUB_RECIPE_SELECTION,
            { hubCol, systemId, recipeId: nextRecipe },
            { apCost: sameSelection ? 0 : getHubPlanCost() }
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

  return {
    openRecipeDropdown,
    hideRecipeDropdown: () => recipeDropdown?.hide?.(),
    isRecipeDropdownVisible: () => recipeDropdown?.isVisible?.() ?? false,
    recipeDropdownContainsPoint: (pos) => recipeDropdown?.containsPoint?.(pos),
    recipeDropdown,
  };
}

function formatItemName(kind) {
  if (kind && itemDefs[kind]) return itemDefs[kind].name || kind;
  return kind || "";
}

function formatItemList(items) {
  const list = Array.isArray(items) ? items : [];
  return list
    .filter((entry) => entry && entry.kind)
    .map((entry) => {
      const name = formatItemName(entry.kind);
      const qty = Number.isFinite(entry.qty) ? Math.floor(entry.qty) : 1;
      return `${name} x${qty}`;
    })
    .join(", ");
}

function formatRecipeDetails(recipe) {
  if (!recipe) return "";
  const inputs = formatItemList(recipe.inputs);
  const tools = formatItemList(recipe.toolRequirements);
  const outputs = formatItemList(recipe.outputs);
  const duration = Number.isFinite(recipe.durationSec)
    ? recipe.durationSec <= 0
      ? "Instant"
      : `${Math.floor(recipe.durationSec)}s`
    : "?";

  const parts = [];
  if (inputs) parts.push(`Inputs: ${inputs}`);
  if (tools) parts.push(`Tools: ${tools}`);
  if (outputs) parts.push(`Output: ${outputs}`);
  parts.push(`Time: ${duration}`);
  return parts.join(" | ");
}

function createRecipeDropdown(layer, app) {
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
    row.hitArea = new PIXI.Rectangle(0, 0, width, 36);

    const bg = new PIXI.Graphics()
      .beginFill(
        selected
          ? MUCHA_UI_COLORS.surfaces.panelSoft
          : MUCHA_UI_COLORS.surfaces.panelRaised,
        0.95
      )
      .drawRoundedRect(0, 0, width, 36, 6)
      .endFill();
    row.addChild(bg);

    const name = new PIXI.Text(entry.name || entry.recipeId, {
      fill: MUCHA_UI_COLORS.ink.primary,
      fontSize: 11,
      fontWeight: "bold",
    });
    name.x = 8;
    name.y = 4;
    row.addChild(name);

    const detailText = entry.isPauseOption
      ? "No recipe selected"
      : formatRecipeDetails(entry.recipe);
    const detail = new PIXI.Text(detailText, {
      fill: MUCHA_UI_COLORS.ink.secondary,
      fontSize: 9,
      wordWrap: true,
      wordWrapWidth: width - 12,
    });
    detail.x = 8;
    detail.y = 18;
    row.addChild(detail);

    if (canEdit) {
      row.cursor = "pointer";
      row.on("pointerdown", (ev) => {
        ev?.stopPropagation?.();
        onPick?.(entry.recipeId);
      });
    } else {
      row.cursor = "default";
      row.alpha = 0.6;
    }

    return row;
  }

  function show({ options, anchor, selectedId, canEdit, onSelect }) {
    container.removeChildren();
    onPick = (recipeId) => {
      onSelect?.(recipeId);
      hide();
    };

    const list = Array.isArray(options) ? options : [];
    const width = 210;
    let y = 0;

    const bg = new PIXI.Graphics();
    container.addChild(bg);

    for (const entry of list) {
      const row = buildRow(
        entry,
        y,
        width,
        canEdit,
        entry.recipeId === selectedId
      );
      container.addChild(row);
      y += 40;
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
