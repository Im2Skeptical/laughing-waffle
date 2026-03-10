// hub-tag-ui.js
// Tag UI helpers for hub structures.

import { hubTagDefs } from "../../defs/gamesystems/hub-tag-defs.js";
import { hubSystemDefs } from "../../defs/gamesystems/hub-system-defs.js";
import { hubStructureDefs } from "../../defs/gamepieces/hub-structure-defs.js";
import { recipeDefs } from "../../defs/gamepieces/recipes-defs.js";
import { itemDefs } from "../../defs/gamepieces/item-defs.js";
import { itemTagDefs } from "../../defs/gamesystems/item-tag-defs.js";
import { FAITH_GROWTH_STREAK_FOR_UPGRADE } from "../../defs/gamesettings/gamerules-defs.js";
import { TIER_ASC } from "../../model/effects/core/tiers.js";
import { hasHubTagUnlock } from "../../model/skills.js";
import {
  buildRecipePriorityFromSelectedRecipe,
  getEnabledRecipeIds,
  getTopEnabledRecipeId,
  normalizeRecipePriority,
} from "../../model/recipe-priority.js";
import { getProcessDefForInstance } from "../../model/process-framework.js";
import { evaluateProcessRequirementAvailability } from "../../model/process-requirement-availability.js";
import { isTagHidden } from "../../model/tag-state.js";
import { getDisplayObjectWorldScale } from "../ui-helpers/display-object-scale.js";
import { MUCHA_UI_COLORS } from "../ui-helpers/mucha-ui-palette.js";
import { applyTextResolution } from "../ui-helpers/text-resolution.js";

const TAG_PILL_HEIGHT = 20;
const TAG_PILL_RADIUS = 10;
const TAG_PILL_PAD_X = 8;
const TAG_PILL_GAP = 6;
const TAG_PILL_MAX_WIDTH = 90;
const TAG_PILL_WIDTH = TAG_PILL_MAX_WIDTH;
const TAG_ACTION_SIZE = 12;
const TAG_ACTION_PAD = 6;
const TAG_LABEL_X = TAG_PILL_PAD_X;
const TAG_ROW_SCALE_ACTIVE = 1.05;
const TAG_PILL_BG_ACTIVE = MUCHA_UI_COLORS.surfaces.panelSoft;
const TAG_PILL_BG_TOP = MUCHA_UI_COLORS.surfaces.panelRaised;
const TAG_PILL_BG_LOW = MUCHA_UI_COLORS.surfaces.border;
const TAG_PILL_BG_BYPASSED = 0x5e3b34;
const TAG_PILL_BORDER_ACTIVE = MUCHA_UI_COLORS.surfaces.border;
const TAG_PILL_BORDER_TOP = MUCHA_UI_COLORS.surfaces.border;
const TAG_PILL_BORDER_LOW = MUCHA_UI_COLORS.surfaces.borderSoft;
const TAG_PILL_BORDER_BYPASSED = 0x8e5b53;
const TAG_PILL_TEXT = MUCHA_UI_COLORS.ink.primary;
const TAG_PILL_TEXT_LOW = MUCHA_UI_COLORS.ink.secondary;
const TAG_PILL_TEXT_BYPASSED = MUCHA_UI_COLORS.ink.alert;

const SYSTEM_ROW_HEIGHT = 18;
const SYSTEM_ROW_GAP = 4;
const SYSTEM_ICON_SIZE = 12;
const SYSTEM_BAR_HEIGHT = 8;
const SYSTEM_BAR_BG = MUCHA_UI_COLORS.surfaces.panelDeep;
const SYSTEM_BAR_BORDER = MUCHA_UI_COLORS.surfaces.borderSoft;
const SYSTEM_BAR_TEXT = MUCHA_UI_COLORS.ink.secondary;
const SYSTEM_BAR_RADIUS = 4;
const SYSTEM_BAR_RATIO_QUANT = 100;
const TAG_ACTION_COG_FILL = 0xa7afb8;
const TAG_ACTION_COG_STROKE = 0xdbe2e8;
const TAG_ACTION_COG_ICON = 0x4f5862;
const TAG_TITLE_FILL_INSET = 1;
const TAG_TITLE_FILL_ALPHA = 0.72;
const FAITH_TIER_ORDER = ["bronze", "silver", "gold", "diamond"];
const FAITH_TIER_COLORS = Object.freeze({
  bronze: 0x8f6945,
  silver: 0x8ea0b2,
  gold: 0xc8a03f,
  diamond: 0x72a9c8,
});

const HUB_SYSTEM_UI_MAP = {
  build: { label: "Build", icon: "B", color: 0x8f7a58 },
  cook: { label: "Cook", icon: "C", color: 0xb67e56 },
  craft: { label: "Craft", icon: "Cr", color: 0x8ca66b },
  residents: { label: "Residents", icon: "R", color: 0xb7a57f },
  granaryStore: { label: "Granary", icon: "G", color: 0xc2a06d },
  storage: { label: "Storage", icon: "S", color: 0x8ea17f },
};

const TAG_PILL_STYLES = {
  active: {
    bgColor: TAG_PILL_BG_ACTIVE,
    borderColor: TAG_PILL_BORDER_ACTIVE,
    textColor: TAG_PILL_TEXT,
    alpha: 1,
    rowScale: TAG_ROW_SCALE_ACTIVE,
  },
  topInactive: {
    bgColor: TAG_PILL_BG_TOP,
    borderColor: TAG_PILL_BORDER_TOP,
    textColor: TAG_PILL_TEXT,
    alpha: 0.95,
    rowScale: 1,
  },
  low: {
    bgColor: TAG_PILL_BG_LOW,
    borderColor: TAG_PILL_BORDER_LOW,
    textColor: TAG_PILL_TEXT_LOW,
    alpha: 0.7,
    rowScale: 1,
  },
  bypassed: {
    bgColor: TAG_PILL_BG_BYPASSED,
    borderColor: TAG_PILL_BORDER_BYPASSED,
    textColor: TAG_PILL_TEXT_BYPASSED,
    alpha: 0.9,
    rowScale: 1,
  },
};

export const HUB_TAG_LAYOUT = {
  PILL_HEIGHT: TAG_PILL_HEIGHT,
  PILL_RADIUS: TAG_PILL_RADIUS,
  PILL_PAD_X: TAG_PILL_PAD_X,
  PILL_GAP: TAG_PILL_GAP,
  PILL_WIDTH: TAG_PILL_WIDTH,
};

