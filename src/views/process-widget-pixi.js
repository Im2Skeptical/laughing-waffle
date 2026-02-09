// process-widget-pixi.js
// Process Widget v2: modular layout + routing drawers.

import { ActionKinds } from "../model/actions.js";
import {
  getProcessDefForInstance,
  getTemplateProcessForSystem,
  getDropEndpointId,
  isDropEndpoint,
  listCandidateEndpoints,
  resolveEndpointTarget,
  resolveFixedEndpointId,
} from "../model/process-framework.js";
import { envTileDefs } from "../defs/gamepieces/env-tiles-defs.js";
import { hubStructureDefs } from "../defs/gamepieces/hub-structure-defs.js";
import { recipeDefs } from "../defs/gamepieces/recipes-defs.js";
import { cropDefs } from "../defs/gamepieces/crops-defs.js";
import { itemDefs } from "../defs/gamepieces/item-defs.js";
import { itemTagDefs } from "../defs/gamesystems/item-tag-defs.js";
import { INTENT_AP_COSTS } from "../defs/gamesettings/action-costs-defs.js";
import { computeAvailableRecipesAndBuildings } from "../model/skills.js";
import { createPillDragController } from "./ui-helpers/pill-drag-controller.js";
import { createWindowHeader } from "./ui-helpers/window-header.js";
import {
  TILE_WIDTH,
  TILE_HEIGHT,
  HUB_STRUCTURE_WIDTH,
  HUB_STRUCTURE_HEIGHT,
  HUB_COL_GAP,
  TILE_ROW_Y,
  HUB_STRUCTURE_ROW_Y,
  layoutBoardColPos,
  layoutHubColPos,
} from "./layout-pixi.js";

const CORE_WIDTH = 280;
const CARD_RADIUS = 12;
const CARD_GAP = 10;
const HEADER_HEIGHT = 22;
const HEADER_PAD_X = 10;
const HEADER_PAD_Y = 6;
const BODY_PAD = 8;
const SEGMENT_GAP = 6;

const DRAWER_COLLAPSED = 22;
const DRAWER_EXPANDED = 126;
const BUFFER_SIZE = 44;

const MODULE_GAP = 8;
const MODULE_PAD = 6;
const MODULE_RADIUS = 8;

const PILL_HEIGHT = 18;
const PILL_RADIUS = 9;
const PILL_GAP = 6;
const PILL_PAD_X = 8;
const TOGGLE_SIZE = 10;
const TOGGLE_PAD = 6;

const GROUP_SYSTEM_IDS = new Set([
  "growth",
  "fireplace",
  "workspace",
  "residents",
  "deposit",
  "build",
  "basket",
]);

const WITHDRAWABLE_POOL_SYSTEM_IDS = new Set([
  "granaryStore",
  "storehouseStore",
  "storage",
]);

const COLORS = {
  panel: 0x151a2a,
  panelBorder: 0x2a3146,
  headerBg: 0x303048,
  headerText: 0xffffff,
  headerSub: 0xa0a7bb,
  moduleBg: 0x1e2438,
  moduleBorder: 0x2b334a,
  moduleText: 0xe6eef9,
  moduleSub: 0x9aa0b5,
  drawerBg: 0x1a2034,
  drawerBorder: 0x2a3146,
  pillEnabled: 0x2a3958,
  pillDisabled: 0x2a2f3d,
  pillInvalid: 0x4b252c,
  pillLocked: 0x232a3d,
  pillText: 0xe6eef9,
  pillTextDisabled: 0x99a2b5,
  pillTextInvalid: 0xf2b0b0,
  progressBg: 0x2a2f45,
  progressFill: 0x7ccf6b,
  bufferBg: 0x1b2136,
  bufferBorder: 0x323b56,
};

export function createProcessWidgetView({
  app,
  layer,
  getGameState,
  interaction,
  actionPlanner,
  dispatchAction,
  queueActionWhenPaused,
  inventoryView,
  flashActionGhost,
  position = { x: 1180, y: 640 },
}) {
  const windows = new Map();
  const withdrawUiStateByTarget = new Map();
  const drawerExpanded = {
    inputs: new Set(),
    outputs: new Set(),
  };
  const selectionDropdown = createSelectionDropdown(layer, app);

  let hoverContext = null;
  let externalFocusContext = null;

  const routingDragController = createPillDragController({
    app,
    dragStateKey: "dragState",
    dragScale: 1.04,
    dragAlpha: 0.95,
    dragZIndex: 10,
    dragCursor: "grabbing",
    idleCursor: "grab",
    getEntries: (view) => view.pillEntries || [],
    getContainer: (view) => view.pillContainer,
    getRowHeight: () => PILL_HEIGHT,
    getRowStep: () => PILL_HEIGHT + PILL_GAP,
    layoutEntries: (view) => layoutPillEntries(view),
    onCommit: (view, fromIndex, toIndex) => {
      if (!view || view.slotLocked) return;
      const slotKind = view.slotKind;
      const slotId = view.slotId;
      if (!slotId) return;
      const routingMode = view.routingMode || "process";
      if (routingMode === "template") {
        const targetRef = view.targetRef;
        const systemId = view.systemId;
        if (!targetRef || !systemId) return;
        const payload = {
          targetRef,
          systemId,
          slotKind,
          slotId,
          fromIndex,
          toIndex,
        };
        queueActionWhenPaused?.(() =>
          dispatchAction?.(ActionKinds.REORDER_ROUTING_TEMPLATE_ENDPOINT, payload, {
            apCost: 0,
          })
        );
        return;
      }

      const processId = view.processId;
      if (!processId) return;
      const payload = {
        processId,
        slotKind,
        slotId,
        fromIndex,
        toIndex,
      };
      queueActionWhenPaused?.(() =>
        dispatchAction?.(ActionKinds.REORDER_PROCESS_ROUTING_ENDPOINT, payload, {
          apCost: 0,
        })
      );
    },
    onDragEnd: (view, drag) => {
      view.ignoreNextTap = !!drag?.moved;
      layoutPillEntries(view);
    },
  });

  function getStateSafe() {
    return typeof getGameState === "function" ? getGameState() : null;
  }

  function getScreenSize() {
    const width = Number.isFinite(app?.renderer?.width)
      ? app.renderer.width
      : 1920;
    const height = Number.isFinite(app?.renderer?.height)
      ? app.renderer.height
      : 1080;
    return { width, height };
  }

  function getTargetAnchorRect(target) {
    if (!target) return null;
    if (target?.refKind === "basket") return null;
    const { width: screenWidth } = getScreenSize();
    if (hubStructureDefs[target.defId]) {
      const col = Number.isFinite(target.col)
        ? Math.floor(target.col)
        : Number.isFinite(target.hubCol)
          ? Math.floor(target.hubCol)
          : null;
      if (col == null) return null;
      const span =
        Number.isFinite(target.span) && target.span > 0
          ? Math.floor(target.span)
          : Number.isFinite(target.defaultSpan) && target.defaultSpan > 0
            ? Math.floor(target.defaultSpan)
            : 1;
      const width =
        HUB_STRUCTURE_WIDTH * span + HUB_COL_GAP * Math.max(0, span - 1);
      const pos = layoutHubColPos(
        screenWidth,
        col,
        width,
        HUB_STRUCTURE_ROW_Y
      );
      return { x: pos.x, y: pos.y, width, height: HUB_STRUCTURE_HEIGHT };
    }

    const col = Number.isFinite(target.col)
      ? Math.floor(target.col)
      : Number.isFinite(target.envCol)
        ? Math.floor(target.envCol)
        : null;
    if (col == null) return null;
    const pos = layoutBoardColPos(
      screenWidth,
      col,
      TILE_WIDTH,
      TILE_ROW_Y
    );
    return { x: pos.x, y: pos.y, width: TILE_WIDTH, height: TILE_HEIGHT };
  }

  function getHoverTarget(state) {
    const hover =
      interaction?.getHovered?.() ?? interaction?.getLastHovered?.();
    if (!hover) return null;
    if (hover.kind === "tile") {
      const col = Number.isFinite(hover.col) ? Math.floor(hover.col) : null;
      if (col == null) return null;
      return state?.board?.occ?.tile?.[col] ?? null;
    }
    if (hover.kind === "hub") {
      const col = Number.isFinite(hover.col) ? Math.floor(hover.col) : null;
      if (col == null) return null;
      return (
        state?.hub?.occ?.[col] ??
        state?.hub?.slots?.[col]?.structure ??
        null
      );
    }
    return null;
  }

  function getTargetKey(target) {
    if (!target) return null;
    if (target?.refKind === "basket") {
      const ownerId = target?.ownerId ?? null;
      if (ownerId == null) return null;
      return `basket:${ownerId}`;
    }
    const id = target.instanceId ?? target.id ?? null;
    if (id == null) return null;
    const isHub = !!hubStructureDefs[target.defId];
    const prefix = isHub ? "hub" : "tile";
    return `${prefix}:${id}`;
  }

  function collectProcesses(target) {
    if (target?.refKind === "basket") return [];
    if (!target || !target.systemState) return [];
    const list = [];
    const entries = Object.entries(target.systemState);
    entries.sort((a, b) => a[0].localeCompare(b[0]));
    for (const [systemId, sysState] of entries) {
      const processes = Array.isArray(sysState?.processes) ? sysState.processes : [];
      for (const proc of processes) {
        if (!proc || !proc.id) continue;
        list.push({ process: proc, systemId });
      }
    }
    list.sort((a, b) => {
      const aStart = Number.isFinite(a.process?.startSec)
        ? a.process.startSec
        : 0;
      const bStart = Number.isFinite(b.process?.startSec)
        ? b.process.startSec
        : 0;
      if (aStart !== bStart) return aStart - bStart;
      const aId = String(a.process?.id ?? "");
      const bId = String(b.process?.id ?? "");
      return aId.localeCompare(bId);
    });
    return list;
  }

  function getTargetLabel(target) {
    if (!target) return "Process";
    if (target?.refKind === "basket") {
      return target?.basketOwnerName || "Basket";
    }
    if (hubStructureDefs[target.defId]) {
      const def = hubStructureDefs[target.defId];
      return def?.name || target.defId || "Structure";
    }
    const tileDef = envTileDefs[target.defId];
    return tileDef?.name || target.defId || "Tile";
  }

  function isGroupedSystem(systemId) {
    return systemId && GROUP_SYSTEM_IDS.has(systemId);
  }

  function isRecipeSystem(systemId) {
    return systemId === "fireplace" || systemId === "workspace";
  }

  function getTilePlanCost() {
    return Math.max(
      0,
      Math.floor(INTENT_AP_COSTS?.tilePlan ?? INTENT_AP_COSTS?.tileCropSelect ?? 0)
    );
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

  function formatCropName(cropId) {
    if (!cropId) return "Select crop";
    return cropDefs?.[cropId]?.name || cropId;
  }

  function formatRecipeName(recipeId) {
    if (!recipeId) return "Select recipe";
    return recipeDefs?.[recipeId]?.name || recipeId;
  }

  function getCropOptions() {
    const crops = Object.entries(cropDefs || {})
      .map(([key, crop]) => ({ key, crop }))
      .filter((entry) => !!entry.crop);
    return [
      { value: null, label: "Pause planting", detail: "Planting paused" },
      ...crops.map(({ key, crop }) => {
        const cropId =
          (typeof crop?.cropId === "string" && crop.cropId.length > 0
            ? crop.cropId
            : typeof crop?.id === "string" && crop.id.length > 0
              ? crop.id
              : key) || null;
        const seasons = Array.isArray(crop?.plantSeasons)
          ? crop.plantSeasons.join(", ")
          : "any";
        const maturity = Number.isFinite(crop?.maturitySec)
          ? `${Math.floor(crop.maturitySec)}s`
          : "?";
        return {
          value: cropId,
          label: crop.name || cropId,
          detail: `Seasons: ${seasons} | ${maturity}`,
        };
      }),
    ];
  }

  function getRecipeOptions(systemId) {
    const kind = systemId === "workspace" ? "craft" : systemId === "fireplace" ? "cook" : null;
    if (!kind) return [];
    const state = getStateSafe();
    const availability = computeAvailableRecipesAndBuildings(state);
    const list = Object.entries(recipeDefs || {})
      .map(([key, recipe]) => ({ key, recipe }))
      .filter((entry) => !!entry.recipe)
      .filter((entry) => entry.recipe.kind === kind)
      .filter((entry) => availability.recipeIds?.has(entry.recipe.id))
      .sort((a, b) =>
        String(a?.recipe?.name || a?.recipe?.id || a?.key || "").localeCompare(
          String(b?.recipe?.name || b?.recipe?.id || b?.key || "")
        )
      );
    return [
      {
        value: null,
        label: kind === "craft" ? "Pause crafting" : "Pause cooking",
        detail: "No recipe selected",
      },
      ...list.map(({ key, recipe }) => {
        const recipeId =
          (typeof recipe?.id === "string" && recipe.id.length > 0
            ? recipe.id
            : key) || null;
        return {
          value: recipeId,
          label: recipe.name || recipeId,
          detail: formatRecipeDetails(recipe),
        };
      }),
    ];
  }

  function getHubCol(target) {
    if (!target) return null;
    if (Number.isFinite(target.col)) return Math.floor(target.col);
    if (Number.isFinite(target.hubCol)) return Math.floor(target.hubCol);
    return null;
  }

  function getEnvCol(target) {
    if (!target) return null;
    if (Number.isFinite(target.col)) return Math.floor(target.col);
    if (Number.isFinite(target.envCol)) return Math.floor(target.envCol);
    return null;
  }
  function getProcessVariant(process, processDef) {
    if (!processDef) return "generic";
    const kind = processDef.processKind;
    if (kind === "cropGrowth") return "growing";
    if (kind === "depositItems") return "depositing";
    if (kind === "build") return "building";
    const recipe = recipeDefs?.[process?.type] || null;
    if (recipe?.kind === "cook") return "cooking";
    if (recipe?.kind === "craft") return "crafting";
    return "generic";
  }

  function getCardTitle(targetLabel, process, processDef, variantOverride = null) {
    const variant = variantOverride || getProcessVariant(process, processDef);
    if (variant === "growing") return `${targetLabel} - Growing`;
    if (variant === "depositing") return `${targetLabel} - Depositing`;
    if (variant === "building") return `${targetLabel} - Building`;
    if (variant === "cooking") return `${targetLabel} - Cooking`;
    if (variant === "crafting") return `${targetLabel} - Crafting`;
    return `${targetLabel} - ${processDef?.displayName || "Process"}`;
  }

  function formatRequirementLabel(req) {
    if (!req) return "Requirement";
    if (req.kind === "item") {
      const def = itemDefs?.[req.itemId];
      return def?.name || req.itemId || "Item";
    }
    if (req.kind === "tag") {
      const def = itemTagDefs?.[req.tag];
      return def?.ui?.name || req.tag || "Tag";
    }
    if (req.kind === "resource") {
      const raw = String(req.resource || "Resource");
      return raw.length ? raw[0].toUpperCase() + raw.slice(1) : "Resource";
    }
    return "Requirement";
  }

  function formatOutputLabel(out) {
    if (!out) return "Output";
    if (out.kind === "item") {
      const def = itemDefs?.[out.itemId];
      return def?.name || out.itemId || "Item";
    }
    if (out.kind === "pool") {
      if (out.fromLedger) return "Deposit Pool";
      const def = itemDefs?.[out.itemId];
      const itemLabel = def?.name || out.itemId || "Item";
      return `${itemLabel} Pool`;
    }
    if (out.kind === "prestige") return "Prestige";
    if (out.kind === "resource") {
      const raw = String(out.resource || "Resource");
      return raw.length ? raw[0].toUpperCase() + raw.slice(1) : "Resource";
    }
    if (out.kind === "system") {
      return `${out.system || "System"}:${out.key || ""}`;
    }
    return "Output";
  }

  function formatRecipeItemName(kind) {
    if (kind && itemDefs?.[kind]) return itemDefs[kind].name || kind;
    return kind || "";
  }

  function formatRecipeItemList(items) {
    const list = Array.isArray(items) ? items : [];
    return list
      .filter((entry) => entry && entry.kind)
      .map((entry) => {
        const name = formatRecipeItemName(entry.kind);
        const qty = Number.isFinite(entry.qty) ? Math.floor(entry.qty) : 1;
        return `${name} x${qty}`;
      })
      .join(", ");
  }

  function formatRecipeDetails(recipe) {
    if (!recipe) return "";
    const inputs = formatRecipeItemList(recipe.inputs);
    const tools = formatRecipeItemList(recipe.toolRequirements);
    const outputs = formatRecipeItemList(recipe.outputs);
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

  function getEndpointLabel(state, endpointId) {
    if (!endpointId || typeof endpointId !== "string") return "Endpoint";
    if (endpointId.startsWith("inv:process:")) return "Buffer";
    if (endpointId.startsWith("res:state")) return "Stockpile";
    if (endpointId.startsWith("spawn:tileOccupants")) return "Spawn";
    if (endpointId.startsWith("sys:pool:")) {
      const parsed = parsePoolEndpointId(endpointId);
      if (!parsed) return "Pool";
      const ownerLabel = getOwnerLabel(state, parsed.ownerKind, parsed.ownerId);
      const poolLabel = `${parsed.systemId}.${parsed.poolKey}`;
      return ownerLabel ? `${ownerLabel} ${poolLabel}` : `Pool ${poolLabel}`;
    }
    if (endpointId.startsWith("inv:hub:")) {
      const id = endpointId.slice("inv:hub:".length);
      const structure = findStructureById(state, id);
      const def = structure ? hubStructureDefs[structure.defId] : null;
      const name = def?.name || structure?.defId || id;
      return `${name} Inventory`;
    }
    if (endpointId.startsWith("inv:pawn:")) {
      const id = endpointId.slice("inv:pawn:".length);
      const pawn = findPawnById(state, id);
      const name = pawn?.name || `Pawn ${id}`;
      return `${name} Inventory`;
    }
    if (endpointId.startsWith("inv:")) {
      const id = endpointId.slice("inv:".length);
      const structure = findStructureById(state, id);
      if (structure) {
        const def = hubStructureDefs[structure.defId];
        const name = def?.name || structure.defId || id;
        return `${name} Inventory`;
      }
      const pawn = findPawnById(state, id);
      if (pawn) {
        const name = pawn.name || `Pawn ${id}`;
        return `${name} Inventory`;
      }
      return `Inventory ${id}`;
    }
    if (endpointId.startsWith("sys:hub:")) {
      const id = endpointId.slice("sys:hub:".length);
      const structure = findStructureById(state, id);
      const def = structure ? hubStructureDefs[structure.defId] : null;
      const name = def?.name || structure?.defId || id;
      return `${name} System`;
    }
    if (endpointId.startsWith("sys:pawn:")) {
      const id = endpointId.slice("sys:pawn:".length);
      const pawn = findPawnById(state, id);
      return pawn?.name || `Leader ${id}`;
    }
    return endpointId;
  }

  function parsePoolEndpointId(endpointId) {
    if (!endpointId || typeof endpointId !== "string") return null;
    if (!endpointId.startsWith("sys:pool:")) return null;
    const raw = endpointId.slice("sys:pool:".length);
    const parts = raw.split(":");
    if (parts.length < 4) return null;
    const [ownerKind, ownerId, systemId, poolKey] = parts;
    if (!ownerKind || !ownerId || !systemId || !poolKey) return null;
    return { ownerKind, ownerId, systemId, poolKey };
  }

  function getOwnerLabel(state, ownerKind, ownerId) {
    if (!state || !ownerKind || ownerId == null) return null;
    if (ownerKind === "hub") {
      const structure = findStructureById(state, ownerId);
      const def = structure ? hubStructureDefs[structure.defId] : null;
      return def?.name || structure?.defId || `Hub ${ownerId}`;
    }
    if (ownerKind === "env") {
      const tile = findTileById(state, ownerId);
      const def = tile ? envTileDefs[tile.defId] : null;
      return def?.name || tile?.defId || `Tile ${ownerId}`;
    }
    if (ownerKind === "pawn") {
      const pawn = findPawnById(state, ownerId);
      return pawn?.name || `Pawn ${ownerId}`;
    }
    return null;
  }

  function findStructureById(state, id) {
    const anchors = Array.isArray(state?.hub?.anchors) ? state.hub.anchors : [];
    for (const anchor of anchors) {
      if (!anchor) continue;
      if (String(anchor.instanceId) === String(id)) return anchor;
    }
    return null;
  }

  function findPawnById(state, id) {
    const chars = Array.isArray(state?.characters) ? state.characters : [];
    for (const ch of chars) {
      if (!ch) continue;
      if (String(ch.id) === String(id)) return ch;
    }
    return null;
  }

  function itemProvidesPortableStorage(item) {
    if (!item || typeof item !== "object") return false;
    const kind =
      typeof item.kind === "string" && item.kind.length > 0 ? item.kind : null;
    if (!kind) return false;
    const def = itemDefs?.[kind];
    if (!def || typeof def !== "object") return false;
    const specs = Array.isArray(def.poolProviders)
      ? def.poolProviders
      : def.poolProviders && typeof def.poolProviders === "object"
        ? [def.poolProviders]
        : [];
    return specs.some((spec) => {
      const systemId =
        typeof spec?.systemId === "string" ? spec.systemId : spec?.system;
      const poolKey = typeof spec?.poolKey === "string" ? spec.poolKey : null;
      return systemId === "storage" && poolKey === "byKindTier";
    });
  }

  function getEquippedBasketInfoForPawn(pawn) {
    if (!pawn) return null;
    const equipment =
      pawn?.equipment && typeof pawn.equipment === "object" ? pawn.equipment : null;
    if (!equipment) return null;
    for (const [slotId, item] of Object.entries(equipment)) {
      if (!item || typeof item !== "object") continue;
      if (!itemProvidesPortableStorage(item)) continue;
      return { slotId, item };
    }
    return null;
  }

  function buildBasketTarget(state, ownerId) {
    const pawn = findPawnById(state, ownerId);
    if (!pawn) return null;
    const basketInfo = getEquippedBasketInfoForPawn(pawn);
    if (!basketInfo?.item) return null;
    const store =
      basketInfo?.item?.systemState?.storage &&
      typeof basketInfo.item.systemState.storage === "object"
        ? basketInfo.item.systemState.storage
        : pawn?.systemState?.basketStore &&
            typeof pawn.systemState.basketStore === "object"
          ? pawn.systemState.basketStore
          : null;
    const byKindTier =
      store?.byKindTier && typeof store.byKindTier === "object"
        ? store.byKindTier
        : {};
    const totalByTier =
      store?.totalByTier && typeof store.totalByTier === "object"
        ? store.totalByTier
        : null;
    return {
      refKind: "basket",
      defId: basketInfo.item.kind || "basket",
      ownerKind: "pawn",
      ownerId: String(pawn.id),
      id: `basket:${pawn.id}`,
      instanceId: `basket:${pawn.id}`,
      basketSlotId: basketInfo.slotId,
      basketItemId: basketInfo.item.id ?? null,
      basketOwnerName: pawn.name || `Pawn ${pawn.id}`,
      systemState: {
        storage: {
          byKindTier,
          totalByTier,
        },
      },
    };
  }

  function findTileById(state, id) {
    const anchors = Array.isArray(state?.board?.layers?.tile?.anchors)
      ? state.board.layers.tile.anchors
      : [];
    for (const anchor of anchors) {
      if (!anchor) continue;
      if (String(anchor.instanceId) === String(id)) return anchor;
    }
    return null;
  }

  function makeTargetRef(target) {
    if (!target) return null;
    if (target?.refKind === "basket") {
      if (target?.ownerId == null) return null;
      return { kind: "basket", ownerId: String(target.ownerId) };
    }
    const id = target.instanceId ?? target.id ?? null;
    if (id == null) return null;
    const isHub = !!hubStructureDefs[target.defId];
    const kind = isHub ? "hub" : "env";
    return { kind, id: String(id) };
  }

  function sameTargetRef(a, b) {
    if (!a || !b) return false;
    if (a.kind === "basket" || b.kind === "basket") {
      return a.kind === "basket" && b.kind === "basket" && String(a.ownerId) === String(b.ownerId);
    }
    return a.kind === b.kind && String(a.id) === String(b.id);
  }

  function resolveTargetFromRef(state, ref) {
    if (!ref || !state) return null;
    if (ref.kind === "basket") return buildBasketTarget(state, ref.ownerId);
    if (ref.kind === "hub") return findStructureById(state, ref.id);
    if (ref.kind === "env") return findTileById(state, ref.id);
    return null;
  }

  function buildCandidateSignature(state, target, process, processDef) {
    if (!state || !target || !process || !processDef) return "none";
    const parts = [];
    const context = { leaderId: process?.leaderId ?? null };
    for (const kind of ["inputs", "outputs"]) {
      const slots = processDef?.routingSlots?.[kind] || [];
      for (const slotDef of slots) {
        if (!slotDef || slotDef.locked) continue;
        const candidates = listCandidateEndpoints(
          state,
          process,
          slotDef,
          target,
          context
        );
        const list = candidates.length ? candidates.join(",") : "none";
        parts.push(`${kind}:${slotDef.slotId}:${list}`);
      }
    }
    return parts.length ? parts.join("|") : "none";
  }

  function buildTemplateCandidateSignature(state, target, systemId) {
    if (!state || !target || !systemId) return "none";
    const templateProcess = getTemplateProcessForSystem(target, systemId, {
      state,
    });
    if (!templateProcess) return "none";
    const templateDef = getProcessDefForInstance(templateProcess, target, {});
    if (!templateDef) return "none";
    return buildCandidateSignature(state, target, templateProcess, templateDef);
  }

  function buildProcessSignature(state, targetKey, target, entries) {
    if (!Array.isArray(entries) || entries.length === 0) return null;
    const parts = [];
    for (const entry of entries) {
      const process = entry?.process;
      if (!process) continue;
      const routingSig = process.routing ? JSON.stringify(process.routing) : "";
      const reqSig = Array.isArray(process.requirements)
        ? process.requirements
            .map(
              (r) =>
                `${r.kind}:${r.itemId || r.tag || r.resource}:${r.progress ?? 0}:${r.amount ?? 0}`
            )
            .join("|")
        : "";
      const outSig = Array.isArray(process.outputs)
        ? process.outputs
            .map(
              (o) =>
                `${o.kind}:${o.itemId || o.resource || o.system || ""}:${o.qty ?? o.amount ?? 0}`
            )
          .join("|")
        : "";
      const progress = Number.isFinite(process.progress)
        ? Math.floor(process.progress)
        : 0;
      const candidateSig = buildCandidateSignature(
        state,
        target,
        process,
        entry?.processDef
      );
      parts.push(
        `${process.id}|${progress}|${routingSig}|${reqSig}|${outSig}|${candidateSig}`
      );
    }
    return `${targetKey}|${parts.join("||")}`;
  }

  function buildRoutingTemplateSignature(target, systemId) {
    if (!target || !systemId) return "none";
    const template = target?.systemState?.[systemId]?.routingTemplate;
    if (!template || typeof template !== "object") return "none";
    return JSON.stringify(template);
  }

  function clearContent(content, dropTargets) {
    if (content) content.removeChildren();
    if (Array.isArray(dropTargets)) dropTargets.length = 0;
  }

  function invalidateAllSignatures() {
    for (const win of windows.values()) {
      if (win) win.lastSignature = null;
    }
  }
  function drawCardBackground(bg, width, height) {
    bg.clear();
    bg.lineStyle(2, COLORS.panelBorder, 0.9);
    bg.beginFill(COLORS.panel, 0.96);
    bg.drawRoundedRect(0, 0, width, height, CARD_RADIUS);
    bg.endFill();
  }

  function drawModuleBox(bg, width, height) {
    bg.clear();
    bg.lineStyle(1, COLORS.moduleBorder, 0.9);
    bg.beginFill(COLORS.moduleBg, 0.95);
    bg.drawRoundedRect(0, 0, width, height, MODULE_RADIUS);
    bg.endFill();
  }

  function drawDrawerBox(bg, width, height) {
    bg.clear();
    bg.lineStyle(1, COLORS.drawerBorder, 0.9);
    bg.beginFill(COLORS.drawerBg, 0.95);
    bg.drawRoundedRect(0, 0, width, height, MODULE_RADIUS);
    bg.endFill();
  }

  function drawBufferBox(bg, width, height) {
    bg.clear();
    bg.lineStyle(1, COLORS.bufferBorder, 0.9);
    bg.beginFill(COLORS.bufferBg, 0.95);
    bg.drawRoundedRect(0, 0, width, height, MODULE_RADIUS);
    bg.endFill();
  }

  function layoutPillEntries(slotView) {
    const entries = slotView.pillEntries || [];
    let y = 0;
    for (const entry of entries) {
      entry.container.x = 0;
      entry.container.y = y;
      const rowHeight =
        entry.container?.height && entry.container.height > PILL_HEIGHT
          ? entry.container.height
          : PILL_HEIGHT;
      y += rowHeight + PILL_GAP;
    }
    if (entries.length > 0) y -= PILL_GAP;
    slotView.pillHeight = y;
  }

  function applyPillStyle(entry) {
    if (!entry) return;
    let bgColor = COLORS.pillEnabled;
    let textColor = COLORS.pillText;
    if (entry.locked) bgColor = COLORS.pillLocked;
    if (!entry.enabled) {
      bgColor = COLORS.pillDisabled;
      textColor = COLORS.pillTextDisabled;
    }
    if (entry.invalid) {
      bgColor = COLORS.pillInvalid;
      textColor = COLORS.pillTextInvalid;
    }

    entry.bg.clear();
    entry.bg.lineStyle(1, COLORS.panelBorder, 0.9);
    entry.bg.beginFill(bgColor, 0.95);
    entry.bg.drawRoundedRect(0, 0, entry.width, PILL_HEIGHT, PILL_RADIUS);
    entry.bg.endFill();

    entry.labelText.style.fill = textColor;
    entry.labelText.dirty = true;
  }

  function buildPillEntry(state, slotView, rawEndpointId, resolvedId, opts = {}) {
    const entryWidth = Math.max(60, slotView.entryWidth || 80);
    const entry = {
      endpointId: rawEndpointId,
      resolvedId,
      enabled: opts.enabled,
      invalid: opts.invalid,
      locked: opts.locked,
      draggable: opts.draggable,
      container: new PIXI.Container(),
      bg: new PIXI.Graphics(),
      labelText: null,
      width: entryWidth,
    };

    const row = entry.container;
    row.eventMode = "static";
    row.cursor = entry.draggable ? "grab" : entry.locked ? "default" : "pointer";

    row.addChild(entry.bg);

    const label = getEndpointLabel(state, resolvedId || rawEndpointId);
    const labelText = new PIXI.Text(label, {
      fill: COLORS.pillText,
      fontSize: 10,
    });
    labelText.x = PILL_PAD_X + TOGGLE_SIZE + TOGGLE_PAD;
    labelText.y = Math.round((PILL_HEIGHT - labelText.height) / 2);
    row.addChild(labelText);
    entry.labelText = labelText;

    const toggle = new PIXI.Graphics();
    toggle.x = PILL_PAD_X;
    toggle.y = Math.round((PILL_HEIGHT - TOGGLE_SIZE) / 2);
    row.addChild(toggle);

    toggle.clear();
    if (entry.locked) {
      toggle.lineStyle(1, COLORS.panelBorder, 0.9);
      toggle.drawRoundedRect(0, 0, TOGGLE_SIZE, TOGGLE_SIZE, 3);
    } else if (entry.enabled) {
      toggle.beginFill(0xd7ffe0, 1);
      toggle.drawCircle(TOGGLE_SIZE / 2, TOGGLE_SIZE / 2, 3);
      toggle.endFill();
    } else {
      toggle.lineStyle(2, 0xf2b0b0, 1);
      toggle.moveTo(2, 2);
      toggle.lineTo(TOGGLE_SIZE - 2, TOGGLE_SIZE - 2);
      toggle.moveTo(TOGGLE_SIZE - 2, 2);
      toggle.lineTo(2, TOGGLE_SIZE - 2);
    }

    applyPillStyle(entry);

    if (entry.draggable) {
      row.on("pointerdown", (ev) => {
        slotView.ignoreNextTap = false;
        routingDragController.startDrag(slotView, entry, ev);
      });
    }

    row.on("pointertap", () => {
      if (slotView.ignoreNextTap) {
        slotView.ignoreNextTap = false;
        return;
      }
      if (entry.locked) return;
      if (!entry.endpointId) return;
      const nextEnabled = !entry.enabled;
      const routingMode = slotView.routingMode || "process";
      if (routingMode === "template") {
        if (!slotView.targetRef || !slotView.systemId) return;
        queueActionWhenPaused?.(() =>
          dispatchAction?.(
            ActionKinds.TOGGLE_ROUTING_TEMPLATE_ENDPOINT,
            {
              targetRef: slotView.targetRef,
              systemId: slotView.systemId,
              slotKind: slotView.slotKind,
              slotId: slotView.slotId,
              endpointId: entry.endpointId,
              enabled: nextEnabled,
            },
            { apCost: 0 }
          )
        );
        return;
      }

      if (!slotView.processId) return;
      queueActionWhenPaused?.(() =>
        dispatchAction?.(
          ActionKinds.TOGGLE_PROCESS_ROUTING_ENDPOINT,
          {
            processId: slotView.processId,
            slotKind: slotView.slotKind,
            slotId: slotView.slotId,
            endpointId: entry.endpointId,
            enabled: nextEnabled,
          },
          { apCost: 0 }
        )
      );
    });

    return entry;
  }

  function formatPoolSummary(poolTarget) {
    if (!poolTarget || poolTarget.kind !== "pool") return null;
    const pool = poolTarget.target;
    if (!pool || typeof pool !== "object") return null;
    const totals = { bronze: 0, silver: 0, gold: 0, diamond: 0 };
    if (
      pool.bronze != null ||
      pool.silver != null ||
      pool.gold != null ||
      pool.diamond != null
    ) {
      totals.bronze = Math.max(0, Math.floor(pool.bronze ?? 0));
      totals.silver = Math.max(0, Math.floor(pool.silver ?? 0));
      totals.gold = Math.max(0, Math.floor(pool.gold ?? 0));
      totals.diamond = Math.max(0, Math.floor(pool.diamond ?? 0));
    } else {
      const keys = Object.keys(pool);
      for (const key of keys) {
        const bucket = pool[key];
        if (!bucket || typeof bucket !== "object") continue;
        totals.bronze += Math.max(0, Math.floor(bucket.bronze ?? 0));
        totals.silver += Math.max(0, Math.floor(bucket.silver ?? 0));
        totals.gold += Math.max(0, Math.floor(bucket.gold ?? 0));
        totals.diamond += Math.max(0, Math.floor(bucket.diamond ?? 0));
      }
    }
    return `B ${totals.bronze}  S ${totals.silver}  G ${totals.gold}  D ${totals.diamond}`;
  }

  function hasSelectableSlots(processDef, slotKind) {
    const slots = processDef?.routingSlots?.[slotKind] || [];
    return slots.some((slot) => slot && slot.locked !== true);
  }

  function getRequirementRows(reqs) {
    if (!Array.isArray(reqs) || reqs.length === 0) return [];
    if (reqs.length > 3) {
      let totalAmount = 0;
      let totalProgress = 0;
      for (const req of reqs) {
        totalAmount += Math.max(0, Math.floor(req.amount ?? 0));
        totalProgress += Math.max(0, Math.floor(req.progress ?? 0));
      }
      return [
        {
          label: "Items",
          progress: totalProgress,
          amount: totalAmount,
        },
      ];
    }
    return reqs.map((req) => ({
      label: formatRequirementLabel(req),
      progress: Math.max(0, Math.floor(req.progress ?? 0)),
      amount: Math.max(0, Math.floor(req.amount ?? 0)),
    }));
  }

  function getPrestigeTotals(process) {
    const totals = { bronze: 0, silver: 0, gold: 0, diamond: 0 };
    const byKind = process?.consumedByKindTier || null;
    if (!byKind || typeof byKind !== "object") return totals;
    for (const bucket of Object.values(byKind)) {
      if (!bucket || typeof bucket !== "object") continue;
      totals.bronze += Math.max(0, Math.floor(bucket.bronze ?? 0));
      totals.silver += Math.max(0, Math.floor(bucket.silver ?? 0));
      totals.gold += Math.max(0, Math.floor(bucket.gold ?? 0));
      totals.diamond += Math.max(0, Math.floor(bucket.diamond ?? 0));
    }
    return totals;
  }

  function resolveLockedOutputEndpoint(process, processDef, output) {
    if (!processDef || !output) return null;
    const slots = processDef.routingSlots?.outputs || [];
    const slot =
      output.slotId && slots.find((s) => s?.slotId === output.slotId)
        ? slots.find((s) => s?.slotId === output.slotId)
        : slots[0] || null;
    if (!slot || !slot.locked) return null;
    const endpointId =
      resolveFixedEndpointId(slot.candidateRule?.endpointId, process, {
        leaderId: process?.leaderId ?? null,
      }) || (Array.isArray(slot.default?.ordered) ? slot.default.ordered[0] : null);
    return endpointId || null;
  }
  function buildProgressModule({
    container,
    width,
    process,
    processDef,
    vertical,
  }) {
    const bg = new PIXI.Graphics();
    container.addChild(bg);

    const labelText = new PIXI.Text(
      vertical ? "Progress: Time" : "Progress: Work",
      {
        fill: COLORS.moduleSub,
        fontSize: 10,
      }
    );
    labelText.x = MODULE_PAD;
    labelText.y = MODULE_PAD;
    container.addChild(labelText);

    const duration = Math.max(1, Math.floor(processDef?.transform?.durationSec ?? 1));
    const progress = Math.max(0, Math.floor(process?.progress ?? 0));
    const ratio = Math.min(1, progress / duration);

    if (vertical) {
      const barWidth = 14;
      const barHeight = 40;
      const barX = Math.floor((width - barWidth) / 2);
      const barY = labelText.y + 14;

      const barBg = new PIXI.Graphics();
      barBg.beginFill(COLORS.progressBg, 1);
      barBg.drawRoundedRect(barX, barY, barWidth, barHeight, 6);
      barBg.endFill();
      container.addChild(barBg);

      const fillHeight = Math.max(2, barHeight * ratio);
      const fill = new PIXI.Graphics();
      fill.beginFill(COLORS.progressFill, 1);
      fill.drawRoundedRect(
        barX,
        barY + (barHeight - fillHeight),
        barWidth,
        fillHeight,
        6
      );
      fill.endFill();
      container.addChild(fill);

      const remain = Math.max(0, duration - progress);
      const timeText = new PIXI.Text(`${remain}s`, {
        fill: COLORS.moduleSub,
        fontSize: 10,
      });
      timeText.x = Math.floor((width - timeText.width) / 2);
      timeText.y = barY + barHeight + 4;
      container.addChild(timeText);
    } else {
      const barWidth = width - MODULE_PAD * 2;
      const barHeight = 10;
      const barX = MODULE_PAD;
      const barY = labelText.y + 16;

      const barBg = new PIXI.Graphics();
      barBg.beginFill(COLORS.progressBg, 1);
      barBg.drawRoundedRect(barX, barY, barWidth, barHeight, 6);
      barBg.endFill();
      container.addChild(barBg);

      const fillWidth = Math.max(2, barWidth * ratio);
      const fill = new PIXI.Graphics();
      fill.beginFill(COLORS.progressFill, 1);
      fill.drawRoundedRect(barX, barY, fillWidth, barHeight, 6);
      fill.endFill();
      container.addChild(fill);

      const remain = Math.max(0, duration - progress);
      const timeText = new PIXI.Text(`${remain}s`, {
        fill: COLORS.moduleSub,
        fontSize: 10,
      });
      timeText.x = Math.floor((width - timeText.width) / 2);
      timeText.y = barY + barHeight + 6;
      container.addChild(timeText);
    }

    const height = Math.max(56, container.height + MODULE_PAD);
    drawModuleBox(bg, width, height);
    return height;
  }

  function buildGrowthProgressModule({ container, width, entries }) {
    const bg = new PIXI.Graphics();
    container.addChild(bg);

    const labelText = new PIXI.Text("Progress: Time", {
      fill: COLORS.moduleSub,
      fontSize: 10,
    });
    labelText.x = MODULE_PAD;
    labelText.y = MODULE_PAD;
    container.addChild(labelText);

    const list = Array.isArray(entries) ? entries : [];
    if (list.length === 0) {
      const none = new PIXI.Text("No crops growing", {
        fill: COLORS.moduleSub,
        fontSize: 9,
      });
      none.x = MODULE_PAD;
      none.y = labelText.y + 16;
      container.addChild(none);

      const height = Math.max(56, none.y + 18);
      drawModuleBox(bg, width, height);
      return height;
    }

    const barHeight = 40;
    const barGap = 8;
    const barAreaWidth = width - MODULE_PAD * 2;
    const count = list.length;
    const maxBarWidth = 12;
    const barWidthRaw = Math.floor(
      (barAreaWidth - barGap * (count - 1)) / count
    );
    const barWidth = Math.max(6, Math.min(maxBarWidth, barWidthRaw));
    const totalBarsWidth =
      barWidth * count + barGap * Math.max(0, count - 1);
    const startX = Math.floor(MODULE_PAD + (barAreaWidth - totalBarsWidth) / 2);
    const barY = labelText.y + 16;

    list.forEach((entry, index) => {
      const process = entry?.process || null;
      const processDef = entry?.processDef || null;
      const duration = Math.max(
        1,
        Math.floor(
          processDef?.transform?.durationSec ?? process?.durationSec ?? 1
        )
      );
      const progress = Math.max(0, Math.floor(process?.progress ?? 0));
      const ratio = Math.min(1, progress / duration);
      const remain = Math.max(0, duration - progress);

      const x = startX + index * (barWidth + barGap);
      const barBg = new PIXI.Graphics();
      barBg.beginFill(COLORS.progressBg, 1);
      barBg.drawRoundedRect(x, barY, barWidth, barHeight, 6);
      barBg.endFill();
      container.addChild(barBg);

      const fillHeight = Math.max(2, barHeight * ratio);
      const fill = new PIXI.Graphics();
      fill.beginFill(COLORS.progressFill, 1);
      fill.drawRoundedRect(
        x,
        barY + (barHeight - fillHeight),
        barWidth,
        fillHeight,
        6
      );
      fill.endFill();
      container.addChild(fill);

      const timeText = new PIXI.Text(`${remain}s`, {
        fill: COLORS.moduleSub,
        fontSize: 9,
      });
      timeText.x = x + Math.max(0, Math.floor((barWidth - timeText.width) / 2));
      timeText.y = barY + barHeight + 4;
      container.addChild(timeText);
    });

    const height = Math.max(56, barY + barHeight + 18);
    drawModuleBox(bg, width, height);
    return height;
  }

  function buildRequirementsModule({ container, width, reqs }) {
    const bg = new PIXI.Graphics();
    container.addChild(bg);

    const title = new PIXI.Text("Materials", {
      fill: COLORS.moduleText,
      fontSize: 10,
      fontWeight: "bold",
    });
    title.x = MODULE_PAD;
    title.y = MODULE_PAD;
    container.addChild(title);

    let y = title.y + 14;
    const rows = getRequirementRows(reqs);
    if (rows.length === 0) {
      const none = new PIXI.Text("None", {
        fill: COLORS.moduleSub,
        fontSize: 9,
      });
      none.x = MODULE_PAD;
      none.y = y;
      container.addChild(none);
      y += 12;
    } else {
      for (const row of rows) {
        const label = new PIXI.Text(
          `${row.label} ${row.progress}/${row.amount}`,
          {
            fill: COLORS.moduleSub,
            fontSize: 9,
          }
        );
        label.x = MODULE_PAD;
        label.y = y;
        container.addChild(label);

        const barWidth = width - MODULE_PAD * 2;
        const barHeight = 6;
        const barY = y + 10;
        const ratio = row.amount > 0 ? Math.min(1, row.progress / row.amount) : 0;

        const barBg = new PIXI.Graphics();
        barBg.beginFill(COLORS.progressBg, 1);
        barBg.drawRoundedRect(MODULE_PAD, barY, barWidth, barHeight, 4);
        barBg.endFill();
        container.addChild(barBg);

        const fill = new PIXI.Graphics();
        fill.beginFill(COLORS.progressFill, 1);
        fill.drawRoundedRect(
          MODULE_PAD,
          barY,
          Math.max(2, barWidth * ratio),
          barHeight,
          4
        );
        fill.endFill();
        container.addChild(fill);

        y += 18;
      }
    }

    const height = Math.max(52, y + MODULE_PAD - 2);
    drawModuleBox(bg, width, height);
    return height;
  }

  function buildOutputModule({
    container,
    width,
    outputs,
    poolSummary,
    selectionControl = null,
  }) {
    const bg = new PIXI.Graphics();
    container.addChild(bg);

    const title = new PIXI.Text("Output", {
      fill: COLORS.moduleText,
      fontSize: 10,
      fontWeight: "bold",
    });
    title.x = MODULE_PAD;
    title.y = MODULE_PAD;
    container.addChild(title);

    if (selectionControl?.label) {
      const btnPadX = 6;
      const btnPadY = 2;
      const btnHeight = 14;
      const btnWidth = Math.max(64, Math.floor(width * 0.42));
      const btn = new PIXI.Container();
      btn.x = Math.max(
        MODULE_PAD,
        width - MODULE_PAD - btnWidth
      );
      btn.y = MODULE_PAD - 1;
      btn.eventMode = selectionControl?.enabled === false ? "none" : "static";
      btn.cursor = selectionControl?.enabled === false ? "default" : "pointer";

      const btnBg = new PIXI.Graphics();
      btnBg.lineStyle(1, COLORS.moduleBorder, 0.95);
      btnBg.beginFill(0x2c3348, 0.98);
      btnBg.drawRoundedRect(0, 0, btnWidth, btnHeight, 6);
      btnBg.endFill();
      btn.addChild(btnBg);

      const label = new PIXI.Text(String(selectionControl.label), {
        fill: COLORS.moduleText,
        fontSize: 9,
        fontWeight: "bold",
      });
      label.x = btnPadX;
      label.y = btnPadY;
      btn.addChild(label);

      const chevron = new PIXI.Text("v", {
        fill: COLORS.moduleSub,
        fontSize: 9,
      });
      chevron.x = btnWidth - chevron.width - btnPadX;
      chevron.y = btnPadY;
      btn.addChild(chevron);

      btn.on("pointertap", () => {
        if (selectionControl?.enabled === false) return;
        selectionControl?.onOpen?.(btn.getBounds());
      });

      container.addChild(btn);
    }

    let y = title.y + 14;
    if (!Array.isArray(outputs) || outputs.length === 0) {
      const none = new PIXI.Text("None", {
        fill: COLORS.moduleSub,
        fontSize: 9,
      });
      none.x = MODULE_PAD;
      none.y = y;
      container.addChild(none);
      y += 12;
    } else {
      const primary = outputs[0];
      const label = formatOutputLabel(primary);
      const qty = Math.max(0, Math.floor(primary.qty ?? primary.amount ?? 0));
      const lineText = primary.kind === "pool" && primary.fromLedger
        ? label
        : qty > 1
          ? `${label} x${qty}`
          : label;

      const line = new PIXI.Text(lineText, {
        fill: COLORS.moduleSub,
        fontSize: 9,
      });
      line.x = MODULE_PAD;
      line.y = y;
      container.addChild(line);
      y += 12;

      if (poolSummary) {
        const poolText = new PIXI.Text(poolSummary, {
          fill: COLORS.moduleSub,
          fontSize: 9,
        });
        poolText.x = MODULE_PAD;
        poolText.y = y;
        container.addChild(poolText);
        y += 12;
      }

      if (outputs.length > 1) {
        const more = new PIXI.Text(`+${outputs.length - 1} more`, {
          fill: COLORS.moduleSub,
          fontSize: 9,
        });
        more.x = MODULE_PAD;
        more.y = y;
        container.addChild(more);
        y += 12;
      }
    }

    const height = Math.max(52, y + MODULE_PAD - 2);
    drawModuleBox(bg, width, height);
    return height;
  }

  function buildGrowthOutputModule({
    container,
    width,
    pool,
    selectionControl = null,
  }) {
    const bg = new PIXI.Graphics();
    container.addChild(bg);

    const title = new PIXI.Text("Matured Pool", {
      fill: COLORS.moduleText,
      fontSize: 10,
      fontWeight: "bold",
    });
    title.x = MODULE_PAD;
    title.y = MODULE_PAD;
    container.addChild(title);

    if (selectionControl?.label) {
      const btnPadX = 6;
      const btnPadY = 2;
      const btnHeight = 14;
      const btnWidth = Math.max(64, Math.floor(width * 0.42));
      const btn = new PIXI.Container();
      btn.x = Math.max(
        MODULE_PAD,
        width - MODULE_PAD - btnWidth
      );
      btn.y = MODULE_PAD - 1;
      btn.eventMode = selectionControl?.enabled === false ? "none" : "static";
      btn.cursor = selectionControl?.enabled === false ? "default" : "pointer";

      const btnBg = new PIXI.Graphics();
      btnBg.lineStyle(1, COLORS.moduleBorder, 0.95);
      btnBg.beginFill(0x2c3348, 0.98);
      btnBg.drawRoundedRect(0, 0, btnWidth, btnHeight, 6);
      btnBg.endFill();
      btn.addChild(btnBg);

      const label = new PIXI.Text(String(selectionControl.label), {
        fill: COLORS.moduleText,
        fontSize: 9,
        fontWeight: "bold",
      });
      label.x = btnPadX;
      label.y = btnPadY;
      btn.addChild(label);

      const chevron = new PIXI.Text("v", {
        fill: COLORS.moduleSub,
        fontSize: 9,
      });
      chevron.x = btnWidth - chevron.width - btnPadX;
      chevron.y = btnPadY;
      btn.addChild(chevron);

      btn.on("pointertap", () => {
        if (selectionControl?.enabled === false) return;
        selectionControl?.onOpen?.(btn.getBounds());
      });

      container.addChild(btn);
    }

    let y = title.y + 14;
    const summary = formatPoolSummary({ kind: "pool", target: pool });
    if (!summary) {
      const none = new PIXI.Text("None", {
        fill: COLORS.moduleSub,
        fontSize: 9,
      });
      none.x = MODULE_PAD;
      none.y = y;
      container.addChild(none);
      y += 12;
    } else {
      const poolText = new PIXI.Text(summary, {
        fill: COLORS.moduleSub,
        fontSize: 9,
      });
      poolText.x = MODULE_PAD;
      poolText.y = y;
      container.addChild(poolText);
      y += 12;
    }

    const height = Math.max(52, y + MODULE_PAD - 2);
    drawModuleBox(bg, width, height);
    return height;
  }

  function buildPrestigeModule({ container, width, process }) {
    const bg = new PIXI.Graphics();
    container.addChild(bg);

    const title = new PIXI.Text("Prestige", {
      fill: COLORS.moduleText,
      fontSize: 10,
      fontWeight: "bold",
    });
    title.x = MODULE_PAD;
    title.y = MODULE_PAD;
    container.addChild(title);

    const totals = getPrestigeTotals(process);
    const rows = [
      { key: "bronze", label: "B", value: totals.bronze },
      { key: "silver", label: "S", value: totals.silver },
      { key: "gold", label: "G", value: totals.gold },
      { key: "diamond", label: "D", value: totals.diamond },
    ];
    const max = Math.max(1, ...rows.map((r) => r.value));

    let y = title.y + 14;
    const barWidth = width - MODULE_PAD * 2 - 16;
    for (const row of rows) {
      const label = new PIXI.Text(row.label, {
        fill: COLORS.moduleSub,
        fontSize: 9,
      });
      label.x = MODULE_PAD;
      label.y = y;
      container.addChild(label);

      const ratio = Math.min(1, row.value / max);
      const barBg = new PIXI.Graphics();
      barBg.beginFill(COLORS.progressBg, 1);
      barBg.drawRoundedRect(MODULE_PAD + 12, y + 2, barWidth, 6, 4);
      barBg.endFill();
      container.addChild(barBg);

      const fill = new PIXI.Graphics();
      fill.beginFill(COLORS.progressFill, 1);
      fill.drawRoundedRect(
        MODULE_PAD + 12,
        y + 2,
        Math.max(2, barWidth * ratio),
        6,
        4
      );
      fill.endFill();
      container.addChild(fill);

      y += 12;
    }

    const height = Math.max(52, y + MODULE_PAD - 2);
    drawModuleBox(bg, width, height);
    return height;
  }

  function buildWithdrawModule({
    container,
    width,
    pool,
    withdrawState,
    onOpenItemDropdown,
    onWithdraw,
  }) {
    const bg = new PIXI.Graphics();
    container.addChild(bg);

    const title = new PIXI.Text("Withdraw", {
      fill: COLORS.moduleText,
      fontSize: 10,
      fontWeight: "bold",
    });
    title.x = MODULE_PAD;
    title.y = MODULE_PAD;
    container.addChild(title);

    const options = getPoolItemOptions(pool);
    const selectedItemId = normalizeWithdrawSelection(withdrawState, options);
    const totals = getPoolItemTotals(pool, selectedItemId);
    const selectedLabel = selectedItemId
      ? itemDefs?.[selectedItemId]?.name || selectedItemId
      : "No stored items";
    const maxAmount = Math.max(1, totals.total);
    const amount = Math.max(1, Math.min(maxAmount, Math.floor(withdrawState?.amount ?? 1)));
    if (withdrawState) withdrawState.amount = amount;

    const selectBtnY = title.y + 14;
    const selectBtnW = width - MODULE_PAD * 2;
    const selectBtnH = 16;
    const selectBtn = new PIXI.Container();
    selectBtn.x = MODULE_PAD;
    selectBtn.y = selectBtnY;
    selectBtn.eventMode = options.length > 0 ? "static" : "none";
    selectBtn.cursor = options.length > 0 ? "pointer" : "default";
    container.addChild(selectBtn);

    const selectBg = new PIXI.Graphics();
    selectBg.lineStyle(1, COLORS.moduleBorder, 0.95);
    selectBg.beginFill(0x2c3348, 0.98);
    selectBg.drawRoundedRect(0, 0, selectBtnW, selectBtnH, 6);
    selectBg.endFill();
    selectBtn.addChild(selectBg);

    const selectText = new PIXI.Text(selectedLabel, {
      fill: options.length > 0 ? COLORS.moduleText : COLORS.moduleSub,
      fontSize: 9,
      fontWeight: "bold",
    });
    selectText.x = 6;
    selectText.y = 2;
    selectBtn.addChild(selectText);

    const selectChevron = new PIXI.Text("v", {
      fill: COLORS.moduleSub,
      fontSize: 9,
    });
    selectChevron.x = selectBtnW - selectChevron.width - 6;
    selectChevron.y = 2;
    selectBtn.addChild(selectChevron);

    if (options.length > 0) {
      selectBtn.on("pointertap", () => {
        onOpenItemDropdown?.(selectBtn.getBounds());
      });
    }

    let y = selectBtnY + selectBtnH + 6;
    const tierRows = [
      { label: "B", key: "bronze" },
      { label: "S", key: "silver" },
      { label: "G", key: "gold" },
      { label: "D", key: "diamond" },
    ];
    for (const row of tierRows) {
      const value = Math.max(0, Math.floor(totals.byTier?.[row.key] ?? 0));
      const text = new PIXI.Text(`${row.label} ${value}`, {
        fill: COLORS.moduleSub,
        fontSize: 9,
      });
      text.x = MODULE_PAD;
      text.y = y;
      container.addChild(text);
      y += 10;
    }

    const controlsY = y + 2;
    const controlsW = width - MODULE_PAD * 2;
    const amountW = 34;
    const btnW = 16;
    const btnH = 16;
    const gap = 4;
    const amountX = MODULE_PAD + Math.floor((controlsW - (btnW * 2 + amountW + gap * 2)) / 2);

    const minusBtn = new PIXI.Container();
    minusBtn.x = amountX;
    minusBtn.y = controlsY;
    minusBtn.eventMode = "static";
    minusBtn.cursor = "pointer";
    container.addChild(minusBtn);
    const minusBg = new PIXI.Graphics();
    minusBtn.addChild(minusBg);
    const minusText = new PIXI.Text("-", {
      fill: COLORS.moduleText,
      fontSize: 11,
      fontWeight: "bold",
    });
    minusText.x = 6;
    minusText.y = 1;
    minusBtn.addChild(minusText);

    const amountBg = new PIXI.Graphics();
    amountBg.x = amountX + btnW + gap;
    amountBg.y = controlsY;
    container.addChild(amountBg);
    const amountText = new PIXI.Text(String(amount), {
      fill: COLORS.moduleText,
      fontSize: 9,
      fontWeight: "bold",
    });
    container.addChild(amountText);

    const plusBtn = new PIXI.Container();
    plusBtn.x = amountX + btnW + gap + amountW + gap;
    plusBtn.y = controlsY;
    plusBtn.eventMode = "static";
    plusBtn.cursor = "pointer";
    container.addChild(plusBtn);
    const plusBg = new PIXI.Graphics();
    plusBtn.addChild(plusBg);
    const plusText = new PIXI.Text("+", {
      fill: COLORS.moduleText,
      fontSize: 11,
      fontWeight: "bold",
    });
    plusText.x = 4;
    plusText.y = 1;
    plusBtn.addChild(plusText);

    const spawnBtn = new PIXI.Container();
    spawnBtn.x = MODULE_PAD;
    spawnBtn.y = controlsY + btnH + 6;
    spawnBtn.eventMode = "static";
    spawnBtn.cursor = "pointer";
    container.addChild(spawnBtn);
    const spawnBg = new PIXI.Graphics();
    spawnBtn.addChild(spawnBg);
    const spawnText = new PIXI.Text("Spawn To Cursor", {
      fill: COLORS.moduleText,
      fontSize: 9,
      fontWeight: "bold",
    });
    spawnBtn.addChild(spawnText);

    function drawSmallButton(nodeBg, enabled) {
      nodeBg.clear();
      nodeBg.lineStyle(1, COLORS.moduleBorder, 0.95);
      nodeBg.beginFill(enabled ? 0x2f3f60 : 0x252b39, 0.98);
      nodeBg.drawRoundedRect(0, 0, btnW, btnH, 5);
      nodeBg.endFill();
    }

    function refreshControls() {
      const current = Math.max(
        1,
        Math.min(
          Math.max(1, Math.floor(totals.total ?? 0)),
          Math.floor(withdrawState?.amount ?? 1)
        )
      );
      if (withdrawState) withdrawState.amount = current;
      amountText.text = String(current);
      amountText.x = amountBg.x + Math.floor((amountW - amountText.width) / 2);
      amountText.y = amountBg.y + 2;
      amountBg.clear();
      amountBg.lineStyle(1, COLORS.moduleBorder, 0.95);
      amountBg.beginFill(0x1c2234, 0.98);
      amountBg.drawRoundedRect(0, 0, amountW, btnH, 5);
      amountBg.endFill();

      const canMinus = current > 1;
      const canPlus = totals.total > 0 && current < totals.total;
      const canSpawn = totals.total > 0 && !!selectedItemId;

      drawSmallButton(minusBg, canMinus);
      drawSmallButton(plusBg, canPlus);
      minusBtn.alpha = canMinus ? 1 : 0.55;
      plusBtn.alpha = canPlus ? 1 : 0.55;
      minusBtn.cursor = canMinus ? "pointer" : "default";
      plusBtn.cursor = canPlus ? "pointer" : "default";

      spawnBg.clear();
      spawnBg.lineStyle(1, COLORS.moduleBorder, 0.95);
      spawnBg.beginFill(canSpawn ? 0x2f5a3d : 0x27303f, 0.98);
      spawnBg.drawRoundedRect(0, 0, selectBtnW, 18, 6);
      spawnBg.endFill();
      spawnText.x = Math.floor((selectBtnW - spawnText.width) / 2);
      spawnText.y = 3;
      spawnBtn.alpha = canSpawn ? 1 : 0.65;
      spawnBtn.cursor = canSpawn ? "pointer" : "default";
    }

    minusBtn.on("pointertap", () => {
      if (withdrawState?.amount > 1) {
        withdrawState.amount -= 1;
        refreshControls();
      }
    });

    plusBtn.on("pointertap", () => {
      const cur = Math.floor(withdrawState?.amount ?? 1);
      if (totals.total > 0 && cur < totals.total) {
        withdrawState.amount = cur + 1;
        refreshControls();
      }
    });

    spawnBtn.on("pointertap", () => {
      if (!selectedItemId) return;
      if (totals.total <= 0) return;
      const qty = Math.max(1, Math.min(totals.total, Math.floor(withdrawState?.amount ?? 1)));
      onWithdraw?.(selectedItemId, qty);
    });

    refreshControls();

    const height = Math.max(88, spawnBtn.y + 24);
    drawModuleBox(bg, width, height);
    return height;
  }

  function buildBufferModule({ container, width, height, process, dropTargets }) {
    const bg = new PIXI.Graphics();
    container.addChild(bg);

    const size = Math.min(width, height);
    const slot = new PIXI.Graphics();
    slot.lineStyle(1, COLORS.bufferBorder, 0.9);
    slot.beginFill(0x1a2034, 0.95);
    slot.drawRoundedRect(0, 0, size, size, 8);
    slot.endFill();
    slot.x = Math.floor((width - size) / 2);
    slot.y = Math.floor((height - size) / 2) - 6;
    container.addChild(slot);

    const label = new PIXI.Text("Buffer", {
      fill: COLORS.moduleSub,
      fontSize: 9,
    });
    label.x = Math.floor((width - label.width) / 2);
    label.y = slot.y + size + 4;
    container.addChild(label);

    const dropId = getDropEndpointId(process?.id);
    if (dropId && Array.isArray(dropTargets)) {
      dropTargets.push({
        ownerId: dropId,
        getBounds: () => slot.getBounds(),
      });

      slot.eventMode = "static";
      slot.cursor = "pointer";
      slot.on("pointertap", () => {
        inventoryView?.revealWindow?.(dropId, { pinned: true });
      });
    }

    drawBufferBox(bg, width, height);
  }

  function buildRoutingDrawer({
    kind,
    width,
    height,
    process,
    processDef,
    routingProcess,
    routingProcessDef,
    routingState,
    routingMode,
    targetRef,
    systemId,
    drawerKey,
    target,
    state,
    hideDrop,
  }) {
    const container = new PIXI.Container();
    const bg = new PIXI.Graphics();
    container.addChild(bg);

    const keyId = drawerKey || process?.id || "routing";
    const key = `${keyId}:${kind}`;
    const expanded = drawerExpanded[kind].has(key);

    const arrow = new PIXI.Text(expanded ? (kind === "inputs" ? "<" : ">") : (kind === "inputs" ? ">" : "<"), {
      fill: COLORS.headerSub,
      fontSize: 12,
    });
    arrow.eventMode = "static";
    arrow.cursor = "pointer";
    arrow.x = Math.floor((width - arrow.width) / 2);
    arrow.y = 6;
    arrow.on("pointertap", () => {
      if (expanded) drawerExpanded[kind].delete(key);
      else drawerExpanded[kind].add(key);
      invalidateAllSignatures();
    });
    container.addChild(arrow);

    if (expanded) {
      let y = 22;
      const routingDef = routingProcessDef || processDef;
      const activeProcess = routingProcess || process;
      const routing = routingState || activeProcess?.routing || null;
      const slots = routingDef?.routingSlots?.[kind] || [];
      const context = { leaderId: activeProcess?.leaderId ?? null };
      for (const slotDef of slots) {
        if (!slotDef || slotDef.locked) continue;

        const label = new PIXI.Text(slotDef.label || slotDef.slotId, {
          fill: COLORS.moduleText,
          fontSize: 10,
          fontWeight: "bold",
        });
        label.x = MODULE_PAD;
        label.y = y;
        container.addChild(label);
        y += 14;

        const slotState =
          routing?.[kind]?.[slotDef.slotId] || { ordered: [], enabled: {} };
        const orderedRaw = Array.isArray(slotState.ordered)
          ? slotState.ordered
          : [];

        const candidates = listCandidateEndpoints(
          state,
          activeProcess,
          slotDef,
          target,
          context
        );
        const orderedList = orderedRaw.length > 0 ? orderedRaw : candidates;

        const pillContainer = new PIXI.Container();
        pillContainer.x = MODULE_PAD;
        pillContainer.y = y;
        container.addChild(pillContainer);

        const slotView = {
          processId: process?.id ?? null,
          slotKind: kind,
          slotId: slotDef.slotId,
          slotLocked: false,
          pillContainer,
          pillEntries: [],
          ignoreNextTap: false,
          entryWidth: width - MODULE_PAD * 2,
          routingMode: routingMode || "process",
          targetRef: targetRef || null,
          systemId: systemId || null,
        };

        for (const rawEndpointId of orderedList) {
          const resolvedId =
            resolveFixedEndpointId(rawEndpointId, activeProcess, context) || rawEndpointId;
          const isDrop =
            isDropEndpoint(resolvedId) && routingDef?.supportsDropslot;
          if (hideDrop && isDrop) continue;
          const enabled = slotState.enabled?.[rawEndpointId] !== false;
          const valid = isDrop || candidates.includes(resolvedId);
          const entry = buildPillEntry(state, slotView, rawEndpointId, resolvedId, {
            enabled,
            invalid: !valid,
            locked: isDrop,
            draggable: !isDrop,
          });
          pillContainer.addChild(entry.container);
          slotView.pillEntries.push(entry);
        }

        layoutPillEntries(slotView);
        y += slotView.pillHeight + MODULE_GAP;
      }
    }

    drawDrawerBox(bg, width, height);

    return { container };
  }
  function buildProcessCard(state, target, entry, index, count, opts = {}) {
    const process = entry.process;
    const processDef = entry.processDef;
    const targetLabel = getTargetLabel(target);
    const isGrowthGroup = opts.groupMode === "growth";
    const growthEntries = Array.isArray(opts.groupEntries)
      ? opts.groupEntries
      : null;
    const isPreview = opts.preview === true;
    const variantOverride = opts.variantOverride || null;
    const routingMode = opts.routingMode || "process";
    const routingProcess = opts.routingProcess || process;
    const routingProcessDef = opts.routingProcessDef || processDef;
    const routingState = opts.routingState || routingProcess?.routing || null;
    const routingTargetRef = opts.routingTargetRef || null;
    const routingSystemId = opts.routingSystemId || null;
    const allowRouting =
      typeof opts.allowRouting === "boolean"
        ? opts.allowRouting
        : routingMode === "template"
          ? true
          : !isPreview;
    const allowBuffer =
      typeof opts.allowBuffer === "boolean" ? opts.allowBuffer : !isPreview;
    const drawerKey =
      opts.drawerKey ||
      (routingMode === "template"
        ? `${routingSystemId || "system"}:${getTargetKey(target) || "target"}`
        : process?.id);

    const card = new PIXI.Container();
    const bg = new PIXI.Graphics();
    card.addChild(bg);

    const showBuffer = allowBuffer && !!routingProcessDef?.supportsDropslot;
    const inputDrawerVisible =
      allowRouting && hasSelectableSlots(routingProcessDef, "inputs");
    const outputDrawerVisible =
      allowRouting && hasSelectableSlots(routingProcessDef, "outputs");

    const leftDrawerWidth = inputDrawerVisible
      ? drawerExpanded.inputs.has(`${drawerKey}:inputs`)
        ? DRAWER_EXPANDED
        : DRAWER_COLLAPSED
      : 0;
    const rightDrawerWidth = outputDrawerVisible
      ? drawerExpanded.outputs.has(`${drawerKey}:outputs`)
        ? DRAWER_EXPANDED
        : DRAWER_COLLAPSED
      : 0;

    const bufferGap = showBuffer ? SEGMENT_GAP : 0;
    const centralWidth = Math.max(120, CORE_WIDTH - (showBuffer ? (BUFFER_SIZE + bufferGap) : 0));

    const segments = [];
    if (inputDrawerVisible) segments.push({ key: "left", width: leftDrawerWidth });
    if (showBuffer) segments.push({ key: "buffer", width: BUFFER_SIZE });
    segments.push({ key: "central", width: centralWidth });
    if (outputDrawerVisible) segments.push({ key: "right", width: rightDrawerWidth });

    let x = 0;
    for (let i = 0; i < segments.length; i++) {
      segments[i].x = x;
      x += segments[i].width;
      if (i < segments.length - 1) x += SEGMENT_GAP;
    }
    const totalWidth = x;

    const title =
      opts.titleOverride ||
      getCardTitle(targetLabel, process, processDef, variantOverride);
    const pinned = typeof opts.pinned === "boolean" ? opts.pinned : false;

    const headerUi = createWindowHeader({
      stage: app?.stage,
      parent: card,
      width: totalWidth,
      height: HEADER_HEIGHT,
      radius: CARD_RADIUS,
      background: COLORS.headerBg,
      title,
      titleStyle: { fill: COLORS.headerText, fontSize: 12, fontWeight: "bold" },
      paddingX: HEADER_PAD_X,
      paddingY: HEADER_PAD_Y,
      pinOffsetX: 40,
      closeOffsetX: 20,
      dragTarget: opts.dragTarget,
      onPinToggle: () => opts.onPinToggle?.(process, target),
      onClose: () => opts.onClose?.(process, target),
    });
    headerUi.setPinned(!!pinned);

    if (isGrowthGroup && growthEntries) {
      const batchText = new PIXI.Text(`${growthEntries.length} batches`, {
        fill: COLORS.headerSub,
        fontSize: 9,
      });
      batchText.x = headerUi.titleText.x + headerUi.titleText.width + 6;
      batchText.y = HEADER_PAD_Y + 1;
      headerUi.container.addChild(batchText);
    } else if (count > 1) {
      const idxText = new PIXI.Text(`${index + 1}/${count}`, {
        fill: COLORS.headerSub,
        fontSize: 9,
      });
      idxText.x = headerUi.titleText.x + headerUi.titleText.width + 6;
      idxText.y = HEADER_PAD_Y + 1;
      headerUi.container.addChild(idxText);
    }

    const body = new PIXI.Container();
    body.y = HEADER_HEIGHT + 6;
    card.addChild(body);

    const bodyHeightTarget = 70;

    const central = new PIXI.Container();
    central.x = segments.find((s) => s.key === "central").x;
    central.y = BODY_PAD;
    body.addChild(central);

    const variant = variantOverride || getProcessVariant(process, processDef);
    const processSystemId = entry?.systemId || routingSystemId || null;
    const outputs = Array.isArray(processDef?.transform?.outputs)
      ? processDef.transform.outputs
      : [];
    const reqs = Array.isArray(processDef?.transform?.requirements)
      ? processDef.transform.requirements
      : [];

    let outputSelectionControl = null;
    if (variant === "growing") {
      const cropId = target?.systemState?.growth?.selectedCropId ?? null;
      outputSelectionControl = {
        label: formatCropName(cropId),
        enabled: true,
        onOpen: (bounds) => openGrowthSelectionDropdown(target, bounds),
      };
    } else if (isRecipeSystem(processSystemId)) {
      const recipeId = getSelectedRecipeId(target, processSystemId);
      outputSelectionControl = {
        label: formatRecipeName(recipeId),
        enabled: true,
        onOpen: (bounds) =>
          openRecipeSelectionDropdown(target, processSystemId, bounds),
      };
    }

    const modules = [];
    if (variant === "growing") {
      modules.push("progress", "output");
    } else if (variant === "depositing") {
      if (canWithdrawFromTarget(target)) modules.push("prestige", "withdraw");
      else modules.push("prestige", "output");
    } else if (variant === "building") {
      modules.push("requirements", "progress");
    } else if (variant === "cooking" || variant === "crafting") {
      modules.push("requirements", "progress", "output");
    } else {
      modules.push("requirements", "progress", "output");
    }

    const forceModules =
      opts.forceModules instanceof Set ? opts.forceModules : null;
    const filteredModules = modules.filter((id) => {
      if (forceModules?.has(id)) return true;
      if (id === "requirements") return reqs.length > 0;
      if (id === "output") return isGrowthGroup ? true : outputs.length > 0;
      return true;
    });

    const moduleCount = filteredModules.length || 1;
    const moduleWidth = Math.floor((centralWidth - (moduleCount - 1) * MODULE_GAP) / moduleCount);

    let moduleX = 0;
    let moduleMaxHeight = 0;

    for (const id of filteredModules) {
      const mod = new PIXI.Container();
      mod.x = moduleX;
      mod.y = 0;
      central.addChild(mod);

      let height = 0;
      if (id === "progress") {
        if (isGrowthGroup) {
          height = buildGrowthProgressModule({
            container: mod,
            width: moduleWidth,
            entries: growthEntries,
          });
        } else {
          const vertical = processDef?.transform?.mode !== "work";
          height = buildProgressModule({
            container: mod,
            width: moduleWidth,
            process,
            processDef,
            vertical,
          });
        }
      } else if (id === "requirements") {
        height = buildRequirementsModule({
          container: mod,
          width: moduleWidth,
          reqs,
        });
      } else if (id === "output") {
        if (isGrowthGroup) {
          const pool = target?.systemState?.growth?.maturedPool || null;
          height = buildGrowthOutputModule({
            container: mod,
            width: moduleWidth,
            pool,
            selectionControl: outputSelectionControl,
          });
        } else {
          const primaryPool = outputs.find((out) => out?.kind === "pool");
          let poolSummary = null;
          if (primaryPool) {
            const endpointId = resolveLockedOutputEndpoint(
              process,
              processDef,
              primaryPool
            );
            if (endpointId) {
              const poolTarget = resolveEndpointTarget(state, endpointId);
              poolSummary = formatPoolSummary(poolTarget);
            }
          }
          height = buildOutputModule({
            container: mod,
            width: moduleWidth,
            outputs,
            poolSummary,
            selectionControl: outputSelectionControl,
          });
        }
      } else if (id === "prestige") {
        height = buildPrestigeModule({
          container: mod,
          width: moduleWidth,
          process,
        });
      } else if (id === "withdraw") {
        const depositInfo = getDepositPoolTarget(target);
        const pool = depositInfo?.pool ?? null;
        const withdrawState = getWithdrawState(target);
        height = buildWithdrawModule({
          container: mod,
          width: moduleWidth,
          pool,
          withdrawState,
          onOpenItemDropdown: (bounds) =>
            openWithdrawItemDropdown(target, bounds),
          onWithdraw: (itemId, qty) => requestPoolWithdraw(target, itemId, qty),
        });
      }

      moduleMaxHeight = Math.max(moduleMaxHeight, height);
      moduleX += moduleWidth + MODULE_GAP;
    }

    central.y = BODY_PAD;
    central.height = moduleMaxHeight;

    let leftDrawer = null;
    let rightDrawer = null;

    if (inputDrawerVisible) {
      leftDrawer = buildRoutingDrawer({
        kind: "inputs",
        width: leftDrawerWidth,
        height: bodyHeightTarget,
        process,
        processDef,
        routingProcess,
        routingProcessDef,
        routingState,
        routingMode,
        targetRef: routingTargetRef,
        systemId: routingSystemId,
        drawerKey,
        target,
        state,
        hideDrop: showBuffer,
      });
      leftDrawer.container.x = segments.find((s) => s.key === "left").x;
      leftDrawer.container.y = BODY_PAD;
      body.addChild(leftDrawer.container);
    }

    let buffer = null;
    if (showBuffer) {
      buffer = new PIXI.Container();
      buffer.x = segments.find((s) => s.key === "buffer").x;
      buffer.y = BODY_PAD;
      body.addChild(buffer);
    }

    if (outputDrawerVisible) {
      rightDrawer = buildRoutingDrawer({
        kind: "outputs",
        width: rightDrawerWidth,
        height: bodyHeightTarget,
        process,
        processDef,
        routingProcess,
        routingProcessDef,
        routingState,
        routingMode,
        targetRef: routingTargetRef,
        systemId: routingSystemId,
        drawerKey,
        target,
        state,
        hideDrop: false,
      });
      rightDrawer.container.x = segments.find((s) => s.key === "right").x;
      rightDrawer.container.y = BODY_PAD;
      body.addChild(rightDrawer.container);
    }

    const leftHeight = leftDrawer?.container?.height || 0;
    const rightHeight = rightDrawer?.container?.height || 0;
    const bufferHeight = showBuffer ? BUFFER_SIZE + 18 : 0;
    const bodyContentHeight = Math.max(
      moduleMaxHeight,
      leftHeight,
      rightHeight,
      bufferHeight,
      bodyHeightTarget
    );

    const bodyHeight = bodyContentHeight + BODY_PAD * 2;

    if (leftDrawer) {
      drawDrawerBox(leftDrawer.container.children[0], leftDrawerWidth, bodyContentHeight);
      leftDrawer.container.height = bodyContentHeight;
    }
    if (rightDrawer) {
      drawDrawerBox(rightDrawer.container.children[0], rightDrawerWidth, bodyContentHeight);
      rightDrawer.container.height = bodyContentHeight;
    }

    if (showBuffer && buffer) {
      buildBufferModule({
        container: buffer,
        width: BUFFER_SIZE,
        height: bodyContentHeight,
        process,
        dropTargets: opts.dropTargets,
      });
    }

    central.y = BODY_PAD;
    const centralBg = new PIXI.Graphics();
    centralBg.beginFill(0x000000, 0);
    centralBg.drawRect(0, 0, centralWidth, bodyContentHeight);
    centralBg.endFill();
    central.addChildAt(centralBg, 0);

    const totalHeight = HEADER_HEIGHT + 6 + bodyHeight;
    drawCardBackground(bg, totalWidth, totalHeight);

    return { card, width: totalWidth, height: totalHeight };
  }

  function rebuildWidget(state, target, entries, opts = {}) {
    const content = opts.content;
    const dropTargets = opts.dropTargets;
    const cardOpts = opts.cardOpts || {};
    clearContent(content, dropTargets);

    let y = 0;
    const count = entries.length;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry?.process || !entry?.processDef) continue;
      const built = buildProcessCard(state, target, entry, i, count, cardOpts);
      built.card.y = y;
      content.addChild(built.card);
      y += built.height + CARD_GAP;
    }
  }

  function buildGrowthEmptyCard(state, target, opts = {}) {
    const card = new PIXI.Container();
    const bg = new PIXI.Graphics();
    card.addChild(bg);

    const totalWidth = CORE_WIDTH;
    const title = `${getTargetLabel(target)} - Growing`;
    const pinned = typeof opts.pinned === "boolean" ? opts.pinned : false;

    const headerUi = createWindowHeader({
      stage: app?.stage,
      parent: card,
      width: totalWidth,
      height: HEADER_HEIGHT,
      radius: CARD_RADIUS,
      background: COLORS.headerBg,
      title,
      titleStyle: { fill: COLORS.headerText, fontSize: 12, fontWeight: "bold" },
      paddingX: HEADER_PAD_X,
      paddingY: HEADER_PAD_Y,
      pinOffsetX: 40,
      closeOffsetX: 20,
      dragTarget: opts.dragTarget,
      onPinToggle: () => opts.onPinToggle?.(null, target),
      onClose: () => opts.onClose?.(null, target),
    });
    headerUi.setPinned(!!pinned);

    const body = new PIXI.Container();
    body.y = HEADER_HEIGHT + 6;
    card.addChild(body);

    const central = new PIXI.Container();
    central.x = 0;
    central.y = BODY_PAD;
    body.addChild(central);

    const moduleCount = 2;
    const moduleWidth = Math.floor(
      (totalWidth - (moduleCount - 1) * MODULE_GAP) / moduleCount
    );

    let moduleX = 0;
    let moduleMaxHeight = 0;

    const progressMod = new PIXI.Container();
    progressMod.x = moduleX;
    progressMod.y = 0;
    central.addChild(progressMod);
    moduleMaxHeight = Math.max(
      moduleMaxHeight,
      buildGrowthProgressModule({
        container: progressMod,
        width: moduleWidth,
        entries: [],
      })
    );
    moduleX += moduleWidth + MODULE_GAP;

    const outputMod = new PIXI.Container();
    outputMod.x = moduleX;
    outputMod.y = 0;
    central.addChild(outputMod);
    moduleMaxHeight = Math.max(
      moduleMaxHeight,
      buildGrowthOutputModule({
        container: outputMod,
        width: moduleWidth,
        pool: target?.systemState?.growth?.maturedPool || null,
      })
    );

    central.height = moduleMaxHeight;

    const bodyContentHeight = Math.max(moduleMaxHeight, 70);
    const bodyHeight = bodyContentHeight + BODY_PAD * 2;

    const centralBg = new PIXI.Graphics();
    centralBg.beginFill(0x000000, 0);
    centralBg.drawRect(0, 0, totalWidth, bodyContentHeight);
    centralBg.endFill();
    central.addChildAt(centralBg, 0);

    const totalHeight = HEADER_HEIGHT + 6 + bodyHeight;
    drawCardBackground(bg, totalWidth, totalHeight);

    return { card, width: totalWidth, height: totalHeight };
  }

  function buildGrowthSignature(state, targetKey, target, entries) {
    const growth = target?.systemState?.growth || {};
    const cropId = growth.selectedCropId || "";
    const pool = growth.maturedPool || {};
    const poolSig = `${
      pool.bronze ?? 0
    }:${pool.silver ?? 0}:${pool.gold ?? 0}:${pool.diamond ?? 0}`;
    const templateSig = buildRoutingTemplateSignature(target, "growth");
    const candidateSig = buildTemplateCandidateSignature(state, target, "growth");
    const baseSig = buildProcessSignature(state, targetKey, target, entries) || "empty";
    return `growth:${targetKey}:${cropId}:${poolSig}:${templateSig}:${candidateSig}:${baseSig}`;
  }

  function rebuildGrowthWidget(state, target, entries, opts = {}) {
    const content = opts.content;
    const dropTargets = opts.dropTargets;
    const cardOpts = opts.cardOpts || {};
    clearContent(content, dropTargets);

    if (!Array.isArray(entries) || entries.length === 0) {
      const templateProcess = getTemplateProcessForSystem(target, "growth", {
        state,
      });
      const templateDef = templateProcess
        ? getProcessDefForInstance(templateProcess, target, {})
        : null;
      if (!templateDef) {
        const built = buildGrowthEmptyCard(state, target, cardOpts);
        built.card.y = 0;
        content.addChild(built.card);
        return;
      }
      const routingState =
        target?.systemState?.growth?.routingTemplate || { inputs: {}, outputs: {} };
      const built = buildProcessCard(
        state,
        target,
        { process: templateProcess, processDef: templateDef },
        0,
        1,
        {
          ...cardOpts,
          groupMode: "growth",
          groupEntries: [],
          routingMode: "template",
          routingState,
          routingProcess: templateProcess,
          routingProcessDef: templateDef,
          routingTargetRef: makeTargetRef(target),
          routingSystemId: "growth",
          drawerKey: `template:growth:${getTargetKey(target) || "target"}`,
          allowBuffer: false,
        }
      );
      built.card.y = 0;
      content.addChild(built.card);
      return;
    }

    const primary = entries[0];
    const built = buildProcessCard(state, target, primary, 0, 1, {
      ...cardOpts,
      groupMode: "growth",
      groupEntries: entries,
    });
    built.card.y = 0;
    content.addChild(built.card);
  }

  function buildBuildSignature(state, targetKey, target, entries) {
    const templateSig = buildRoutingTemplateSignature(target, "build");
    const candidateSig = buildTemplateCandidateSignature(state, target, "build");
    const baseSig = buildProcessSignature(state, targetKey, target, entries) || "empty";
    return `build:${targetKey}:${templateSig}:${candidateSig}:${baseSig}`;
  }

  function rebuildBuildWidget(state, target, entries, opts = {}) {
    const content = opts.content;
    const dropTargets = opts.dropTargets;
    const cardOpts = opts.cardOpts || {};
    clearContent(content, dropTargets);

    if (!Array.isArray(entries) || entries.length === 0) {
      const templateProcess = getTemplateProcessForSystem(target, "build", {
        state,
      });
      const templateDef = templateProcess
        ? getProcessDefForInstance(templateProcess, target, {})
        : null;
      if (!templateDef) return;
      const routingState =
        target?.systemState?.build?.routingTemplate || { inputs: {}, outputs: {} };
      const forceModules = new Set(["requirements", "progress"]);
      const built = buildProcessCard(
        state,
        target,
        { process: templateProcess, processDef: templateDef },
        0,
        1,
        {
          ...cardOpts,
          preview: true,
          forceModules,
          routingMode: "template",
          routingState,
          routingProcess: templateProcess,
          routingProcessDef: templateDef,
          routingTargetRef: makeTargetRef(target),
          routingSystemId: "build",
          drawerKey: `template:build:${getTargetKey(target) || "target"}`,
          allowRouting: true,
          allowBuffer: false,
        }
      );
      built.card.y = 0;
      content.addChild(built.card);
      return;
    }

    rebuildWidget(state, target, entries, {
      content,
      dropTargets,
      cardOpts,
    });
  }

  function buildResidentsSignature(state, targetKey, target, entries) {
    const population = Math.max(
      0,
      Math.floor(state?.resources?.population ?? 0)
    );
    const templateSig = buildRoutingTemplateSignature(target, "residents");
    const candidateSig = buildTemplateCandidateSignature(state, target, "residents");
    const baseSig = buildProcessSignature(state, targetKey, target, entries) || "empty";
    return `residents:${targetKey}:${population}:${templateSig}:${candidateSig}:${baseSig}`;
  }

  function rebuildResidentsWidget(state, target, entries, opts = {}) {
    const content = opts.content;
    const dropTargets = opts.dropTargets;
    const cardOpts = opts.cardOpts || {};
    clearContent(content, dropTargets);

    if (Array.isArray(entries) && entries.length > 0) {
      rebuildWidget(state, target, entries, {
        content,
        dropTargets,
        cardOpts,
      });
      return;
    }

    const templateProcess = getTemplateProcessForSystem(target, "residents", {
      state,
    });
    const templateDef = templateProcess
      ? getProcessDefForInstance(templateProcess, target, {})
      : null;
    if (!templateDef) return;

    const routingState =
      target?.systemState?.residents?.routingTemplate || { inputs: {}, outputs: {} };
    const forceModules = new Set(["requirements", "progress"]);
    const built = buildProcessCard(
      state,
      target,
      { process: templateProcess, processDef: templateDef },
      0,
      1,
      {
        ...cardOpts,
        preview: true,
        forceModules,
        routingMode: "template",
        routingState,
        routingProcess: templateProcess,
        routingProcessDef: templateDef,
        routingTargetRef: makeTargetRef(target),
        routingSystemId: "residents",
        drawerKey: `template:residents:${getTargetKey(target) || "target"}`,
        allowRouting: true,
        allowBuffer: false,
      }
    );
    built.card.y = 0;
    content.addChild(built.card);
  }

  function getDepositPoolTarget(target) {
    if (target?.refKind === "basket") {
      const systemId = "storage";
      const poolKey = "byKindTier";
      const pool = target?.systemState?.storage?.byKindTier ?? null;
      return {
        systemId,
        poolKey,
        pool,
        ownerKind: "pawn",
        ownerId: target?.ownerId ?? null,
      };
    }
    if (!target?.defId) return null;
    const def = hubStructureDefs?.[target.defId];
    const deposit = def?.deposit;
    if (!deposit || typeof deposit !== "object") return null;
    const systemId =
      typeof deposit.systemId === "string" ? deposit.systemId : null;
    if (!systemId) return null;
    const poolKey =
      typeof deposit.poolKey === "string" && deposit.poolKey.length > 0
        ? deposit.poolKey
        : "byKindTier";
    const pool = target?.systemState?.[systemId]?.[poolKey] ?? null;
    return { systemId, poolKey, pool };
  }

  function getWithdrawState(target) {
    const key = getTargetKey(target) || "target";
    if (!withdrawUiStateByTarget.has(key)) {
      withdrawUiStateByTarget.set(key, {
        selectedItemId: null,
        amount: 1,
      });
    }
    return withdrawUiStateByTarget.get(key);
  }

  function canWithdrawFromTarget(target) {
    const info = getDepositPoolTarget(target);
    if (!info) return false;
    return WITHDRAWABLE_POOL_SYSTEM_IDS.has(info.systemId);
  }

  function getPoolItemTotals(pool, itemId) {
    const empty = {
      total: 0,
      byTier: { bronze: 0, silver: 0, gold: 0, diamond: 0 },
    };
    if (!pool || typeof pool !== "object" || !itemId) return empty;
    const bucket = pool[itemId];
    if (!bucket || typeof bucket !== "object") return empty;
    const byTier = {
      bronze: Math.max(0, Math.floor(bucket.bronze ?? 0)),
      silver: Math.max(0, Math.floor(bucket.silver ?? 0)),
      gold: Math.max(0, Math.floor(bucket.gold ?? 0)),
      diamond: Math.max(0, Math.floor(bucket.diamond ?? 0)),
    };
    const total = byTier.bronze + byTier.silver + byTier.gold + byTier.diamond;
    return { total, byTier };
  }

  function getPoolItemOptions(pool) {
    if (!pool || typeof pool !== "object") return [];
    const keys = Object.keys(pool).sort((a, b) => a.localeCompare(b));
    const out = [];
    for (const itemId of keys) {
      const totals = getPoolItemTotals(pool, itemId);
      if (totals.total <= 0) continue;
      const itemName = itemDefs?.[itemId]?.name || itemId;
      out.push({
        value: itemId,
        label: `${itemName} (${totals.total})`,
        detail: `B ${totals.byTier.bronze}  S ${totals.byTier.silver}  G ${totals.byTier.gold}  D ${totals.byTier.diamond}`,
      });
    }
    return out;
  }

  function normalizeWithdrawSelection(withdrawState, options) {
    if (!withdrawState) return null;
    const validIds = new Set((options || []).map((entry) => entry.value));
    if (!withdrawState.selectedItemId || !validIds.has(withdrawState.selectedItemId)) {
      withdrawState.selectedItemId = options?.[0]?.value ?? null;
    }
    if (!Number.isFinite(withdrawState.amount) || withdrawState.amount <= 0) {
      withdrawState.amount = 1;
    }
    return withdrawState.selectedItemId;
  }

  function openSelectionDropdown({
    options,
    selectedValue,
    anchorBounds,
    onSelect,
    width,
  }) {
    selectionDropdown?.show?.({
      options,
      selectedValue,
      anchor: anchorBounds,
      width: Number.isFinite(width) ? width : 210,
      onSelect,
    });
  }

  function openGrowthSelectionDropdown(target, anchorBounds) {
    if (!target) return;
    const growth = target?.systemState?.growth || {};
    const selectedId = growth?.selectedCropId ?? null;
    const envCol = getEnvCol(target);
    const tileDef = target?.defId ? envTileDefs?.[target.defId] : null;
    const tileName =
      tileDef?.name || target?.defId || (Number.isFinite(envCol) ? `Tile ${envCol}` : "Tile");
    openSelectionDropdown({
      options: getCropOptions(),
      selectedValue: selectedId,
      anchorBounds,
      width: 196,
      onSelect: (cropId) => {
        const nextCrop = cropId ?? null;
        const cropName =
          cropId != null ? cropDefs?.[cropId]?.name || cropId : "None";
        const ghostSpec = {
          description: `Crop > ${tileName}: ${cropName}`,
          cost: getTilePlanCost(),
        };
        const run = () => {
          if (!Number.isFinite(envCol)) return { ok: false, reason: "badEnvCol" };
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
        if (typeof queueActionWhenPaused === "function") {
          queueActionWhenPaused(run);
          return;
        }
        run();
      },
    });
  }

  function openRecipeSelectionDropdown(target, systemId, anchorBounds) {
    if (!target || !isRecipeSystem(systemId)) return;
    const selectedId = getSelectedRecipeId(target, systemId);
    const hubCol = getHubCol(target);
    const def = target?.defId ? hubStructureDefs?.[target.defId] : null;
    const hubName = def?.name || target?.defId || (Number.isFinite(hubCol) ? `Hub ${hubCol}` : "Hub");
    openSelectionDropdown({
      options: getRecipeOptions(systemId),
      selectedValue: selectedId,
      anchorBounds,
      width: 232,
      onSelect: (recipeId) => {
        const nextRecipe = recipeId ?? null;
        const recipeName = recipeId
          ? recipeDefs?.[recipeId]?.name || recipeId
          : "None";
        const ghostSpec = {
          description: `Recipe > ${hubName}: ${recipeName}`,
          cost: getHubPlanCost(),
        };
        const run = () => {
          if (!Number.isFinite(hubCol)) return { ok: false, reason: "badHubCol" };
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
        if (typeof queueActionWhenPaused === "function") {
          queueActionWhenPaused(run);
          return;
        }
        run();
      },
    });
  }

  function openWithdrawItemDropdown(target, anchorBounds) {
    const info = getDepositPoolTarget(target);
    if (!info?.pool || typeof info.pool !== "object") return;
    const options = getPoolItemOptions(info.pool);
    const withdrawState = getWithdrawState(target);
    const selectedId = normalizeWithdrawSelection(withdrawState, options);
    openSelectionDropdown({
      options,
      selectedValue: selectedId,
      anchorBounds,
      width: 212,
      onSelect: (itemId) => {
        withdrawState.selectedItemId = itemId ?? null;
        withdrawState.amount = 1;
        invalidateAllSignatures();
      },
    });
  }

  function requestPoolWithdraw(target, itemId, amount) {
    if (!target || !itemId) return;
    queueActionWhenPaused?.(() => {
      if (target?.refKind === "basket") {
        const result = dispatchAction?.(
          ActionKinds.WITHDRAW_PAWN_BASKET_POOL_ITEM,
          {
            ownerId: target?.ownerId ?? null,
            itemId,
            amount,
            slotId: target?.basketSlotId ?? null,
          },
          { apCost: 0 }
        );
        if (!result?.ok) {
          if (target?.ownerId != null) {
            inventoryView?.flashWindowError?.(target.ownerId);
          }
          return result;
        }
        const ownerId = result.ownerId ?? target?.ownerId ?? null;
        if (ownerId != null) {
          inventoryView?.revealWindow?.(ownerId, { pinned: true });
          inventoryView?.rebuildWindow?.(ownerId);
        }
        if (
          ownerId != null &&
          result.spawnItemId != null &&
          typeof inventoryView?.beginDragItemFromOwner === "function"
        ) {
          inventoryView.beginDragItemFromOwner(ownerId, result.spawnItemId, {
            pinned: true,
          });
        }
        return result;
      }

      const hubCol = getHubCol(target);
      if (!Number.isFinite(hubCol)) return { ok: false, reason: "badHubCol" };
      const result = dispatchAction?.(
        ActionKinds.WITHDRAW_HUB_POOL_ITEM,
        {
          hubCol,
          itemId,
          amount,
        },
        { apCost: 0 }
      );
      if (!result?.ok) {
        inventoryView?.flashWindowError?.(target.instanceId);
        return result;
      }
      const ownerId = result.ownerId ?? target.instanceId;
      if (ownerId != null) {
        inventoryView?.revealWindow?.(ownerId, { pinned: true });
        inventoryView?.rebuildWindow?.(ownerId);
      }
      if (
        ownerId != null &&
        result.spawnItemId != null &&
        typeof inventoryView?.beginDragItemFromOwner === "function"
      ) {
        inventoryView.beginDragItemFromOwner(ownerId, result.spawnItemId, {
          pinned: true,
        });
      }
      return result;
    });
  }

  function buildPoolSignature(pool) {
    if (!pool || typeof pool !== "object") return "none";
    if (
      pool.bronze != null ||
      pool.silver != null ||
      pool.gold != null ||
      pool.diamond != null
    ) {
      return `${pool.bronze ?? 0}:${pool.silver ?? 0}:${pool.gold ?? 0}:${
        pool.diamond ?? 0
      }`;
    }
    const keys = Object.keys(pool).sort((a, b) => a.localeCompare(b));
    const parts = [];
    for (const key of keys) {
      const bucket = pool[key];
      if (!bucket || typeof bucket !== "object") continue;
      const b = Math.max(0, Math.floor(bucket.bronze ?? 0));
      const s = Math.max(0, Math.floor(bucket.silver ?? 0));
      const g = Math.max(0, Math.floor(bucket.gold ?? 0));
      const d = Math.max(0, Math.floor(bucket.diamond ?? 0));
      parts.push(`${key}:${b},${s},${g},${d}`);
    }
    return parts.length ? parts.join("|") : "empty";
  }

  function buildDepositEmptyCard(state, target, opts = {}) {
    const card = new PIXI.Container();
    const bg = new PIXI.Graphics();
    card.addChild(bg);

    const totalWidth = CORE_WIDTH;
    const title = `${getTargetLabel(target)} - Depositing`;
    const pinned = typeof opts.pinned === "boolean" ? opts.pinned : false;

    const headerUi = createWindowHeader({
      stage: app?.stage,
      parent: card,
      width: totalWidth,
      height: HEADER_HEIGHT,
      radius: CARD_RADIUS,
      background: COLORS.headerBg,
      title,
      titleStyle: { fill: COLORS.headerText, fontSize: 12, fontWeight: "bold" },
      paddingX: HEADER_PAD_X,
      paddingY: HEADER_PAD_Y,
      pinOffsetX: 40,
      closeOffsetX: 20,
      dragTarget: opts.dragTarget,
      onPinToggle: () => opts.onPinToggle?.(null, target),
      onClose: () => opts.onClose?.(null, target),
    });
    headerUi.setPinned(!!pinned);

    const body = new PIXI.Container();
    body.y = HEADER_HEIGHT + 6;
    card.addChild(body);

    const central = new PIXI.Container();
    central.x = 0;
    central.y = BODY_PAD;
    body.addChild(central);

    const moduleCount = 2;
    const moduleWidth = Math.floor(
      (totalWidth - (moduleCount - 1) * MODULE_GAP) / moduleCount
    );

    let moduleX = 0;
    let moduleMaxHeight = 0;

    const prestigeMod = new PIXI.Container();
    prestigeMod.x = moduleX;
    prestigeMod.y = 0;
    central.addChild(prestigeMod);
    moduleMaxHeight = Math.max(
      moduleMaxHeight,
      buildPrestigeModule({
        container: prestigeMod,
        width: moduleWidth,
        process: {},
      })
    );
    moduleX += moduleWidth + MODULE_GAP;

    const outputMod = new PIXI.Container();
    outputMod.x = moduleX;
    outputMod.y = 0;
    central.addChild(outputMod);
    const depositInfo = getDepositPoolTarget(target);
    const canWithdraw = canWithdrawFromTarget(target);
    if (canWithdraw) {
      const withdrawState = getWithdrawState(target);
      moduleMaxHeight = Math.max(
        moduleMaxHeight,
        buildWithdrawModule({
          container: outputMod,
          width: moduleWidth,
          pool: depositInfo?.pool ?? null,
          withdrawState,
          onOpenItemDropdown: (bounds) => openWithdrawItemDropdown(target, bounds),
          onWithdraw: (itemId, qty) => requestPoolWithdraw(target, itemId, qty),
        })
      );
    } else {
      const poolSummary = formatPoolSummary({
        kind: "pool",
        target: depositInfo?.pool ?? null,
      });
      moduleMaxHeight = Math.max(
        moduleMaxHeight,
        buildOutputModule({
          container: outputMod,
          width: moduleWidth,
          outputs: [{ kind: "pool", fromLedger: true }],
          poolSummary,
        })
      );
    }

    central.height = moduleMaxHeight;

    const bodyContentHeight = Math.max(moduleMaxHeight, 70);
    const bodyHeight = bodyContentHeight + BODY_PAD * 2;

    const centralBg = new PIXI.Graphics();
    centralBg.beginFill(0x000000, 0);
    centralBg.drawRect(0, 0, totalWidth, bodyContentHeight);
    centralBg.endFill();
    central.addChildAt(centralBg, 0);

    const totalHeight = HEADER_HEIGHT + 6 + bodyHeight;
    drawCardBackground(bg, totalWidth, totalHeight);

    return { card, width: totalWidth, height: totalHeight };
  }

  function rebuildDepositWidget(state, target, entries, opts = {}) {
    const content = opts.content;
    const dropTargets = opts.dropTargets;
    const cardOpts = opts.cardOpts || {};
    clearContent(content, dropTargets);

    if (!Array.isArray(entries) || entries.length === 0) {
      const built = buildDepositEmptyCard(state, target, cardOpts);
      built.card.y = 0;
      content.addChild(built.card);
      return;
    }

    rebuildWidget(state, target, entries, {
      content,
      dropTargets,
      cardOpts,
    });
  }

  function buildDepositSignature(state, targetKey, target, entries) {
    const depositInfo = getDepositPoolTarget(target);
    const poolSig = buildPoolSignature(depositInfo?.pool);
    const templateSig = buildRoutingTemplateSignature(target, "deposit");
    const baseSig = buildProcessSignature(state, targetKey, target, entries) || "empty";
    return `deposit:${targetKey}:${poolSig}:${templateSig}:${baseSig}`;
  }

  function buildBasketCard(state, target, opts = {}) {
    const card = new PIXI.Container();
    const bg = new PIXI.Graphics();
    card.addChild(bg);

    const totalWidth = CORE_WIDTH;
    const ownerLabel = target?.basketOwnerName || "Basket";
    const title = `${ownerLabel} - Basket`;
    const pinned = typeof opts.pinned === "boolean" ? opts.pinned : false;

    const headerUi = createWindowHeader({
      stage: app?.stage,
      parent: card,
      width: totalWidth,
      height: HEADER_HEIGHT,
      radius: CARD_RADIUS,
      background: COLORS.headerBg,
      title,
      titleStyle: { fill: COLORS.headerText, fontSize: 12, fontWeight: "bold" },
      paddingX: HEADER_PAD_X,
      paddingY: HEADER_PAD_Y,
      pinOffsetX: 40,
      closeOffsetX: 20,
      dragTarget: opts.dragTarget,
      onPinToggle: () => opts.onPinToggle?.(null, target),
      onClose: () => opts.onClose?.(null, target),
    });
    headerUi.setPinned(!!pinned);

    const body = new PIXI.Container();
    body.y = HEADER_HEIGHT + 6;
    card.addChild(body);

    const central = new PIXI.Container();
    central.x = 0;
    central.y = BODY_PAD;
    body.addChild(central);

    const moduleCount = 2;
    const moduleWidth = Math.floor(
      (totalWidth - (moduleCount - 1) * MODULE_GAP) / moduleCount
    );

    let moduleX = 0;
    let moduleMaxHeight = 0;

    const storageMod = new PIXI.Container();
    storageMod.x = moduleX;
    storageMod.y = 0;
    central.addChild(storageMod);
    const depositInfo = getDepositPoolTarget(target);
    const poolSummary = formatPoolSummary({
      kind: "pool",
      target: depositInfo?.pool ?? null,
    });
    moduleMaxHeight = Math.max(
      moduleMaxHeight,
      buildOutputModule({
        container: storageMod,
        width: moduleWidth,
        outputs: [{ kind: "pool", fromLedger: true }],
        poolSummary,
      })
    );
    moduleX += moduleWidth + MODULE_GAP;

    const withdrawMod = new PIXI.Container();
    withdrawMod.x = moduleX;
    withdrawMod.y = 0;
    central.addChild(withdrawMod);
    const withdrawState = getWithdrawState(target);
    moduleMaxHeight = Math.max(
      moduleMaxHeight,
      buildWithdrawModule({
        container: withdrawMod,
        width: moduleWidth,
        pool: depositInfo?.pool ?? null,
        withdrawState,
        onOpenItemDropdown: (bounds) => openWithdrawItemDropdown(target, bounds),
        onWithdraw: (itemId, qty) => requestPoolWithdraw(target, itemId, qty),
      })
    );

    central.height = moduleMaxHeight;

    const bodyContentHeight = Math.max(moduleMaxHeight, 70);
    const bodyHeight = bodyContentHeight + BODY_PAD * 2;

    const centralBg = new PIXI.Graphics();
    centralBg.beginFill(0x000000, 0);
    centralBg.drawRect(0, 0, totalWidth, bodyContentHeight);
    centralBg.endFill();
    central.addChildAt(centralBg, 0);

    const totalHeight = HEADER_HEIGHT + 6 + bodyHeight;
    drawCardBackground(bg, totalWidth, totalHeight);

    return { card, width: totalWidth, height: totalHeight };
  }

  function rebuildBasketWidget(state, target, opts = {}) {
    const content = opts.content;
    const dropTargets = opts.dropTargets;
    const cardOpts = opts.cardOpts || {};
    clearContent(content, dropTargets);

    const built = buildBasketCard(state, target, cardOpts);
    built.card.y = 0;
    content.addChild(built.card);
  }

  function buildBasketSignature(state, targetKey, target) {
    const depositInfo = getDepositPoolTarget(target);
    const poolSig = buildPoolSignature(depositInfo?.pool);
    const itemSig = target?.basketItemId != null ? String(target.basketItemId) : "none";
    return `basket:${targetKey}:${itemSig}:${poolSig}`;
  }

  function getSelectedRecipeId(target, systemId) {
    if (!target || !systemId) return null;
    const sys = target.systemState?.[systemId];
    const selected = sys?.selectedRecipeId ?? null;
    return typeof selected === "string" && selected.length > 0 ? selected : null;
  }

  function buildRecipePreviewEntry(target, systemId, recipeId) {
    if (!recipeId) return null;
    const recipe = recipeDefs?.[recipeId] || null;
    if (!recipe) return null;
    const targetKey = getTargetKey(target) || "target";
    const mode = "work";
    const durationSec = Number.isFinite(recipe.durationSec)
      ? Math.max(1, Math.floor(recipe.durationSec))
      : 1;
    const process = {
      id: `preview:${systemId}:${targetKey}:${recipeId}`,
      type: recipeId,
      mode,
      durationSec,
      progress: 0,
      ownerId: target?.instanceId ?? null,
    };
    const processDef = getProcessDefForInstance(process, target, {
      leaderId: process?.leaderId ?? null,
    });
    if (!processDef) return null;
    return { process, processDef, preview: true };
  }

  function buildIdleProcessDef(systemId) {
    return {
      processKind: "idle",
      displayName: systemId === "workspace" ? "Crafting" : "Cooking",
      transform: {
        mode: "work",
        durationSec: 1,
        requirements: [],
        outputs: [],
        completionPolicy: "none",
      },
      routingSlots: { inputs: [], outputs: [] },
      supportsDropslot: false,
    };
  }

  function rebuildRecipeSystemWidget(state, target, systemId, entries, opts = {}) {
    const content = opts.content;
    const dropTargets = opts.dropTargets;
    const cardOpts = opts.cardOpts || {};
    clearContent(content, dropTargets);

    const recipeId = getSelectedRecipeId(target, systemId);
    if (Array.isArray(entries) && entries.length > 0) {
      rebuildWidget(state, target, entries, {
        content,
        dropTargets,
        cardOpts,
      });
      return;
    }

    if (recipeId) {
      const previewEntry = buildRecipePreviewEntry(target, systemId, recipeId);
      if (previewEntry) {
        const forceModules = new Set(["requirements", "progress", "output"]);
        const routingState =
          target?.systemState?.[systemId]?.routingTemplate || { inputs: {}, outputs: {} };
        const built = buildProcessCard(state, target, previewEntry, 0, 1, {
          ...cardOpts,
          preview: true,
          forceModules,
          routingMode: "template",
          routingState,
          routingProcess: previewEntry.process,
          routingProcessDef: previewEntry.processDef,
          routingTargetRef: makeTargetRef(target),
          routingSystemId: systemId,
          drawerKey: `template:${systemId}:${getTargetKey(target) || "target"}`,
          allowRouting: true,
          allowBuffer: false,
        });
        built.card.y = 0;
        content.addChild(built.card);
        return;
      }
    }

    const targetKey = getTargetKey(target) || "target";
    const process = {
      id: `idle:${systemId}:${targetKey}`,
      type: `${systemId}-idle`,
      mode: "work",
      durationSec: 1,
      progress: 0,
      ownerId: target?.instanceId ?? null,
    };
    const processDef = buildIdleProcessDef(systemId);
    const templateProcess = getTemplateProcessForSystem(target, systemId, {
      state,
    });
    const templateDef = templateProcess
      ? getProcessDefForInstance(templateProcess, target, {})
      : processDef;
    const routingState =
      target?.systemState?.[systemId]?.routingTemplate || { inputs: {}, outputs: {} };
    const forceModules = new Set(["requirements", "progress", "output"]);
    const variantOverride = systemId === "workspace" ? "crafting" : "cooking";
    const built = buildProcessCard(
      state,
      target,
      { process, processDef },
      0,
      1,
      {
        ...cardOpts,
        preview: true,
        forceModules,
        variantOverride,
        routingMode: "template",
        routingState,
        routingProcess: templateProcess || process,
        routingProcessDef: templateDef,
        routingTargetRef: makeTargetRef(target),
        routingSystemId: systemId,
        drawerKey: `template:${systemId}:${targetKey}`,
        allowRouting: true,
        allowBuffer: false,
      }
    );
    built.card.y = 0;
    content.addChild(built.card);
  }

  function buildRecipeSystemSignature(state, targetKey, target, entries, systemId) {
    const recipeId = getSelectedRecipeId(target, systemId) || "none";
    const templateSig = buildRoutingTemplateSignature(target, systemId);
    const candidateSig = buildTemplateCandidateSignature(state, target, systemId);
    const baseSig = buildProcessSignature(state, targetKey, target, entries) || "empty";
    return `recipe:${systemId}:${targetKey}:${recipeId}:${templateSig}:${candidateSig}:${baseSig}`;
  }

  function collectProcessEntries(state, target, systemIdFilter) {
    const processes = collectProcesses(target);
    const filtered = systemIdFilter
      ? processes.filter((entry) => entry.systemId === systemIdFilter)
      : processes;
    return filtered
      .map((entry) => {
        const processDef = getProcessDefForInstance(
          entry.process,
          target,
          { leaderId: entry.process?.leaderId ?? null }
        );
        return { ...entry, processDef };
      })
      .filter((entry) => entry.processDef);
  }

  function findProcessEntryById(target, processId) {
    if (!target || !processId) return null;
    const processes = collectProcesses(target);
    for (const entry of processes) {
      if (entry?.process?.id === processId) return entry;
    }
    return null;
  }

  function positionWindow(win, origin, offsetIndex, force = false) {
    if (!win || (!force && win.hasPosition)) return;
    const baseX = Number.isFinite(origin?.x) ? origin.x : position.x;
    const baseY = Number.isFinite(origin?.y) ? origin.y : position.y;
    const idx = Number.isFinite(offsetIndex) ? Math.max(0, Math.floor(offsetIndex)) : 0;
    const offset = 24 * idx;
    win.container.x = baseX + offset;
    win.container.y = baseY + offset;
    win.hasPosition = true;
  }

  function positionWindowAtAnchor(win) {
    if (!win || !win.anchorRect || win.hasPosition) return;
    const bounds = win.container?.getLocalBounds?.() ?? null;
    const width = Math.max(1, Math.floor(bounds?.width ?? CORE_WIDTH));
    const height = Math.max(1, Math.floor(bounds?.height ?? 140));
    const idx = Number.isFinite(win.offsetIndex)
      ? Math.max(0, Math.floor(win.offsetIndex))
      : 0;
    const offset = 24 * idx;

    let x = win.anchorRect.x + win.anchorRect.width / 2 - width / 2;
    let y = win.anchorRect.y + win.anchorRect.height + 12;
    x += offset;
    y += offset;

    const screen = getScreenSize();
    const maxX = Math.max(8, screen.width - width - 8);
    const maxY = Math.max(8, screen.height - height - 8);
    x = Math.max(8, Math.min(maxX, x));
    y = Math.max(8, Math.min(maxY, y));

    win.container.x = Math.round(x);
    win.container.y = Math.round(y);
    win.hasPosition = true;
  }

  function ensureWindow(windowId, target, systemId, origin, offsetIndex, opts = {}) {
    if (!windowId) return null;
    const targetRef = makeTargetRef(target);
    let win = windows.get(windowId);
    if (win) {
      if (targetRef) win.targetRef = targetRef;
      if (systemId != null) win.systemId = systemId;
      if (opts.groupKind) win.groupKind = opts.groupKind;
      return win;
    }

    const container = new PIXI.Container();
    container.zIndex = 130;
    layer.addChild(container);

    const content = new PIXI.Container();
    container.addChild(content);

    win = {
      windowId,
      processId: opts.processId || null,
      group: opts.group === true,
      groupKind: opts.groupKind || null,
      targetRef,
      systemId: systemId || null,
      container,
      content,
      dropTargets: [],
      lastSignature: null,
      pinned: false,
      hovered: false,
      externalFocused: false,
      hasPosition: false,
      anchorRect: getTargetAnchorRect(target),
      offsetIndex: Number.isFinite(offsetIndex) ? Math.floor(offsetIndex) : 0,
    };
    windows.set(windowId, win);
    if (!win.anchorRect) {
      positionWindow(win, origin, offsetIndex, true);
    } else {
      win.container.x = win.anchorRect.x;
      win.container.y = win.anchorRect.y + win.anchorRect.height + 12;
    }
    return win;
  }

  function hideWindow(windowId) {
    const win = windows.get(windowId);
    if (!win) return;
    win.pinned = false;
    win.hovered = false;
    if (win.container) win.container.visible = false;
  }

  function destroyWindow(windowId) {
    const win = windows.get(windowId);
    if (!win) return;
    win.container?.parent?.removeChild?.(win.container);
    win.container?.destroy?.({ children: true });
    windows.delete(windowId);
  }

  function setWindowPinned(windowId, pinned) {
    const win = windows.get(windowId);
    if (!win) return;
    win.pinned = !!pinned;
    if (!win.pinned && !win.hovered && !win.externalFocused) {
      win.container.visible = false;
    } else {
      win.container.visible = true;
    }
    win.lastSignature = null;
  }

  function togglePinnedWindow(windowId) {
    const win = windows.get(windowId);
    if (!win) return;
    setWindowPinned(windowId, !win.pinned);
  }

  function collectContextWindows(state, context, idSet, flagKey) {
    if (!context?.targetRef) return;
    const target = resolveTargetFromRef(state, context.targetRef);
    if (!target) return;

    if (isGroupedSystem(context.systemId)) {
      const windowId = `group:${context.systemId}:${getTargetKey(target)}`;
      const win = ensureWindow(
        windowId,
        target,
        context.systemId,
        { x: position.x, y: position.y },
        0,
        { group: true, groupKind: context.systemId }
      );
      win[flagKey] = true;
      idSet.add(windowId);
      if (!win.pinned) win.container.visible = true;
      return;
    }

    const entries = collectProcessEntries(state, target, context.systemId);
    let offsetIndex = 0;
    for (const entry of entries) {
      const processId = entry?.process?.id;
      if (!processId) continue;
      const win = ensureWindow(
        processId,
        target,
        context.systemId,
        { x: position.x, y: position.y },
        offsetIndex,
        { processId }
      );
      win[flagKey] = true;
      idSet.add(processId);
      if (!win.pinned) {
        win.container.visible = true;
      }
      offsetIndex += 1;
    }
  }

  function updateHoverWindows(state) {
    const hoverIds = new Set();
    const externalIds = new Set();
    collectContextWindows(state, hoverContext, hoverIds, "hovered");
    collectContextWindows(
      state,
      externalFocusContext,
      externalIds,
      "externalFocused"
    );

    const externalActive = !!externalFocusContext?.targetRef;
    for (const [windowId, win] of windows.entries()) {
      if (win.hovered && !hoverIds.has(windowId)) {
        win.hovered = false;
      }
      if (win.externalFocused && !externalIds.has(windowId)) {
        win.externalFocused = false;
      }

      if (externalActive) {
        win.container.visible = externalIds.has(windowId);
        continue;
      }

      if (!win.pinned && !win.hovered && !win.externalFocused) {
        win.container.visible = false;
      }
    }
  }

  function update() {
    const state = getStateSafe();
    if (!state) {
      for (const win of windows.values()) {
        if (win?.container) win.container.visible = false;
      }
      return;
    }

    updateHoverWindows(state);
    const externalActive = !!externalFocusContext?.targetRef;

    for (const [windowId, win] of windows.entries()) {
      const target = resolveTargetFromRef(state, win.targetRef);
      if (!target) {
        destroyWindow(windowId);
        continue;
      }
      if (win.group) {
        const entries = collectProcessEntries(state, target, win.systemId);
        const visible = externalActive
          ? !!win.externalFocused
          : !!win.pinned || !!win.hovered;
        if (!visible) {
          win.container.visible = false;
          continue;
        }

        const signatureKey = `${windowId}|${getTargetKey(target)}`;
        let signature = null;
        if (win.groupKind === "growth") {
          signature = buildGrowthSignature(state, signatureKey, target, entries);
        } else if (win.groupKind === "build") {
          signature = buildBuildSignature(state, signatureKey, target, entries);
        } else if (win.groupKind === "residents") {
          signature = buildResidentsSignature(state, signatureKey, target, entries);
        } else if (win.groupKind === "deposit") {
          signature = buildDepositSignature(state, signatureKey, target, entries);
        } else if (win.groupKind === "basket") {
          signature = buildBasketSignature(state, signatureKey, target);
        } else if (isRecipeSystem(win.groupKind)) {
          signature = buildRecipeSystemSignature(
            state,
            signatureKey,
            target,
            entries,
            win.groupKind
          );
        } else {
          signature = buildProcessSignature(state, signatureKey, target, entries);
        }

        if (signature !== win.lastSignature) {
          win.lastSignature = signature;
          if (win.groupKind === "growth") {
            rebuildGrowthWidget(state, target, entries, {
              content: win.content,
              dropTargets: win.dropTargets,
              cardOpts: {
                dragTarget: win.container,
                pinned: win.pinned,
                onPinToggle: () => togglePinnedWindow(windowId),
                onClose: () => hideWindow(windowId),
              },
            });
          } else if (win.groupKind === "build") {
            rebuildBuildWidget(state, target, entries, {
              content: win.content,
              dropTargets: win.dropTargets,
              cardOpts: {
                dragTarget: win.container,
                pinned: win.pinned,
                onPinToggle: () => togglePinnedWindow(windowId),
                onClose: () => hideWindow(windowId),
              },
            });
          } else if (win.groupKind === "residents") {
            rebuildResidentsWidget(state, target, entries, {
              content: win.content,
              dropTargets: win.dropTargets,
              cardOpts: {
                dragTarget: win.container,
                pinned: win.pinned,
                onPinToggle: () => togglePinnedWindow(windowId),
                onClose: () => hideWindow(windowId),
              },
            });
          } else if (win.groupKind === "deposit") {
            rebuildDepositWidget(state, target, entries, {
              content: win.content,
              dropTargets: win.dropTargets,
              cardOpts: {
                dragTarget: win.container,
                pinned: win.pinned,
                onPinToggle: () => togglePinnedWindow(windowId),
                onClose: () => hideWindow(windowId),
              },
            });
          } else if (win.groupKind === "basket") {
            rebuildBasketWidget(state, target, {
              content: win.content,
              dropTargets: win.dropTargets,
              cardOpts: {
                dragTarget: win.container,
                pinned: win.pinned,
                onPinToggle: () => togglePinnedWindow(windowId),
                onClose: () => hideWindow(windowId),
              },
            });
          } else if (isRecipeSystem(win.groupKind)) {
            rebuildRecipeSystemWidget(state, target, win.groupKind, entries, {
              content: win.content,
              dropTargets: win.dropTargets,
              cardOpts: {
                dragTarget: win.container,
                pinned: win.pinned,
                onPinToggle: () => togglePinnedWindow(windowId),
                onClose: () => hideWindow(windowId),
              },
            });
          } else {
            rebuildWidget(state, target, entries, {
              content: win.content,
              dropTargets: win.dropTargets,
              cardOpts: {
                dragTarget: win.container,
                pinned: win.pinned,
                onPinToggle: () => togglePinnedWindow(windowId),
                onClose: () => hideWindow(windowId),
              },
            });
          }
        }
        positionWindowAtAnchor(win);
        win.container.visible = true;
        continue;
      }

      const entry = findProcessEntryById(target, win.processId || windowId);
      if (!entry) {
        destroyWindow(windowId);
        continue;
      }
      const processDef = getProcessDefForInstance(
        entry.process,
        target,
        { leaderId: entry.process?.leaderId ?? null }
      );
      if (!processDef) {
        destroyWindow(windowId);
        continue;
      }

      const visible = externalActive
        ? !!win.externalFocused
        : !!win.pinned || !!win.hovered;
      if (!visible) {
        win.container.visible = false;
        continue;
      }

      const entries = [{ ...entry, processDef }];
      const signatureKey = `${windowId}|${getTargetKey(target)}`;
      const signature = buildProcessSignature(state, signatureKey, target, entries);
      if (signature !== win.lastSignature) {
        win.lastSignature = signature;
        rebuildWidget(state, target, entries, {
          content: win.content,
          dropTargets: win.dropTargets,
          cardOpts: {
            dragTarget: win.container,
            pinned: win.pinned,
            onPinToggle: () => togglePinnedWindow(windowId),
            onClose: () => hideWindow(windowId),
          },
        });
      }
      positionWindowAtAnchor(win);
      win.container.visible = true;
    }
  }

  function getDropTargetOwnerAtGlobalPos(globalPos) {
    if (!globalPos) return null;
    for (const win of windows.values()) {
      if (!win?.container?.visible) continue;
      for (const target of win.dropTargets || []) {
        if (!target || !target.getBounds) continue;
        const bounds = target.getBounds();
        if (
          globalPos.x >= bounds.x &&
          globalPos.x <= bounds.x + bounds.width &&
          globalPos.y >= bounds.y &&
          globalPos.y <= bounds.y + bounds.height
        ) {
          return target.ownerId;
        }
      }
    }
    return null;
  }

  function setHoverTarget(target, systemId) {
    hoverContext = target
      ? { targetRef: makeTargetRef(target), systemId: systemId || null }
      : null;
    invalidateAllSignatures();
  }

  function clearHoverTarget() {
    hoverContext = null;
    for (const win of windows.values()) {
      if (!win.hovered) continue;
      win.hovered = false;
      if (!win.pinned && !win.externalFocused) win.container.visible = false;
    }
    invalidateAllSignatures();
  }

  function setExternalFocusTarget(target, systemId) {
    externalFocusContext = target
      ? { targetRef: makeTargetRef(target), systemId: systemId || null }
      : null;
    invalidateAllSignatures();
  }

  function clearExternalFocusTarget() {
    externalFocusContext = null;
    for (const win of windows.values()) {
      if (!win.externalFocused) continue;
      win.externalFocused = false;
      if (!win.pinned && !win.hovered) win.container.visible = false;
    }
    invalidateAllSignatures();
  }

  function togglePinnedTarget(target, systemId) {
    const state = getStateSafe();
    if (!state || !target) return;
    if (isGroupedSystem(systemId)) {
      const windowId = `group:${systemId}:${getTargetKey(target)}`;
      const win = ensureWindow(
        windowId,
        target,
        systemId,
        { x: position.x, y: position.y },
        0,
        { group: true, groupKind: systemId }
      );
      const nextPinned = !win?.pinned;
      setWindowPinned(windowId, nextPinned);
      return;
    }

    const entries = collectProcessEntries(state, target, systemId);
    if (entries.length === 0) return;
    const ids = entries
      .map((entry) => entry?.process?.id)
      .filter((id) => !!id);
    if (ids.length === 0) return;
    const anyUnpinned = ids.some((id) => !windows.get(id)?.pinned);
    let offsetIndex = 0;
    for (const entry of entries) {
      const processId = entry?.process?.id;
      if (!processId) continue;
      ensureWindow(
        processId,
        target,
        systemId,
        { x: position.x, y: position.y },
        offsetIndex,
        { processId }
      );
      if (anyUnpinned) {
        setWindowPinned(processId, true);
      } else {
        setWindowPinned(processId, false);
      }
      offsetIndex += 1;
    }
  }

  function showBasketWidgetForOwner(ownerId) {
    const state = getStateSafe();
    if (!state || ownerId == null) return { ok: false, reason: "badOwner" };
    const target = buildBasketTarget(state, ownerId);
    if (!target) return { ok: false, reason: "noEquippedBasket" };
    const windowId = `group:basket:${String(ownerId)}`;
    const win = ensureWindow(
      windowId,
      target,
      "basket",
      { x: position.x, y: position.y },
      0,
      { group: true, groupKind: "basket" }
    );
    if (win?.container?.parent) {
      win.container.parent.addChild(win.container);
    }
    positionBasketWindowNearInventory(win, ownerId);
    setWindowPinned(windowId, true);
    invalidateAllSignatures();
    return { ok: true, windowId };
  }

  function getInventoryWindowForOwner(ownerId) {
    const map = inventoryView?.windows;
    if (!map || typeof map.get !== "function") return null;
    const direct = map.get(ownerId);
    if (direct) return direct;
    if (ownerId == null || typeof map.entries !== "function") return null;
    const ownerKey = String(ownerId);
    for (const [key, value] of map.entries()) {
      if (String(key) === ownerKey) return value;
    }
    return null;
  }

  function positionBasketWindowNearInventory(win, ownerId) {
    if (!win?.container) return false;
    const invWin = getInventoryWindowForOwner(ownerId);
    const invContainer = invWin?.container;
    if (!invContainer || typeof invContainer.getBounds !== "function") return false;

    const invBounds = invContainer.getBounds();
    if (!invBounds) return false;

    const localBounds = win.container.getLocalBounds?.() ?? null;
    const width = Math.max(1, Math.floor(localBounds?.width ?? CORE_WIDTH));
    const height = Math.max(1, Math.floor(localBounds?.height ?? 140));
    const gap = 12;

    let x = invBounds.x + invBounds.width + gap;
    let y = invBounds.y;

    const screen = getScreenSize();
    const maxX = Math.max(8, screen.width - width - 8);
    const maxY = Math.max(8, screen.height - height - 8);

    if (x > maxX) {
      x = invBounds.x - width - gap;
    }

    x = Math.max(8, Math.min(maxX, x));
    y = Math.max(8, Math.min(maxY, y));

    win.container.x = Math.round(x);
    win.container.y = Math.round(y);
    win.hasPosition = true;
    return true;
  }

  function init() {}

  return {
    init,
    update,
    getDropTargetOwnerAtGlobalPos,
    setHoverTarget,
    clearHoverTarget,
    togglePinnedTarget,
    setExternalFocusTarget,
    clearExternalFocusTarget,
    showBasketWidgetForOwner,
  };
}

function createSelectionDropdown(layer, app) {
  if (!layer || !app?.stage) return null;
  const container = new PIXI.Container();
  container.visible = false;
  container.zIndex = 180;
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
    bg.beginFill(selected ? 0x303a55 : 0x1f263d, 0.95);
    bg.drawRoundedRect(0, 0, width, rowHeight, 6);
    bg.endFill();
    row.addChild(bg);

    const name = new PIXI.Text(String(entry?.label ?? entry?.value ?? ""), {
      fill: 0xffffff,
      fontSize: 11,
      fontWeight: "bold",
    });
    name.x = 8;
    name.y = 4;
    row.addChild(name);

    if (hasDetail) {
      const detail = new PIXI.Text(String(entry.detail), {
        fill: 0xc7d2ee,
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
    // controlsLayer does not sort children by zIndex; ensure dropdown is topmost.
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
    bg.beginFill(0x141b2b, 0.96);
    bg.drawRoundedRect(0, 0, safeWidth, height, 8);
    bg.endFill();
    container.setChildIndex(bg, 0);
    container.hitArea = new PIXI.Rectangle(0, 0, safeWidth, height);

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

  return {
    show,
    hide,
  };
}