export function createHubTagUi(opts) {
  const {
    tooltipView,
    getGameState,
    getHubPlanPreview,
    startTagDrag,
    setTextResolution,
    baseTextResolution,
    hoverTextResolution,
    requestPauseForAction,
    toggleTag,
    openRecipeDropdown,
    onProcessCogClick,
    isProcessWidgetSystem,
    onSystemIconHover,
    onSystemIconOut,
    onSystemIconClick,
  } = opts;

  function getTagLabel(tagId) {
    const def = hubTagDefs[tagId];
    return def?.ui?.name || tagId;
  }

  function getTagTitleFeedbackConfig(tagId) {
    const feedback = hubTagDefs?.[tagId]?.ui?.titleFeedback;
    return feedback && typeof feedback === "object" ? feedback : null;
  }

  function shouldHideSystemRowsForTag(tagId) {
    return getTagTitleFeedbackConfig(tagId)?.hideSystemRows === true;
  }

  function getSystemUi(systemId) {
    const entry = HUB_SYSTEM_UI_MAP[systemId];
    if (entry) return entry;
    const def = hubSystemDefs?.[systemId];
    const label = def?.ui?.name || systemId || "System";
    const icon = label ? label.slice(0, 1).toUpperCase() : "?";
    return { label, icon, color: MUCHA_UI_COLORS.surfaces.border };
  }

  function isRecipeSystem(systemId) {
    return systemId === "cook" || systemId === "craft";
  }

  function clamp01(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
  }

  function formatTierLabel(tier) {
    const raw = typeof tier === "string" ? tier : "";
    if (!raw.length) return "Bronze";
    return raw[0].toUpperCase() + raw.slice(1);
  }

  function isHousingTag(tagId) {
    return tagId === "canHouse";
  }

  function isProcessWidgetCapableSystem(systemId) {
    return isProcessWidgetSystem?.(systemId) === true;
  }

  function resolveProcessWidgetSystemIdForTagSystems(systems, tagId = null) {
    if (isHousingTag(tagId)) return null;
    if (!Array.isArray(systems) || systems.length <= 0) return null;
    for (const systemId of systems) {
      if (!isProcessWidgetCapableSystem(systemId)) continue;
      return systemId;
    }
    return null;
  }

  function formatRecipeName(recipeId) {
    if (!recipeId) return "select recipe";
    return recipeDefs?.[recipeId]?.name || recipeId;
  }

  function getStructurePreview(structure) {
    const hubCol = Number.isFinite(structure?.col) ? Math.floor(structure.col) : null;
    return hubCol != null ? getHubPlanPreview?.(hubCol) ?? null : null;
  }

  function getRecipeSystemState(structure, systemId) {
    const base = structure?.systemState?.[systemId] || {};
    const preview = getStructurePreview(structure);
    if (!preview || !systemId) return base;
    return {
      ...base,
      recipePriority:
        preview.recipePriorityBySystemId?.[systemId] ?? base.recipePriority ?? null,
      selectedRecipeId:
        preview.recipeIdBySystemId?.[systemId] ?? base.selectedRecipeId ?? null,
    };
  }

  function getRecipePrioritySummary(systemId, systemState) {
    const normalized = normalizeRecipePriority(systemState?.recipePriority, {
      systemId,
      state: null,
      includeLocked: true,
    });
    const fallbackSelected =
      typeof systemState?.selectedRecipeId === "string" && systemState.selectedRecipeId.length > 0
        ? systemState.selectedRecipeId
        : null;
    const priority =
      normalized.ordered.length > 0
        ? normalized
        : buildRecipePriorityFromSelectedRecipe(fallbackSelected, {
            systemId,
            state: null,
            includeLocked: true,
          });
    const enabled = getEnabledRecipeIds(priority);
    const topId = getTopEnabledRecipeId(priority);
    return {
      enabledCount: enabled.length,
      topId,
      enabledIds: enabled,
    };
  }

  function getRecipeProcesses(structure, systemId) {
    const processes = structure?.systemState?.[systemId]?.processes;
    return Array.isArray(processes) ? processes : [];
  }

  function areProcessRequirementsComplete(process) {
    const reqs = Array.isArray(process?.requirements) ? process.requirements : [];
    for (const req of reqs) {
      const amount = Math.max(0, Math.floor(req?.amount ?? 0));
      const progress = Math.max(0, Math.floor(req?.progress ?? 0));
      if (progress < amount) return false;
    }
    return true;
  }

  function canRecipeProcessAdvanceNow(state, structure, process) {
    if (!process || typeof process !== "object") return false;
    if (!state || !structure) return areProcessRequirementsComplete(process);

    const processDef = getProcessDefForInstance(process, structure, {
      leaderId: process?.leaderId ?? null,
    });
    if (!processDef) return areProcessRequirementsComplete(process);

    const availability = evaluateProcessRequirementAvailability({
      state,
      target: structure,
      process,
      processDef,
      context: { leaderId: process?.leaderId ?? null },
    });
    const rows = Array.isArray(availability?.requirements)
      ? availability.requirements
      : null;
    if (rows && rows.length > 0) {
      let hasIncompleteRequirement = false;
      for (const row of rows) {
        const required = Math.max(0, Math.floor(row?.required ?? 0));
        const loaded = Math.max(0, Math.floor(row?.loaded ?? 0));
        if (loaded >= required) continue;
        hasIncompleteRequirement = true;
        const reachableFromInputs = Math.max(
          0,
          Math.floor(row?.reachableFromInputs ?? 0)
        );
        if (reachableFromInputs > 0) return true;
      }
      if (hasIncompleteRequirement) return false;
      return true;
    }

    return true;
  }

  function getActiveRecipeProcess(structure, systemId) {
    const processes = getRecipeProcesses(structure, systemId).filter(
      (proc) => proc && typeof proc === "object"
    );
    if (processes.length <= 0) return null;
    const summary = getRecipePrioritySummary(
      systemId,
      getRecipeSystemState(structure, systemId)
    );

    const state = getGameState?.() || null;

    const enabledIds = Array.isArray(summary?.enabledIds) ? summary.enabledIds : [];
    for (const recipeId of enabledIds) {
      const match = processes.find((proc) => proc?.type === recipeId);
      if (!match) continue;
      if (canRecipeProcessAdvanceNow(state, structure, match)) return match;
    }

    if (summary?.topId) {
      const topMatch = processes.find((proc) => proc?.type === summary.topId);
      if (topMatch) return topMatch;
    }
    return (
      processes.find(
        (proc) => typeof proc?.type === "string" && proc.type.length > 0
      ) || null
    );
  }

  function formatRecipeRequirementLabel(req) {
    return formatBuildRequirementLabel(req);
  }

  function formatRecipeModeLabel(mode) {
    return mode === "time" ? "Time" : "Work";
  }

  function getTopRecipeIdForSystem(structure, systemId) {
    const summary = getRecipePrioritySummary(
      systemId,
      getRecipeSystemState(structure, systemId)
    );
    return summary?.topId ?? null;
  }

  function resolveRecipeContextForTag(tagId, structure) {
    let systemId = null;
    if (tagId === "canCraft") systemId = "craft";
    if (tagId === "canCook") systemId = "cook";
    if (!systemId) return null;

    const activeProcess = getActiveRecipeProcess(structure, systemId);
    const topRecipeId = getTopRecipeIdForSystem(structure, systemId);
    const activeRecipeId =
      typeof activeProcess?.type === "string" && activeProcess.type.length > 0
        ? activeProcess.type
        : null;
    const recipeId = activeRecipeId || topRecipeId || null;
    return {
      systemId,
      recipeId,
      activeProcess,
    };
  }

  function formatRecipeOutputLine(recipeId) {
    const outputs = Array.isArray(recipeDefs?.[recipeId]?.outputs)
      ? recipeDefs[recipeId].outputs
      : [];
    if (outputs.length <= 0) return null;
    const first = outputs[0];
    const kind =
      typeof first?.kind === "string" && first.kind.length > 0
        ? first.kind
        : typeof first?.itemId === "string" && first.itemId.length > 0
          ? first.itemId
          : null;
    if (!kind) return null;
    const itemName = itemDefs?.[kind]?.name || kind;
    const qty = Math.max(1, Math.floor(first?.qty ?? first?.amount ?? 1));
    return qty > 1 ? `Produces: ${itemName} x${qty}` : `Produces: ${itemName}`;
  }

  function buildRowsForRecipeSystem(structure, systemId) {
    if (!isRecipeSystem(systemId)) return [{ kind: "recipeIdle", recipeId: null }];

    const activeProcess = getActiveRecipeProcess(structure, systemId);
    if (activeProcess) {
      const recipeId =
        typeof activeProcess.type === "string" && activeProcess.type.length > 0
          ? activeProcess.type
          : null;
      const reqs = Array.isArray(activeProcess.requirements)
        ? activeProcess.requirements
        : [];
      const remainingReqs = reqs
        .map((req, index) => {
          const amount = Math.max(0, Math.floor(req?.amount ?? 0));
          if (amount <= 0) return null;
          const progress = Math.max(0, Math.floor(req?.progress ?? 0));
          if (progress >= amount) return null;
          return {
            kind: "recipeRequirement",
            recipeId,
            index,
            amount,
            progress,
            label: formatRecipeRequirementLabel(req),
          };
        })
        .filter(Boolean);
      if (remainingReqs.length > 0) {
        return remainingReqs;
      }
      return [
        {
          kind: "recipeLabor",
          recipeId,
          mode: activeProcess.mode === "time" ? "time" : "work",
          progress: Math.max(0, Math.floor(activeProcess.progress ?? 0)),
          duration: Math.max(1, Math.floor(activeProcess.durationSec ?? 1)),
        },
      ];
    }

    const topRecipeId = getTopRecipeIdForSystem(structure, systemId);
    if (!topRecipeId) return [{ kind: "recipeIdle", recipeId: null }];

    const recipeDef = recipeDefs?.[topRecipeId] || null;
    const inputs = Array.isArray(recipeDef?.inputs) ? recipeDef.inputs : [];
    const rows = inputs
      .map((req, index) => {
        const amount = Math.max(0, Math.floor(req?.qty ?? req?.amount ?? 0));
        if (amount <= 0) return null;
        return {
          kind: "recipeRequirement",
          recipeId: topRecipeId,
          index,
          amount,
          progress: 0,
          label: formatRecipeRequirementLabel(req),
        };
      })
      .filter(Boolean);

    if (rows.length <= 0) {
      return [
        {
          kind: "recipeLabor",
          recipeId: topRecipeId,
          mode: "work",
          progress: 0,
          duration: Math.max(1, Math.floor(recipeDef?.durationSec ?? 1)),
        },
      ];
    }
    return rows;
  }

  function getRecipeRowSignature(systemId, rows) {
    return [
      systemId || "recipe",
      ...(Array.isArray(rows) ? rows : []).map((row) =>
        [
          row?.kind || "row",
          row?.recipeId || "",
          Number.isFinite(row?.index) ? row.index : "",
          Number.isFinite(row?.amount) ? row.amount : "",
          Number.isFinite(row?.progress) ? row.progress : "",
          Number.isFinite(row?.duration) ? row.duration : "",
          row?.mode || "",
          row?.label || "",
        ].join(":")
      ),
    ].join("|");
  }

  function resolveProcessFeedback(process, fallbackLabel, color) {
    if (!process || typeof process !== "object") {
      return {
        ratio: 0,
        color,
        tooltipLines: [`Status: ${fallbackLabel} idle`],
      };
    }

    const reqs = Array.isArray(process.requirements) ? process.requirements : [];
    for (const req of reqs) {
      const required = Math.max(0, Math.floor(req?.amount ?? 0));
      if (required <= 0) continue;
      const progress = Math.max(0, Math.floor(req?.progress ?? 0));
      if (progress >= required) continue;
      const label = formatBuildRequirementLabel(req);
      return {
        ratio: required > 0 ? progress / required : 0,
        color,
        tooltipLines: [
          `Status: ${fallbackLabel} loading`,
          `${label}: ${progress}/${required}`,
        ],
      };
    }

    const progress = Math.max(0, Math.floor(process.progress ?? 0));
    const duration = Math.max(1, Math.floor(process.durationSec ?? 1));
    return {
      ratio: duration > 0 ? progress / duration : 0,
      color,
      tooltipLines: [`Status: ${fallbackLabel} ${progress}/${duration}`],
    };
  }

  function resolveRecipeTitleFeedback(structure, systemId) {
    const color = getSystemUi(systemId).color;
    const rows = buildRowsForRecipeSystem(structure, systemId);
    const firstRow = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    if (!firstRow) {
      return {
        ratio: 0,
        color,
        tooltipLines: ["Status: no recipe selected"],
      };
    }
    if (firstRow.kind === "recipeRequirement") {
      const required = Math.max(0, Math.floor(firstRow.amount ?? 0));
      const progress = Math.max(0, Math.floor(firstRow.progress ?? 0));
      return {
        ratio: required > 0 ? progress / required : 0,
        color,
        tooltipLines: [
          `Recipe: ${formatRecipeName(firstRow.recipeId)}`,
          `${firstRow.label || "Material"}: ${progress}/${required}`,
        ],
      };
    }
    if (firstRow.kind === "recipeLabor") {
      const progress = Math.max(0, Math.floor(firstRow.progress ?? 0));
      const duration = Math.max(1, Math.floor(firstRow.duration ?? 1));
      return {
        ratio: duration > 0 ? progress / duration : 0,
        color,
        tooltipLines: [
          `Recipe: ${formatRecipeName(firstRow.recipeId)}`,
          `${formatRecipeModeLabel(firstRow.mode)}: ${progress}/${duration}`,
        ],
      };
    }
    if (!firstRow.recipeId) {
      return {
        ratio: 0,
        color,
        tooltipLines: ["Status: no recipe selected"],
      };
    }
    return {
      ratio: 0,
      color,
      tooltipLines: [
        `Recipe: ${formatRecipeName(firstRow.recipeId)}`,
        "Status: waiting to start",
      ],
    };
  }

  function getStructureActiveTagIds(structure, pawnCountRaw) {
    const tags = getStructureTags(structure);
    const enabledTags = tags.filter((tagId) => !isTagDisabled(structure, tagId));
    const pawnCount =
      Number.isFinite(pawnCountRaw) && pawnCountRaw > 0
        ? Math.floor(pawnCountRaw)
        : 0;
    return new Set(pawnCount > 0 ? enabledTags.slice(0, pawnCount) : []);
  }

  function getTagTitleFeedback(entry, structure) {
    const config = getTagTitleFeedbackConfig(entry?.tagId);
    if (!config) return null;
    if (entry?.tagId === "build") {
      return {
        fillMode: "bar",
        alpha: TAG_TITLE_FILL_ALPHA,
        ...resolveProcessFeedback(
          getBuildProcess(structure),
          getTagLabel(entry.tagId),
          getSystemUi("build").color
        ),
      };
    }
    if (entry?.tagId === "canCook" || entry?.tagId === "canCraft") {
      return {
        fillMode: "bar",
        alpha: TAG_TITLE_FILL_ALPHA,
        ...resolveRecipeTitleFeedback(structure, config.holderSystemId),
      };
    }
    return null;
  }

  function getTagTooltipLines(tagId, structure = null) {
    const def = hubTagDefs[tagId];
    const lines = [];
    if (def?.ui?.description) lines.push(def.ui.description);
    const recipeContext = resolveRecipeContextForTag(tagId, structure);
    if (recipeContext?.recipeId) {
      lines.push(`Recipe: ${formatRecipeName(recipeContext.recipeId)}`);
      const outputLine = formatRecipeOutputLine(recipeContext.recipeId);
      if (outputLine) lines.push(outputLine);
    }
    return lines;
  }

  function buildTagHoverLines(view, entry, structure) {
    const lines = getTagTooltipLines(entry.tagId, structure);
    const feedback = getTagTitleFeedback(entry, structure);
    if (feedback?.tooltipLines?.length) {
      lines.push(...feedback.tooltipLines);
    }
    return lines;
  }

  function isTagDisabled(structure, tagId) {
    if (!isTagUnlocked(tagId)) return true;
    const preview = getStructurePreview(structure);
    if (
      preview?.tagDisabledById &&
      Object.prototype.hasOwnProperty.call(preview.tagDisabledById, tagId)
    ) {
      return preview.tagDisabledById[tagId] === true || isTagHidden(structure, tagId);
    }
    const entry = structure?.tagStates?.[tagId];
    return entry?.disabled === true || isTagHidden(structure, tagId);
  }

  function isTagPlayerDisabled(structure, tagId) {
    if (!isTagUnlocked(tagId)) return true;
    const preview = getStructurePreview(structure);
    if (
      preview?.tagDisabledById &&
      Object.prototype.hasOwnProperty.call(preview.tagDisabledById, tagId)
    ) {
      return preview.tagDisabledById[tagId] === true;
    }
    const entry = structure?.tagStates?.[tagId];
    if (!entry || typeof entry !== "object") return false;
    const disabledBy =
      entry.disabledBy && typeof entry.disabledBy === "object"
        ? entry.disabledBy
        : null;
    if (disabledBy) return disabledBy.player === true;
    return entry.disabled === true;
  }

  function isTagUnlocked(tagId) {
    if (typeof tagId !== "string" || !tagId.length) return false;
    const state = getGameState?.();
    if (!state) return true;
    return hasHubTagUnlock(state, tagId);
  }

  function getStructureTags(structure) {
    const preview = getStructurePreview(structure);
    const tags = Array.isArray(preview?.tagIds)
      ? preview.tagIds
      : Array.isArray(structure?.tags)
      ? structure.tags
      : [];
    return tags.filter(
      (tagId) =>
        isTagUnlocked(tagId) &&
        !isTagHidden(structure, tagId) &&
        !isTagPlayerDisabled(structure, tagId)
    );
  }

  function isTierBucket(pool) {
    if (!pool || typeof pool !== "object") return false;
    for (const tier of TIER_ASC) {
      if (Object.prototype.hasOwnProperty.call(pool, tier)) return true;
    }
    return false;
  }

  function getDepositPoolInfo(structure) {
    if (!structure?.defId) return null;
    const def = hubStructureDefs?.[structure.defId];
    const deposit = def?.deposit;
    if (!deposit || typeof deposit !== "object") return null;
    const systemId =
      typeof deposit.systemId === "string" ? deposit.systemId : null;
    if (!systemId) return null;
    const poolKey =
      typeof deposit.poolKey === "string" && deposit.poolKey.length > 0
        ? deposit.poolKey
        : "byKindTier";
    const pool = structure?.systemState?.[systemId]?.[poolKey] ?? null;
    return { systemId, poolKey, pool };
  }

  function listStorageItemIds(structure) {
    const info = getDepositPoolInfo(structure);
    if (!info?.pool || typeof info.pool !== "object") return [];
    if (isTierBucket(info.pool)) return [null];
    const keys = Object.keys(info.pool || {});
    const items = [];
    for (const key of keys) {
      const bucket = info.pool[key];
      if (!bucket || typeof bucket !== "object") continue;
      items.push(key);
    }
    items.sort((a, b) => a.localeCompare(b));
    return items;
  }

  function getStorageSignature(structure) {
    const items = listStorageItemIds(structure);
    if (!items.length) return "empty";
    return items.map((id) => (id == null ? "_pool" : id)).join("|");
  }

  function getStorageTotals(pool, itemId) {
    const empty = { total: 0, byTier: { bronze: 0, silver: 0, gold: 0, diamond: 0 } };
    if (!pool || typeof pool !== "object") return empty;
    const bucket =
      itemId == null || isTierBucket(pool) ? pool : pool[itemId];
    if (!bucket || typeof bucket !== "object") return empty;
    const byTier = { bronze: 0, silver: 0, gold: 0, diamond: 0 };
    let total = 0;
    for (const tier of TIER_ASC) {
      const amount = Math.max(0, Math.floor(bucket[tier] ?? 0));
      byTier[tier] = amount;
      total += amount;
    }
    return { total, byTier };
  }

  function getStorageMaxTotal(pool) {
    if (!pool || typeof pool !== "object") return 0;
    if (isTierBucket(pool)) {
      return getStorageTotals(pool, null).total;
    }
    let maxTotal = 0;
    const keys = Object.keys(pool);
    for (const key of keys) {
      const totals = getStorageTotals(pool, key);
      if (totals.total > maxTotal) maxTotal = totals.total;
    }
    return maxTotal;
  }

  function showStorageTooltip(structure, row, bounds, scale = 1) {
    if (!tooltipView) return;
    const info = getDepositPoolInfo(structure);
    const pool = info?.pool;
    if (!pool || typeof pool !== "object") return;
    const itemId = row?.storageItemId ?? null;
    const totals = getStorageTotals(pool, itemId);
    const title = row?.storageLabel || "Storage";
    const lines = [
      `Total: ${totals.total}`,
      `Bronze: ${totals.byTier.bronze}`,
      `Silver: ${totals.byTier.silver}`,
      `Gold: ${totals.byTier.gold}`,
      `Diamond: ${totals.byTier.diamond}`,
    ];
    tooltipView.show({ title, lines, scale }, bounds);
  }

  function setChildTooltipHoverActive(view, active) {
    if (!view || typeof view !== "object") return;
    view.childTooltipHoverActive = !!active;
  }

  function getBuildProcess(structure) {
    const processes = Array.isArray(structure?.systemState?.build?.processes)
      ? structure.systemState.build.processes
      : [];
    return processes.find((proc) => proc?.type === "build") ?? null;
  }

  function formatBuildRequirementLabel(req) {
    if (!req || typeof req !== "object") return "Material";
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
    return "Material";
  }

  function buildRowsForBuildProcess(structure) {
    const process = getBuildProcess(structure);
    if (!process) return [{ kind: "labor" }];
    const reqs = Array.isArray(process.requirements)
      ? process.requirements.filter(
          (req) => Math.max(0, Math.floor(req?.amount ?? 0)) > 0
        )
      : [];
    if (reqs.length > 0) {
      let hasRemaining = false;
      for (const req of reqs) {
        const required = Math.max(0, Math.floor(req?.amount ?? 0));
        const progress = Math.max(0, Math.floor(req?.progress ?? 0));
        if (progress < required) {
          hasRemaining = true;
          break;
        }
      }
      if (hasRemaining) {
        return reqs.map((req, index) => ({
          kind: "requirement",
          index,
          label: formatBuildRequirementLabel(req),
        }));
      }
    }
    return [{ kind: "labor" }];
  }

  function getBuildRowSignature(rows) {
    return rows
      .map((row) => `${row.kind}:${row.index ?? ""}`)
      .join("|");
  }

  function drawCogVisual(icon, strokeColor) {
    if (!icon) return;
    const cx = TAG_ACTION_SIZE / 2;
    const cy = TAG_ACTION_SIZE / 2;
    const innerR = 2.4;
    const outerR = 4.4;
    icon.clear();
    icon.lineStyle(1, strokeColor, 1);
    icon.drawCircle(cx, cy, innerR);
    for (let i = 0; i < 8; i += 1) {
      const angle = (Math.PI * 2 * i) / 8;
      const x0 = cx + Math.cos(angle) * (outerR - 0.6);
      const y0 = cy + Math.sin(angle) * (outerR - 0.6);
      const x1 = cx + Math.cos(angle) * (outerR + 1.6);
      const y1 = cy + Math.sin(angle) * (outerR + 1.6);
      icon.moveTo(x0, y0);
      icon.lineTo(x1, y1);
    }
  }

  function updateActionVisual(entry, isDisabled) {
    if (!entry?.actionBg || !entry?.actionIcon) return;
    const visualKey = entry.actionMode === "cog" ? "cog" : "none";
    if (entry.lastActionVisualKey === visualKey) return;
    entry.lastActionVisualKey = visualKey;
    if (entry.actionMode === "cog") {
      entry.actionBg.clear();
      entry.actionBg
        .lineStyle(1, TAG_ACTION_COG_STROKE, 0.9)
        .beginFill(TAG_ACTION_COG_FILL, 0.98)
        .drawRoundedRect(0, 0, TAG_ACTION_SIZE, TAG_ACTION_SIZE, 3)
        .endFill();
      drawCogVisual(entry.actionIcon, TAG_ACTION_COG_ICON);
      return;
    }
    entry.actionBg.clear();
    entry.actionIcon.clear();
  }

  function setTagPillStyle(entry, style) {
    if (!entry || !style) return;
    const bgColor = style.bgColor ?? TAG_PILL_BG_LOW;
    const borderColor = style.borderColor ?? TAG_PILL_BORDER_LOW;
    const textColor = style.textColor ?? TAG_PILL_TEXT;
    const alpha = style.alpha ?? 1;
    const rowScale = style.rowScale ?? 1;

    if (entry.bgColor !== bgColor || entry.borderColor !== borderColor) {
      entry.bg.clear();
      entry.bg
        .lineStyle(1, borderColor, 0.9)
        .beginFill(bgColor, 0.95)
        .drawRoundedRect(0, 0, TAG_PILL_WIDTH, TAG_PILL_HEIGHT, TAG_PILL_RADIUS)
        .endFill();
      entry.bgColor = bgColor;
      entry.borderColor = borderColor;
    }

    if (entry.labelText?.style?.fill !== textColor) {
      entry.labelText.style.fill = textColor;
      entry.labelText.dirty = true;
    }
    entry.container.alpha = alpha;

    if (entry.rowScale !== rowScale) {
      entry.rowScale = rowScale;
      entry.row.scale.set(rowScale);
      if (entry.systemContainer) {
        entry.systemContainer.y = TAG_PILL_HEIGHT * rowScale + 4;
      }
    }
  }

  function drawSystemBar(row, ratio, color) {
    const width = row.barWidth * Math.max(0, Math.min(1, ratio));
    row.barFill.clear();
    if (width <= 0) return;
    row.barFill.beginFill(color, 0.95);
    row.barFill.drawRoundedRect(
      row.barX,
      row.barY,
      width,
      row.barHeight,
      row.barRadius
    );
    row.barFill.endFill();
  }

  function quantizeSystemBarRatio(ratio) {
    const t = Math.max(0, Math.min(1, ratio));
    return Math.round(t * SYSTEM_BAR_RATIO_QUANT);
  }

  function setSystemRowLabel(row, label) {
    if (row.lastLabelText === label) return;
    row.lastLabelText = label;
    row.labelText.text = label;
  }

  function renderSystemRowBar(row, label, ratio, color) {
    const ratioKey = quantizeSystemBarRatio(ratio);
    const renderKey = `bar|${color}|${ratioKey}|${label}`;
    if (row.lastBarRenderKey === renderKey) return;
    setSystemRowLabel(row, label);
    drawSystemBar(row, ratioKey / SYSTEM_BAR_RATIO_QUANT, color);
    row.lastBarRenderKey = renderKey;
  }

  function getFaithThreshold() {
    const raw = Number.isFinite(FAITH_GROWTH_STREAK_FOR_UPGRADE)
      ? Math.floor(FAITH_GROWTH_STREAK_FOR_UPGRADE)
      : 3;
    return Math.max(1, raw);
  }

  function getFaithTierIndex(tier) {
    const key = typeof tier === "string" ? tier : "";
    const idx = FAITH_TIER_ORDER.indexOf(key);
    return idx >= 0 ? idx : 0;
  }

  function renderFaithRow(structure, row) {
    const tier = typeof structure?.systemTiers?.faith === "string"
      ? structure.systemTiers.faith
      : "bronze";
    const tierIndex = getFaithTierIndex(tier);
    const tracker = getGameState?.()?.populationTracker || {};
    const streak = Math.max(0, Math.floor(tracker?.faithGrowthStreak ?? 0));
    const threshold = getFaithThreshold();
    const ratio = clamp01(streak / threshold);
    const label = `${formatTierLabel(tier)} ${streak}/${threshold}`;
    const renderKey = `faith|${tier}|${streak}|${threshold}`;
    if (row.lastBarRenderKey === renderKey) return;

    setSystemRowLabel(row, label);
    row.barFill.clear();

    const slotGap = 1;
    const slotCount = FAITH_TIER_ORDER.length;
    const slotWidth = Math.max(
      1,
      Math.floor((row.barWidth - slotGap * (slotCount - 1)) / slotCount)
    );
    let x = row.barX;
    for (let i = 0; i < slotCount; i += 1) {
      const tierId = FAITH_TIER_ORDER[i];
      const active = i <= tierIndex;
      const color = FAITH_TIER_COLORS[tierId] ?? 0x777777;
      row.barFill.beginFill(active ? color : MUCHA_UI_COLORS.surfaces.borderSoft, active ? 0.95 : 0.55);
      row.barFill.drawRoundedRect(x, row.barY, slotWidth, row.barHeight, 2);
      row.barFill.endFill();
      x += slotWidth + slotGap;
    }

    const progressHeight = Math.max(2, Math.floor(row.barHeight * 0.35));
    const progressY = row.barY + row.barHeight - progressHeight;
    row.barFill.beginFill(0x000000, 0.25);
    row.barFill.drawRect(row.barX, progressY, row.barWidth, progressHeight);
    row.barFill.endFill();
    if (ratio > 0) {
      row.barFill.beginFill(MUCHA_UI_COLORS.intent.alertPop, 0.9);
      row.barFill.drawRect(
        row.barX,
        progressY,
        Math.max(1, Math.floor(row.barWidth * ratio)),
        progressHeight
      );
      row.barFill.endFill();
    }

    row.lastBarRenderKey = renderKey;
  }

  function buildSystemRow(view, systemId, opts = null) {
    const uiOverride = opts?.uiOverride ?? null;
    const ui = uiOverride || getSystemUi(systemId);
    const allowProcessWidgetOpen = opts?.allowProcessWidgetOpen !== false;
    const requestedProcessSystemId =
      typeof opts?.processSystemId === "string" && opts.processSystemId.length > 0
        ? opts.processSystemId
        : systemId;
    const processWidgetSystemId =
      allowProcessWidgetOpen && isProcessWidgetCapableSystem(requestedProcessSystemId)
        ? requestedProcessSystemId
        : null;
    const container = new PIXI.Container();
    container.eventMode = "static";
    container.hitArea = new PIXI.Rectangle(
      0,
      0,
      TAG_PILL_WIDTH,
      SYSTEM_ROW_HEIGHT
    );
    container.on("pointerdown", (ev) => {
      ev?.stopPropagation?.();
    });

    const icon = new PIXI.Container();
    icon.eventMode = "static";
    icon.cursor =
      onSystemIconClick || onSystemIconHover || onSystemIconOut
        ? "pointer"
        : "help";

    const iconBg = new PIXI.Graphics()
      .lineStyle(1, TAG_PILL_BORDER_LOW, 0.8)
      .beginFill(ui.color, 1)
      .drawCircle(
        SYSTEM_ICON_SIZE / 2,
        SYSTEM_ROW_HEIGHT / 2,
        SYSTEM_ICON_SIZE / 2
      )
      .endFill();
    const iconText = new PIXI.Text(ui.icon, {
      fill: 0xffffff,
      fontSize: 8,
      fontWeight: "bold",
    });
    applyTextResolution(iconText, 1.5);
    iconText.anchor.set(0.5, 0.5);
    iconText.x = SYSTEM_ICON_SIZE / 2;
    iconText.y = SYSTEM_ROW_HEIGHT / 2;
    icon.addChild(iconBg, iconText);
    container.addChild(icon);

    const barX = SYSTEM_ICON_SIZE + 6;
    const barWidth = TAG_PILL_WIDTH - barX - 6;
    const barHeight = SYSTEM_BAR_HEIGHT;
    const barY = Math.floor((SYSTEM_ROW_HEIGHT - barHeight) / 2);
    const barRadius = SYSTEM_BAR_RADIUS;

    const barBg = new PIXI.Graphics()
      .lineStyle(1, SYSTEM_BAR_BORDER, 0.9)
      .beginFill(SYSTEM_BAR_BG, 0.95)
      .drawRoundedRect(
        barX,
        barY,
        barWidth,
        barHeight,
        barRadius
      )
      .endFill();
    const barFill = new PIXI.Graphics();
    container.addChild(barBg, barFill);

    const labelText = new PIXI.Text("", {
      fill: SYSTEM_BAR_TEXT,
      fontSize: 9,
    });
    labelText.anchor.set(0.5, 0.5);
    labelText.x = barX + Math.floor(barWidth / 2);
    labelText.y = barY + Math.floor(barHeight / 2);
    container.addChild(labelText);

    if (isRecipeSystem(systemId)) {
      container.cursor = "pointer";
      container.on("pointerdown", (ev) => {
        ev?.stopPropagation?.();
        requestPauseForAction?.();
        openRecipeDropdown?.(view, systemId, container.getBounds());
      });
    }

    const row = {
      systemId,
      processSystemId: opts?.processSystemId ?? null,
      container,
      icon,
      barBg,
      barFill,
      barX,
      barWidth,
      barY,
      barHeight,
      barRadius,
      labelText,
      iconText,
      uiColor: ui.color,
      buildKind: opts?.kind ?? null,
      buildReqIndex: Number.isFinite(opts?.index) ? opts.index : null,
      buildLabel: opts?.label ?? null,
      recipeKind: opts?.kind ?? null,
      recipeId:
        typeof opts?.recipeId === "string" && opts.recipeId.length > 0
          ? opts.recipeId
          : null,
      recipeReqIndex: Number.isFinite(opts?.index) ? opts.index : null,
      recipeReqAmount: Number.isFinite(opts?.amount)
        ? Math.max(0, Math.floor(opts.amount))
        : 0,
      recipeReqProgress: Number.isFinite(opts?.progress)
        ? Math.max(0, Math.floor(opts.progress))
        : 0,
      recipeDuration: Number.isFinite(opts?.duration)
        ? Math.max(1, Math.floor(opts.duration))
        : 1,
      recipeProgress: Number.isFinite(opts?.progress)
        ? Math.max(0, Math.floor(opts.progress))
        : 0,
      recipeMode: opts?.mode === "time" ? "time" : "work",
      recipeLabel: opts?.label ?? null,
      storageItemId: opts?.storageItemId ?? null,
      storageLabel: opts?.storageLabel ?? null,
      processWidgetSystemId,
      lastLabelText: null,
      lastBarRenderKey: null,
    };

    icon.on("pointerover", () => {
      setChildTooltipHoverActive(view, true);
      onSystemIconHover?.(view, processWidgetSystemId);
      if (systemId === "storage") {
        showStorageTooltip(
          view.structure,
          row,
          icon.getBounds(),
          getDisplayObjectWorldScale(icon, 1)
        );
      }
    });
    icon.on("pointerout", () => {
      setChildTooltipHoverActive(view, false);
      onSystemIconOut?.(view, processWidgetSystemId);
      if (systemId === "storage") {
        tooltipView?.hide?.();
      }
    });
    icon.on("pointerdown", (ev) => {
      ev?.stopPropagation?.();
    });
    icon.on("pointertap", (ev) => {
      ev?.stopPropagation?.();
      if (!processWidgetSystemId) return;
      onSystemIconClick?.(view, processWidgetSystemId);
    });

    return row;
  }

  function buildTagEntry(view, tagId, structure) {
    const tagDef = hubTagDefs[tagId];
    const systems = Array.isArray(tagDef?.systems) ? tagDef.systems : [];
    const processWidgetSystemId = resolveProcessWidgetSystemIdForTagSystems(
      systems,
      tagId
    );
    const actionMode = processWidgetSystemId ? "cog" : "none";
    const hideSystemRows = shouldHideSystemRowsForTag(tagId);

    const container = new PIXI.Container();
    const row = new PIXI.Container();
    row.eventMode = "static";
    row.cursor = "grab";
    row.hitArea = new PIXI.Rectangle(0, 0, TAG_PILL_WIDTH, TAG_PILL_HEIGHT);
    container.addChild(row);

    const bg = new PIXI.Graphics()
      .lineStyle(1, TAG_PILL_BORDER_LOW, 0.9)
      .beginFill(TAG_PILL_BG_LOW, 0.95)
      .drawRoundedRect(0, 0, TAG_PILL_WIDTH, TAG_PILL_HEIGHT, TAG_PILL_RADIUS)
      .endFill();
    row.addChild(bg);

    const titleFill = new PIXI.Graphics();
    row.addChild(titleFill);

    const titleFlash = new PIXI.Graphics();
    row.addChild(titleFlash);

    const label = getTagLabel(tagId);
    const labelText = new PIXI.Text(label, {
      fill: TAG_PILL_TEXT,
      fontSize: 10,
      wordWrap: false,
    });
    labelText.x = TAG_LABEL_X;
    labelText.y = Math.round((TAG_PILL_HEIGHT - labelText.height) / 2);
    row.addChild(labelText);

    const actionControl = new PIXI.Container();
    actionControl.x = TAG_PILL_WIDTH - TAG_ACTION_SIZE - TAG_ACTION_PAD;
    actionControl.y = Math.round((TAG_PILL_HEIGHT - TAG_ACTION_SIZE) / 2);
    actionControl.eventMode = actionMode === "cog" ? "static" : "none";
    actionControl.cursor = actionMode === "cog" ? "pointer" : "default";
    actionControl.visible = actionMode === "cog";
    row.addChild(actionControl);

    const actionBg = new PIXI.Graphics();
    actionControl.addChild(actionBg);

    const actionIcon = new PIXI.Graphics();
    actionControl.addChild(actionIcon);

    const systemContainer = new PIXI.Container();
    systemContainer.y = TAG_PILL_HEIGHT + 4;
    container.addChild(systemContainer);

    const systemRows = [];
    let sysY = 0;
    let buildRowSignature = null;
    let recipeRowSignature = null;
    let recipeSystemId = null;
    if (tagId === "build" && structure) {
      const rows = buildRowsForBuildProcess(structure);
      buildRowSignature = getBuildRowSignature(rows);
      if (!hideSystemRows) {
        for (const rowSpec of rows) {
          const rowEntry = buildSystemRow(view, "build", rowSpec);
          rowEntry.container.y = sysY;
          systemContainer.addChild(rowEntry.container);
          systemRows.push(rowEntry);
          sysY += SYSTEM_ROW_HEIGHT + SYSTEM_ROW_GAP;
        }
      }
    } else {
      const firstRecipeSystemId = systems.find((systemId) => isRecipeSystem(systemId));
      if (structure && firstRecipeSystemId) {
        recipeSystemId = firstRecipeSystemId;
        const rows = buildRowsForRecipeSystem(structure, recipeSystemId);
        recipeRowSignature = getRecipeRowSignature(recipeSystemId, rows);
        if (!hideSystemRows) {
          for (const rowSpec of rows) {
            const rowEntry = buildSystemRow(view, recipeSystemId, rowSpec);
            rowEntry.container.y = sysY;
            systemContainer.addChild(rowEntry.container);
            systemRows.push(rowEntry);
            sysY += SYSTEM_ROW_HEIGHT + SYSTEM_ROW_GAP;
          }
        }
      } else if (!hideSystemRows) {
        for (const systemId of systems) {
          if (systemId === "deposit") continue;
          if (systemId === "storage") {
            const itemIds = listStorageItemIds(structure);
            if (itemIds.length === 0) {
                const rowEntry = buildSystemRow(view, "storage", {
                  storageItemId: null,
                  storageLabel: "Storage",
                  uiOverride: getSystemUi("storage"),
                  processSystemId: "deposit",
                  allowProcessWidgetOpen: !isHousingTag(tagId),
                });
              rowEntry.container.y = sysY;
              systemContainer.addChild(rowEntry.container);
              systemRows.push(rowEntry);
              sysY += SYSTEM_ROW_HEIGHT + SYSTEM_ROW_GAP;
            } else {
              for (const itemId of itemIds) {
                const def = itemId ? itemDefs?.[itemId] : null;
                const label = def?.name || itemId || "Pool";
                const icon = label ? label.slice(0, 1).toUpperCase() : "S";
                const color = def?.color ?? getSystemUi("storage").color;
                const rowEntry = buildSystemRow(view, "storage", {
                  storageItemId: itemId,
                  storageLabel: label,
                  uiOverride: { label, icon, color },
                  processSystemId: "deposit",
                  allowProcessWidgetOpen: !isHousingTag(tagId),
                });
                rowEntry.container.y = sysY;
                systemContainer.addChild(rowEntry.container);
                systemRows.push(rowEntry);
                sysY += SYSTEM_ROW_HEIGHT + SYSTEM_ROW_GAP;
              }
            }
            continue;
          }
          const rowEntry = buildSystemRow(view, systemId, {
            allowProcessWidgetOpen: !isHousingTag(tagId),
          });
          rowEntry.container.y = sysY;
          systemContainer.addChild(rowEntry.container);
          systemRows.push(rowEntry);
          sysY += SYSTEM_ROW_HEIGHT + SYSTEM_ROW_GAP;
        }
      }
    }

    const entry = {
      tagId,
      container,
      row,
      bg,
      titleFill,
      titleFlash,
      bgColor: TAG_PILL_BG_LOW,
      borderColor: TAG_PILL_BORDER_LOW,
      labelText,
      actionControl,
      actionBg,
      actionIcon,
      actionMode,
      lastActionVisualKey: null,
      processWidgetSystemId,
      rowScale: 1,
      systemContainer,
      systemRows,
      expanded: false,
      systemHeight: sysY > 0 ? sysY - SYSTEM_ROW_GAP : 0,
      height: TAG_PILL_HEIGHT,
      buildRowSignature,
      recipeRowSignature,
      recipeSystemId,
      storageSignature: systems.includes("storage") ? getStorageSignature(structure) : null,
      hideSystemRows,
      lastTitleFeedbackKey: null,
    };

    entry.setExpanded = (expanded) => {
      entry.expanded = !!expanded;
    };

    if (actionMode === "cog") {
      actionControl.on("pointerdown", (ev) => {
        ev?.stopPropagation?.();
        view.ignoreNextTagTap = true;
      });
      actionControl.on("pointertap", (ev) => {
        ev?.stopPropagation?.();
        view.ignoreNextTagTap = true;
        requestPauseForAction?.();
        onProcessCogClick?.(view, processWidgetSystemId);
      });
    }

    row.on("pointerover", () => {
      setChildTooltipHoverActive(view, true);
      const lines = buildTagHoverLines(view, entry, structure);
      if (lines.length && tooltipView) {
        tooltipView.show(
          {
            title: getTagLabel(tagId),
            lines,
            scale: getDisplayObjectWorldScale(row, 1),
          },
          row.getBounds()
        );
      }
    });
    row.on("pointerout", () => {
      setChildTooltipHoverActive(view, false);
      tooltipView?.hide?.();
    });
    row.on("pointerdown", (ev) => {
      if (view.ignoreNextTagTap) view.ignoreNextTagTap = false;
      startTagDrag?.(view, entry, ev);
    });
    row.on("pointertap", (ev) => {
      ev?.stopPropagation?.();
      if (view.ignoreNextTagTap) {
        view.ignoreNextTagTap = false;
        return;
      }
      const nextTagId = view.expandedTagId === entry.tagId ? null : entry.tagId;
      if (applyExpandedTag(view, nextTagId)) {
        layoutTagEntries(view);
      }
    });

    return entry;
  }

  function layoutTagEntries(view) {
    const entries = view.tagEntries || [];
    let totalContentHeight = 0;
    let expandedContentBottomY = 0;
    for (const entry of entries) {
      if (!entry) continue;
      const rowScale = entry.rowScale ?? 1;
      const rowHeight = TAG_PILL_HEIGHT * rowScale;
      let entryHeight = rowHeight;
      if (entry.expanded && entry.systemRows.length > 0) {
        let sysY = 0;
        for (const row of entry.systemRows) {
          row.container.visible = true;
          row.container.y = sysY;
          sysY += SYSTEM_ROW_HEIGHT + SYSTEM_ROW_GAP;
        }
        if (sysY > 0) sysY -= SYSTEM_ROW_GAP;
        entry.systemContainer.visible = sysY > 0;
        entryHeight = rowHeight + (sysY > 0 ? sysY + 4 : 0);
      } else {
        entry.systemContainer.visible = false;
        for (const row of entry.systemRows) {
          row.container.visible = false;
        }
      }
      entry.height = entryHeight;
      totalContentHeight += entryHeight + TAG_PILL_GAP;
      if (entry.expanded) {
        expandedContentBottomY = Math.max(expandedContentBottomY, totalContentHeight);
      }
    }
    if (totalContentHeight > 0) totalContentHeight -= TAG_PILL_GAP;

    let y = 0;
    for (const entry of entries) {
      if (!entry) continue;
      const entryHeight = entry.height ?? TAG_PILL_HEIGHT;
      entry.container.visible = true;
      entry.container.x = 0;
      entry.container.y = y;
      y += entryHeight + TAG_PILL_GAP;
    }
    view.totalContentHeight = Math.max(0, totalContentHeight);
    view.expandedContentBottomY = Math.max(0, expandedContentBottomY);
    return {
      totalContentHeight: view.totalContentHeight,
      expandedContentBottomY: view.expandedContentBottomY,
    };
  }

  function renderTagPillFeedback(entry, feedback) {
    if (!entry?.titleFill || !entry?.titleFlash) return;
    const ratio = clamp01(feedback?.fillMode === "full" ? 1 : feedback?.ratio ?? 0);
    const fillAlpha = clamp01(feedback?.alpha ?? 0);
    const fillColor = Number.isFinite(feedback?.color) ? Math.floor(feedback.color) : 0;
    const renderKey = [
      Math.round(ratio * 100),
      Math.round(fillAlpha * 100),
      fillColor,
    ].join("|");
    if (entry.lastTitleFeedbackKey === renderKey) return;
    entry.lastTitleFeedbackKey = renderKey;

    const x = TAG_TITLE_FILL_INSET;
    const y = TAG_TITLE_FILL_INSET;
    const maxWidth = Math.max(0, TAG_PILL_WIDTH - TAG_TITLE_FILL_INSET * 2);
    const width = Math.max(0, Math.floor(maxWidth * ratio));
    const height = Math.max(0, TAG_PILL_HEIGHT - TAG_TITLE_FILL_INSET * 2);
    const radius = Math.max(1, TAG_PILL_RADIUS - TAG_TITLE_FILL_INSET);

    entry.titleFill.clear();
    if (fillAlpha > 0 && width > 0 && height > 0) {
      entry.titleFill
        .beginFill(fillColor, fillAlpha)
        .drawRoundedRect(x, y, width, height, radius)
        .endFill();
    }
    entry.titleFlash.clear();
  }

  function updateSystemRow(structure, row) {
    if (!row) return;
    const systemId = row.systemId;
    if (!systemId) return;

    if (systemId === "build") {
      const process = getBuildProcess(structure);
      if (!process) {
        renderSystemRowBar(row, "Build", 0, row.uiColor);
        return;
      }
      if (row.buildKind === "requirement") {
        const req = Array.isArray(process.requirements)
          ? process.requirements[row.buildReqIndex]
          : null;
        if (!req) {
          renderSystemRowBar(row, row.buildLabel || "Material", 0, row.uiColor);
          return;
        }
        const required = Math.max(0, Math.floor(req.amount ?? 0));
        const progress = Math.max(0, Math.floor(req.progress ?? 0));
        const ratio = required > 0 ? progress / required : 0;
        const label = row.buildLabel || formatBuildRequirementLabel(req);
        renderSystemRowBar(
          row,
          `${label} ${progress}/${required}`,
          ratio,
          row.uiColor
        );
        return;
      }
      const progress = Math.max(0, Math.floor(process.progress ?? 0));
      const duration = Math.max(1, Math.floor(process.durationSec ?? 1));
      const ratio = duration > 0 ? progress / duration : 0;
      renderSystemRowBar(row, `Build ${progress}/${duration}`, ratio, row.uiColor);
      return;
    }

    if (systemId === "residents") {
      const residents = structure?.systemState?.residents || {};
      const population = Math.max(0, Math.floor(residents.population ?? 0));
      const capacity = Math.max(0, Math.floor(residents.housingCapacity ?? 0));
      const ratio = capacity > 0 ? population / capacity : 0;
      renderSystemRowBar(row, `${population}/${capacity}`, ratio, row.uiColor);
      return;
    }

    if (systemId === "faith") {
      renderFaithRow(structure, row);
      return;
    }

    if (isRecipeSystem(systemId)) {
      if (row.recipeKind === "recipeRequirement") {
        const required = Math.max(0, Math.floor(row.recipeReqAmount ?? 0));
        const progress = Math.max(0, Math.floor(row.recipeReqProgress ?? 0));
        const label = row.recipeLabel || "Material";
        renderSystemRowBar(
          row,
          `${label} ${progress}/${required}`,
          required > 0 ? progress / required : 0,
          row.uiColor
        );
        return;
      }
      if (row.recipeKind === "recipeLabor") {
        const progress = Math.max(0, Math.floor(row.recipeProgress ?? 0));
        const duration = Math.max(1, Math.floor(row.recipeDuration ?? 1));
        const modeLabel = formatRecipeModeLabel(row.recipeMode);
        renderSystemRowBar(
          row,
          `${modeLabel} ${progress}/${duration}`,
          duration > 0 ? progress / duration : 0,
          row.uiColor
        );
        return;
      }
      if (row.recipeKind === "recipeIdle") {
        if (!row.recipeId) {
          renderSystemRowBar(row, "No recipes", 0, row.uiColor);
          return;
        }
        renderSystemRowBar(row, "Work 0/0", 0, row.uiColor);
        return;
      }
      renderSystemRowBar(row, "Work 0/0", 0, row.uiColor);
      return;
    }

    if (systemId === "storage") {
      const info = getDepositPoolInfo(structure);
      const pool = info?.pool;
      if (!pool || typeof pool !== "object") {
        renderSystemRowBar(row, row.storageLabel || "Storage", 0, row.uiColor);
        return;
      }
      const totals = getStorageTotals(pool, row.storageItemId);
      const maxTotal = Math.max(1, getStorageMaxTotal(pool));
      const ratio = maxTotal > 0 ? totals.total / maxTotal : 0;
      const label = row.storageLabel || getSystemUi("storage").label;
      renderSystemRowBar(row, `${label} ${totals.total}`, ratio, row.uiColor);
      return;
    }

    renderSystemRowBar(row, getSystemUi(systemId).label, 1, row.uiColor);
  }

  function applyExpandedTag(view, nextTagId) {
    const normalizedTagId =
      typeof nextTagId === "string" && nextTagId.length > 0 ? nextTagId : null;
    if (view.expandedTagId === normalizedTagId) return false;
    view.expandedTagId = normalizedTagId;
    for (const entry of view.tagEntries || []) {
      entry.setExpanded(entry.tagId === view.expandedTagId);
    }
    return true;
  }

  function syncExpandedTagToActive(view, activeTagId) {
    const nextTagId =
      typeof activeTagId === "string" && activeTagId.length > 0 ? activeTagId : null;
    const previousActiveTagId =
      typeof view.lastAutoExpandedActiveTagId === "string" &&
      view.lastAutoExpandedActiveTagId.length > 0
        ? view.lastAutoExpandedActiveTagId
        : null;
    view.lastAutoExpandedActiveTagId = nextTagId;
    if (!nextTagId) return false;
    if (previousActiveTagId === nextTagId) return false;
    return applyExpandedTag(view, nextTagId);
  }

  function updateTagEntries(view, structure) {
    const tags = getStructureTags(structure);
    const enabledTags = tags.filter((tagId) => !isTagDisabled(structure, tagId));
    const topTagId = enabledTags[0] ?? null;
    const pawnCount =
      Number.isFinite(view?.pawnCount) && view.pawnCount > 0
        ? Math.floor(view.pawnCount)
        : 0;
    const hasPawn = pawnCount > 0;
    const activeTagIds = getStructureActiveTagIds(structure, pawnCount);
    const activeTagId = hasPawn ? enabledTags[0] ?? null : null;
    if (syncExpandedTagToActive(view, activeTagId)) {
      layoutTagEntries(view);
    }
    const buildEntry = (view.tagEntries || []).find(
      (entry) => entry?.tagId === "build"
    );
    if (buildEntry) {
      const desired = buildRowsForBuildProcess(structure);
      const signature = getBuildRowSignature(desired);
      if (signature !== buildEntry.buildRowSignature) {
        rebuildStructureTags(view, structure);
        return;
      }
    }
    for (const entry of view.tagEntries || []) {
      if (
        !entry ||
        typeof entry.recipeRowSignature !== "string" ||
        !entry.recipeSystemId
      ) {
        continue;
      }
      const desired = buildRowsForRecipeSystem(structure, entry.recipeSystemId);
      const signature = getRecipeRowSignature(entry.recipeSystemId, desired);
      if (signature !== entry.recipeRowSignature) {
        rebuildStructureTags(view, structure);
        return;
      }
    }
    const storageEntry = (view.tagEntries || []).find(
      (entry) => entry?.storageSignature != null
    );
    if (storageEntry) {
      const signature = getStorageSignature(structure);
      if (signature !== storageEntry.storageSignature) {
        rebuildStructureTags(view, structure);
        return;
      }
    }

    for (const entry of view.tagEntries || []) {
      const isDisabled = isTagDisabled(structure, entry.tagId);
      const isActive =
        hasPawn &&
        !isDisabled &&
        (activeTagIds.has(entry.tagId) || entry.tagId === topTagId);
      const isTopInactive =
        !hasPawn && entry.tagId === topTagId && !isDisabled;
      const isLowerPriority = !isDisabled && entry.tagId !== topTagId;

      let style = TAG_PILL_STYLES.low;
      if (isDisabled) {
        style = TAG_PILL_STYLES.bypassed;
      } else if (isActive) {
        style = TAG_PILL_STYLES.active;
      } else if (isTopInactive) {
        style = TAG_PILL_STYLES.topInactive;
      } else if (isLowerPriority) {
        style = TAG_PILL_STYLES.low;
      }

      setTagPillStyle(entry, style);
      updateActionVisual(entry, isDisabled);
      renderTagPillFeedback(
        entry,
        isDisabled ? null : getTagTitleFeedback(entry, structure)
      );

      for (const row of entry.systemRows || []) {
        updateSystemRow(structure, row);
      }
    }
  }

  function rebuildStructureTags(view, structure) {
    const tags = getStructureTags(structure);
    view.tagSignature = tags.join("|");

    view.tagContainer.removeChildren();
    view.tagEntries = [];
    view.tagContainer.sortableChildren = false;

    if (view.expandedTagId && !tags.includes(view.expandedTagId)) {
      view.expandedTagId = null;
    }

    const pawnCount =
      Number.isFinite(view?.pawnCount) && view.pawnCount > 0
        ? Math.floor(view.pawnCount)
        : 0;
    const enabledTags = tags.filter((tagId) => !isTagDisabled(structure, tagId));
    const activeTagId = pawnCount > 0 ? enabledTags[0] ?? null : null;
    if (!view.expandedTagId && activeTagId) {
      view.expandedTagId = activeTagId;
    }
    view.lastAutoExpandedActiveTagId =
      typeof activeTagId === "string" && activeTagId.length > 0 ? activeTagId : null;

    for (const tagId of tags) {
      const entry = buildTagEntry(view, tagId, structure);
      entry.setExpanded(view.expandedTagId === tagId);
      view.tagContainer.addChild(entry.container);
      view.tagEntries.push(entry);
    }

    if (Array.isArray(view.hoverTextNodes)) {
      view.hoverTextNodes.length = 0;
      if (Array.isArray(view.hoverTextBaseNodes)) {
        view.hoverTextNodes.push(...view.hoverTextBaseNodes);
      }
      for (const entry of view.tagEntries) {
        if (entry?.labelText) view.hoverTextNodes.push(entry.labelText);
        for (const row of entry?.systemRows || []) {
          if (row?.labelText) view.hoverTextNodes.push(row.labelText);
          if (row?.iconText) view.hoverTextNodes.push(row.iconText);
        }
      }
      setTextResolution?.(
        view.hoverTextNodes,
        view.isHovered ? hoverTextResolution : baseTextResolution
      );
    }

    layoutTagEntries(view);
    updateTagEntries(view, structure);
  }

  return {
    rebuildStructureTags,
    updateTagEntries,
    layoutTagEntries,
  };
}
