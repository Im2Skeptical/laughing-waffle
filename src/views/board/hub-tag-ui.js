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
import {
  getHubTagPlayerRole,
  isHubTagPlayerActive,
  normalizeVisibleHubTagOrder,
} from "../../model/hub-tags.js";
import { hasHubTagUnlock } from "../../model/skills.js";
import {
  buildRecipePriorityFromSelectedRecipe,
  getEnabledRecipeIds,
  getTopEnabledRecipeId,
  normalizeRecipePriority,
} from "../../model/recipe-priority.js";
import { getProcessDefForInstance } from "../../model/process-framework.js";
import { evaluateProcessRequirementAvailability } from "../../model/process-requirement-availability.js";
import { getHubTagExecutionPreview } from "../../model/tag-execution-preview.js";
import { isTagHidden } from "../../model/tag-state.js";
import { getDisplayObjectWorldScale } from "../ui-helpers/display-object-scale.js";
import { MUCHA_UI_COLORS } from "../ui-helpers/mucha-ui-palette.js";
import {
  getLiveUiTimeSec,
  stepAnimatedRatio,
} from "../ui-helpers/progress-animation.js";
import { applyTextResolution } from "../ui-helpers/text-resolution.js";
import { makeDefTooltipSpec } from "../def-tooltip-spec.js";

const TAG_PILL_HEIGHT = 20;
const TAG_PILL_RADIUS = 10;
const TAG_PASSIVE_RADIUS = 4;
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
const TAG_PILL_BORDER_SKIPPED = MUCHA_UI_COLORS.accents.gold;
const TAG_PILL_TEXT = MUCHA_UI_COLORS.ink.primary;
const TAG_PILL_TEXT_LOW = MUCHA_UI_COLORS.ink.secondary;
const TAG_PILL_TEXT_BYPASSED = MUCHA_UI_COLORS.ink.alert;
const TAG_PASSIVE_ACCENT_COLOR = MUCHA_UI_COLORS.surfaces.border;
const TAG_PASSIVE_ACCENT_X = 2;
const TAG_PASSIVE_ACCENT_Y = 2;
const TAG_PASSIVE_ACCENT_WIDTH = 4;
const TAG_PASSIVE_LABEL_X = TAG_LABEL_X + 2;
const TAG_ROLE_DIVIDER_COLOR = MUCHA_UI_COLORS.surfaces.borderSoft;
const TAG_ROLE_DIVIDER_INSET_X = 10;
const TAG_ROLE_DIVIDER_GAP = 12;

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
const REQUIREMENT_READY_PULSE_COLOR = 0x60c16f;
const REQUIREMENT_READY_PULSE_FREQ_HZ = 1.8;
const RECIPE_PRIORITY_BORDER = MUCHA_UI_COLORS.accents.gold;
const RECIPE_LOADING_COLOR = MUCHA_UI_COLORS.accents.gold;
const RECIPE_WORK_COLOR = MUCHA_UI_COLORS.accents.sage;
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
  skipped: {
    bgColor: TAG_PILL_BG_LOW,
    borderColor: TAG_PILL_BORDER_SKIPPED,
    textColor: TAG_PILL_TEXT,
    alpha: 0.95,
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

export function getHubRecipeRowSignature(systemId, rows) {
  return [
    systemId || "recipe",
    ...(Array.isArray(rows) ? rows : []).map((row) =>
      [
        row?.kind || "row",
        row?.recipeId || "",
        Number.isFinite(row?.index) ? row.index : "",
        Number.isFinite(row?.amount) ? row.amount : "",
        Number.isFinite(row?.duration) ? row.duration : "",
        row?.mode || "",
        row?.label || "",
      ].join(":")
    ),
  ].join("|");
}

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

  function getTagRoleVisualSpec(playerRole) {
    if (playerRole === "active") {
      return {
        shapeRadius: TAG_PILL_RADIUS,
        labelX: TAG_LABEL_X,
        accentColor: null,
        cursor: "grab",
      };
    }
    return {
      shapeRadius: TAG_PASSIVE_RADIUS,
      labelX: TAG_PASSIVE_LABEL_X,
      accentColor: TAG_PASSIVE_ACCENT_COLOR,
      cursor: "pointer",
    };
  }

  function getTagTitleFeedbackConfig(tagId) {
    const feedback = hubTagDefs?.[tagId]?.ui?.titleFeedback;
    return feedback && typeof feedback === "object" ? feedback : null;
  }

  function shouldHideAllSystemRowsForTag(tagId) {
    return getTagTitleFeedbackConfig(tagId)?.hideSystemRows === true;
  }

  function getHiddenSystemRowIdsForTag(tagId) {
    const hiddenSystemRowIds = getTagTitleFeedbackConfig(tagId)?.hiddenSystemRowIds;
    if (!Array.isArray(hiddenSystemRowIds) || hiddenSystemRowIds.length <= 0) {
      return new Set();
    }
    return new Set(
      hiddenSystemRowIds.filter(
        (systemId) => typeof systemId === "string" && systemId.length > 0
      )
    );
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

  function isRecipePriorityTag(tagId) {
    return tagId === "canCook" || tagId === "canCraft";
  }

  function clamp01(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
  }

  function getUiClockSec() {
    return getLiveUiTimeSec(getGameState?.() || null);
  }

  function getUiSecondPhase() {
    return clamp01(getUiClockSec() - Math.floor(getUiClockSec()));
  }

  function getFrameDtSec(frameCtx) {
    return Number.isFinite(frameCtx?.dtSec) ? Math.max(0, frameCtx.dtSec) : 0;
  }

  function shouldSnapFrame(frameCtx) {
    return frameCtx?.snap === true;
  }

  function resolveAnimatedRatio(holder, displayKey, targetRatio, frameCtx) {
    const target = clamp01(targetRatio);
    const current = Number.isFinite(holder?.[displayKey]) ? holder[displayKey] : target;
    const next = stepAnimatedRatio(current, target, getFrameDtSec(frameCtx), {
      snap: shouldSnapFrame(frameCtx),
      settleSec: 0.15,
    });
    holder[displayKey] = next;
    return next;
  }

  function resolveDisplayedRatio(holder, displayKey, targetRatio, frameCtx, opts = null) {
    if (opts?.live === true) {
      const target = clamp01(targetRatio);
      holder[displayKey] = target;
      return target;
    }
    return resolveAnimatedRatio(holder, displayKey, targetRatio, frameCtx);
  }

  function lerpChannel(from, to, ratio) {
    return Math.round(from + (to - from) * clamp01(ratio));
  }

  function lerpHexColor(fromColor, toColor, ratio) {
    const from = Number.isFinite(fromColor) ? Math.floor(fromColor) : 0;
    const to = Number.isFinite(toColor) ? Math.floor(toColor) : 0;
    const r = lerpChannel((from >> 16) & 0xff, (to >> 16) & 0xff, ratio);
    const g = lerpChannel((from >> 8) & 0xff, (to >> 8) & 0xff, ratio);
    const b = lerpChannel(from & 0xff, to & 0xff, ratio);
    return (r << 16) | (g << 8) | b;
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

  function isToolRequirement(req) {
    return req?.consume === false || req?.requirementType === "tool";
  }

  function formatRequirementStatusLine(req, progressOverride = null) {
    const required = Math.max(0, Math.floor(req?.amount ?? 0));
    const progress = Math.max(
      0,
      Math.floor(progressOverride ?? req?.progress ?? 0)
    );
    const label = formatRecipeRequirementLabel(req);
    if (isToolRequirement(req)) {
      return `${label}: ${progress >= required && required > 0 ? "Ready" : "Missing"}`;
    }
    return `${label}: ${progress}/${required}`;
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
      const requirementRows = reqs
        .map((req, index) => {
          const amount = Math.max(0, Math.floor(req?.amount ?? 0));
          if (amount <= 0) return null;
          const progress = Math.max(0, Math.floor(req?.progress ?? 0));
          return {
            kind: "recipeRequirement",
            recipeId,
            index,
            amount,
            progress,
            label: formatRecipeRequirementLabel(req),
            isTool: isToolRequirement(req),
          };
        })
        .filter(Boolean);
      if (requirementRows.length > 0) {
        return requirementRows;
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
    return getHubRecipeRowSignature(systemId, rows);
  }

  function areRequirementsSatisfied(requirements) {
    const reqs = Array.isArray(requirements) ? requirements : [];
    if (reqs.length <= 0) return false;
    for (const req of reqs) {
      const required = Math.max(0, Math.floor(req?.amount ?? 0));
      if (required <= 0) continue;
      const progress = Math.max(0, Math.floor(req?.progress ?? 0));
      if (progress < required) return false;
    }
    return true;
  }

  function getRequirementReadyRowColor(baseColor) {
    const pulsePhase =
      0.5 +
      0.5 *
        Math.sin(getUiClockSec() * REQUIREMENT_READY_PULSE_FREQ_HZ * Math.PI * 2);
    return lerpHexColor(baseColor, REQUIREMENT_READY_PULSE_COLOR, pulsePhase);
  }

  function getActiveRecipeProcessSnapshot(structure, systemId) {
    const activeProcess = getActiveRecipeProcess(structure, systemId);
    const activeRecipeId =
      typeof activeProcess?.type === "string" && activeProcess.type.length > 0
        ? activeProcess.type
        : null;
    return { activeProcess, activeRecipeId };
  }

  function hasRequirementsReadyForWork(requirements) {
    const reqs = Array.isArray(requirements) ? requirements : [];
    if (reqs.length <= 0) return true;
    return areRequirementsSatisfied(reqs);
  }

  function getStructureWorkerCount(structure) {
    const state = getGameState?.() || null;
    const pawns = Array.isArray(state?.pawns) ? state.pawns : [];
    const col = Number.isFinite(structure?.col) ? Math.floor(structure.col) : null;
    const span =
      Number.isFinite(structure?.span) && structure.span > 0
        ? Math.floor(structure.span)
        : 1;
    if (col == null) return 0;
    const maxCol = col + span - 1;
    let count = 0;
    for (const pawn of pawns) {
      if (!pawn || Number.isFinite(pawn.envCol)) continue;
      const pawnCol = Number.isFinite(pawn.hubCol) ? Math.floor(pawn.hubCol) : null;
      if (pawnCol == null || pawnCol < col || pawnCol > maxCol) continue;
      count += 1;
    }
    return count;
  }

  function getLiveRecipeWorkRuntime(structure, process, fallbackDuration = 1) {
    const progress = Math.max(0, Math.floor(process?.progress ?? 0));
    const duration = Math.max(
      1,
      Math.floor(process?.durationSec ?? fallbackDuration ?? 1)
    );
    const mode = process?.mode === "time" ? "time" : "work";
    let ratio = duration > 0 ? progress / duration : 0;

    if (
      mode === "work" &&
      hasRequirementsReadyForWork(process?.requirements) &&
      progress < duration
    ) {
      const workers = getStructureWorkerCount(structure);
      if (workers > 0) {
        const uiTimeSec = getUiClockSec();
        const frac = clamp01(uiTimeSec - Math.floor(uiTimeSec));
        const liveProgress = Math.min(duration, progress + frac * workers);
        ratio = duration > 0 ? liveProgress / duration : ratio;
      }
    }

    return { progress, duration, mode, ratio: clamp01(ratio) };
  }

  function getLiveRecipeCycleRuntime(structure, systemId, process, fallbackDuration = 1) {
    const progress = Math.max(0, Math.floor(process?.progress ?? 0));
    const duration = Math.max(
      1,
      Math.floor(process?.durationSec ?? fallbackDuration ?? 1)
    );
    const mode = process?.mode === "time" ? "time" : "work";
    const state = getGameState?.() || null;
    const processDef = state
      ? getProcessDefForInstance(process, structure, {
          leaderId: process?.leaderId ?? null,
        })
      : null;
    const availability = state && processDef
      ? evaluateProcessRequirementAvailability({
          state,
          target: structure,
          process,
          processDef,
          context: { leaderId: process?.leaderId ?? null },
        })
      : null;
    const requirementRows = Array.isArray(availability?.requirements)
      ? availability.requirements
      : [];

    const workerCount = mode === "work" ? getStructureWorkerCount(structure) : 1;
    let remainingBudget = getUiSecondPhase() * Math.max(0, workerCount);

    const requirementRuntimes = [];
    let totalRequired = 0;
    let totalLoaded = 0;
    let allReadyAfterBudget = true;

    const reqs = Array.isArray(process?.requirements) ? process.requirements : [];
    for (let index = 0; index < reqs.length; index += 1) {
      const req = reqs[index];
      const required = Math.max(0, Math.floor(req?.amount ?? 0));
      const loaded = Math.min(required, Math.max(0, Math.floor(req?.progress ?? 0)));
      const isTool = isToolRequirement(req);
      const accessibleTotal = Math.max(
        0,
        Math.floor(requirementRows[index]?.accessibleTotal ?? loaded)
      );
      if (isTool) {
        const liveLoaded = Math.min(required, accessibleTotal);
        if (liveLoaded + 0.0001 < required) {
          allReadyAfterBudget = false;
        }
        requirementRuntimes.push({
          required,
          progress: loaded,
          liveProgress: liveLoaded,
          ratio: required > 0 ? liveLoaded / required : 0,
          isTool: true,
          isReady: liveLoaded >= required && required > 0,
        });
        continue;
      }
      const reachable = Math.max(
        0,
        Math.floor(requirementRows[index]?.reachableFromInputs ?? 0)
      );
      const needed = Math.max(0, required - loaded);
      const liveSpend = Math.min(needed, reachable, remainingBudget);
      const liveLoaded = loaded + liveSpend;
      remainingBudget = Math.max(0, remainingBudget - liveSpend);
      totalRequired += required;
      totalLoaded += Math.min(required, liveLoaded);
      if (liveLoaded + 0.0001 < required) {
        allReadyAfterBudget = false;
      }
      requirementRuntimes.push({
        required,
        progress: loaded,
        liveProgress: liveLoaded,
        ratio: required > 0 ? liveLoaded / required : 0,
      });
    }

    let liveWorkProgress = progress;
    if (allReadyAfterBudget) {
      liveWorkProgress = Math.min(duration, progress + remainingBudget);
    }

    return {
      progress,
      duration,
      mode,
      requirementRuntimes,
      loadingRatio: totalRequired > 0 ? totalLoaded / totalRequired : 1,
      allRequirementsReady: allReadyAfterBudget,
      workRatio: duration > 0 ? liveWorkProgress / duration : 0,
    };
  }

  function getLiveProcessRuntime(process, opts = {}) {
    const progress = Math.max(0, Math.floor(process?.progress ?? 0));
    const duration = Math.max(
      1,
      Math.floor(process?.durationSec ?? opts?.fallbackDuration ?? 1)
    );
    const mode = process?.mode === "time" ? "time" : "work";
    let ratio = duration > 0 ? progress / duration : 0;
    if (progress < duration) {
      if (mode === "time") {
        ratio = (progress + getUiSecondPhase()) / duration;
      } else if ((opts?.workerCount ?? 0) > 0) {
        ratio = (progress + getUiSecondPhase() * opts.workerCount) / duration;
      }
    }
    return { progress, duration, mode, ratio: clamp01(ratio) };
  }

  function getRecipeRequirementRowRuntime(structure, systemId, row, allowLive = true) {
    const { activeProcess, activeRecipeId } = getActiveRecipeProcessSnapshot(
      structure,
      systemId
    );

    if (activeProcess && activeRecipeId === row.recipeId) {
      const cycleRuntime = allowLive
        ? getLiveRecipeCycleRuntime(
            structure,
            systemId,
            activeProcess,
            row.recipeReqAmount ?? 1
          )
        : null;
      const requirementRuntime = cycleRuntime?.requirementRuntimes[row.recipeReqIndex] || null;
      const req = Array.isArray(activeProcess.requirements)
        ? activeProcess.requirements[row.recipeReqIndex]
        : null;
      const required = Math.max(
        0,
        Math.floor(requirementRuntime?.required ?? req?.amount ?? row.recipeReqAmount ?? 0)
      );
      const progress = Math.max(0, Math.floor(req?.progress ?? 0));
      const label = row.recipeLabel || formatRecipeRequirementLabel(req) || "Material";
      const liveProgress = Math.max(
        progress,
        Math.floor(requirementRuntime?.liveProgress ?? progress)
      );
      const isTool = requirementRuntime?.isTool === true || isToolRequirement(req);
      return {
        required,
        progress,
        liveRatio: clamp01(
          requirementRuntime?.ratio ?? (required > 0 ? liveProgress / required : 0)
        ),
        liveProgress,
        label,
        isTool,
        isReady:
          requirementRuntime?.isReady === true ||
          (required > 0 && liveProgress >= required),
        allRequirementsReady: allowLive
          ? cycleRuntime?.allRequirementsReady === true
          : areRequirementsSatisfied(activeProcess.requirements),
      };
    }

    const recipeDef = row.recipeId ? recipeDefs?.[row.recipeId] || null : null;
    const req = Array.isArray(recipeDef?.inputs)
      ? recipeDef.inputs[row.recipeReqIndex]
      : null;
    const required = Math.max(
      0,
      Math.floor(req?.qty ?? req?.amount ?? row.recipeReqAmount ?? 0)
    );
    const label = row.recipeLabel || formatRecipeRequirementLabel(req) || "Material";
    return {
      required,
      progress: 0,
      liveRatio: 0,
      liveProgress: 0,
      label,
      isTool: !!row.recipeReqIsTool,
      isReady: false,
      allRequirementsReady: false,
    };
  }

  function getRecipeLaborRowRuntime(structure, systemId, row, allowLive = true) {
    const { activeProcess, activeRecipeId } = getActiveRecipeProcessSnapshot(
      structure,
      systemId
    );
    if (activeProcess && activeRecipeId === row.recipeId) {
      const cycleRuntime = allowLive
        ? getLiveRecipeCycleRuntime(
            structure,
            systemId,
            activeProcess,
            row.recipeDuration ?? 1
          )
        : null;
      return {
        progress: Math.max(0, Math.floor(activeProcess.progress ?? 0)),
        duration: Math.max(
          1,
          Math.floor(activeProcess.durationSec ?? row.recipeDuration ?? 1)
        ),
        mode: activeProcess.mode === "time" ? "time" : "work",
        ratio: clamp01(
          cycleRuntime?.workRatio ??
            (Math.max(1, Math.floor(activeProcess.durationSec ?? row.recipeDuration ?? 1)) > 0
              ? Math.max(0, Math.floor(activeProcess.progress ?? 0)) /
                Math.max(1, Math.floor(activeProcess.durationSec ?? row.recipeDuration ?? 1))
              : 0)
        ),
      };
    }
    return {
      progress: 0,
      duration: Math.max(1, Math.floor(row.recipeDuration ?? 1)),
      mode: row.recipeMode === "time" ? "time" : "work",
      ratio: 0,
    };
  }

  function resolveProcessFeedback(structure, process, fallbackLabel, color) {
    if (!process || typeof process !== "object") {
      return {
        ratio: 0,
        color,
        live: false,
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
        live: false,
        tooltipLines: [
          `Status: ${fallbackLabel} loading`,
          `${label}: ${progress}/${required}`,
        ],
      };
    }

    const workerCount = Math.max(0, getStructureWorkerCount(structure));
    const runtime = getLiveProcessRuntime(process, {
      workerCount,
      fallbackDuration: 1,
    });
    return {
      ratio: runtime.ratio,
      color,
      live: true,
      tooltipLines: [`Status: ${fallbackLabel} ${runtime.progress}/${runtime.duration}`],
    };
  }

  function resolveRecipeTitleFeedback(structure, systemId, allowLive = true) {
    const color = RECIPE_LOADING_COLOR;
    const { activeProcess, activeRecipeId } = getActiveRecipeProcessSnapshot(
      structure,
      systemId
    );
    const topRecipeId = getTopRecipeIdForSystem(structure, systemId);

    if (activeProcess && activeRecipeId) {
      const cycleRuntime = allowLive
        ? getLiveRecipeCycleRuntime(
            structure,
            systemId,
            activeProcess,
            1
          )
        : null;
      const workRuntime = {
        progress: Math.max(0, Math.floor(activeProcess.progress ?? 0)),
        duration: Math.max(1, Math.floor(activeProcess.durationSec ?? 1)),
        ratio: clamp01(
          cycleRuntime?.workRatio ??
            (Math.max(1, Math.floor(activeProcess.durationSec ?? 1)) > 0
              ? Math.max(0, Math.floor(activeProcess.progress ?? 0)) /
                Math.max(1, Math.floor(activeProcess.durationSec ?? 1))
              : 0)
        ),
      };
      const progress = workRuntime.progress;
      const duration = workRuntime.duration;
      const requirements = Array.isArray(activeProcess.requirements)
        ? activeProcess.requirements
        : [];
      const requirementLines = [];
      const toolLines = [];
      let totalRequired = 0;
      let totalLoaded = 0;
      for (let index = 0; index < requirements.length; index += 1) {
        const req = requirements[index];
        const required = Math.max(0, Math.floor(req?.amount ?? 0));
        if (required <= 0) continue;
        const runtime = cycleRuntime?.requirementRuntimes?.[index] || null;
        const liveProgress = Math.max(
          0,
          Math.floor(runtime?.liveProgress ?? req?.progress ?? 0)
        );
        if (isToolRequirement(req)) {
          toolLines.push(formatRequirementStatusLine(req, liveProgress));
          continue;
        }
        totalRequired += required;
        totalLoaded += Math.min(required, liveProgress);
        requirementLines.push(formatRequirementStatusLine(req, liveProgress));
      }
      return {
        ratio: clamp01(
          totalRequired > 0
            ? totalLoaded / totalRequired
            : 0
        ),
        color,
        workRatio: workRuntime.ratio,
        workColor: RECIPE_WORK_COLOR,
        workAlpha: TAG_TITLE_FILL_ALPHA,
        workLive: allowLive,
        tooltipLines: [
          `Recipe: ${formatRecipeName(activeRecipeId)}`,
          totalRequired > 0 ? `Loading: ${totalLoaded}/${totalRequired}` : "Loading: ready",
          `${formatRecipeModeLabel(activeProcess.mode)}: ${progress}/${duration}`,
          ...requirementLines,
          ...toolLines,
        ],
      };
    }

    if (!topRecipeId) {
      return {
        ratio: 0,
        color,
        tooltipLines: ["Status: no recipe selected"],
      };
    }

    const recipeDef = recipeDefs?.[topRecipeId] || null;
    const inputs = Array.isArray(recipeDef?.inputs) ? recipeDef.inputs : [];
    const tools = Array.isArray(recipeDef?.toolRequirements)
      ? recipeDef.toolRequirements
      : [];
    let totalRequired = 0;
    const requirementLines = inputs
      .map((req) => {
        const required = Math.max(0, Math.floor(req?.qty ?? req?.amount ?? 0));
        if (required <= 0) return null;
        totalRequired += required;
        return `${formatRecipeRequirementLabel(req)}: 0/${required}`;
      })
      .filter(Boolean);
    const toolLines = tools
      .map((req) => formatRequirementStatusLine({ ...req, consume: false, requirementType: "tool" }, 0))
      .filter(Boolean);
    return {
      ratio: 0,
      color,
      workRatio: 0,
      workColor: RECIPE_WORK_COLOR,
      workAlpha: TAG_TITLE_FILL_ALPHA,
      workLive: false,
      tooltipLines: [
        `Recipe: ${formatRecipeName(topRecipeId)}`,
        totalRequired > 0 ? `Loading: 0/${totalRequired}` : "Loading: ready",
        "Status: waiting to start",
        ...requirementLines,
        ...toolLines,
      ],
    };
  }

  function getPreviewStructureForExecution(structure, tags) {
    const preview = getStructurePreview(structure);
    if (!preview) return structure;

    const nextStructure = {
      ...structure,
      tags: Array.isArray(tags)
        ? tags.slice()
        : Array.isArray(structure?.tags)
          ? structure.tags.slice()
          : [],
    };
    const nextSystemState = { ...(structure?.systemState || {}) };
    for (const systemId of ["cook", "craft", "growth"]) {
      const resolved = getRecipeSystemState(structure, systemId);
      if (resolved !== structure?.systemState?.[systemId]) {
        nextSystemState[systemId] = resolved;
      }
    }
    nextStructure.systemState = nextSystemState;
    return nextStructure;
  }

  function getStructureTagStatusPreview(structure, tags) {
    const state = getGameState?.() || null;
    const previewStructure = getPreviewStructureForExecution(structure, tags);
    return getHubTagExecutionPreview({
      state,
      structure: previewStructure,
      tags,
      isTagDisabled,
      isTagUnlocked,
    });
  }

  function formatTagExecutionStatus(status) {
    if (!status || status.disabled) return "Status: disabled";
    if (status.active || status.passiveActive) return "Status: active";
    if (status.skipped) {
      const reason =
        status.skipReason === "requirements"
          ? "requirements"
          : status.skipReason === "cost"
            ? "cost"
            : status.skipReason === "effect"
              ? "effect"
              : "gating";
      return `Status: skipped (${reason})`;
    }
    return "Status: idle";
  }

  function getTagTitleFeedback(entry, structure, tagStatus = null) {
    const config = getTagTitleFeedbackConfig(entry?.tagId);
    if (!config) return null;
    const allowLive = tagStatus?.active === true || tagStatus?.passiveActive === true;
    if (entry?.tagId === "build") {
      return {
        fillMode: "bar",
        alpha: TAG_TITLE_FILL_ALPHA,
        ...resolveProcessFeedback(
          structure,
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
        ...resolveRecipeTitleFeedback(structure, config.holderSystemId, allowLive),
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
    const tags = getStructureTags(structure);
    const preview = getStructureTagStatusPreview(structure, tags);
    const tagStatus = preview?.statusById?.[entry.tagId] || null;
    lines.push(formatTagExecutionStatus(tagStatus));
    const feedback = getTagTitleFeedback(entry, structure, tagStatus);
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
    const visibleTags = tags.filter(
      (tagId) =>
        isTagUnlocked(tagId) &&
        !isTagHidden(structure, tagId) &&
        !isTagPlayerDisabled(structure, tagId)
    );
    return normalizeVisibleHubTagOrder(visibleTags);
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

  function buildSystemTooltipSpec(structure, row) {
    const systemId = row?.systemId;
    if (!systemId) return null;

    if (systemId === "storage") {
      const info = getDepositPoolInfo(structure);
      const pool = info?.pool;
      if (!pool || typeof pool !== "object") return null;
      const itemId = row?.storageItemId ?? null;
      const totals = getStorageTotals(pool, itemId);
      return {
        title: row?.storageLabel || "Storage",
        lines: [
          `Total: ${totals.total}`,
          `Bronze: ${totals.byTier.bronze}`,
          `Silver: ${totals.byTier.silver}`,
          `Gold: ${totals.byTier.gold}`,
          `Diamond: ${totals.byTier.diamond}`,
        ],
      };
    }

    const lines = [];
    const systemDef = hubSystemDefs?.[systemId];
    if (systemDef?.ui?.description) {
      lines.push(systemDef.ui.description);
    }

    if (systemId === "residents") {
      const residents = structure?.systemState?.residents || {};
      const population = Math.max(0, Math.floor(residents.population ?? 0));
      const capacity = Math.max(0, Math.floor(residents.housingCapacity ?? 0));
      const tier = formatTierLabel(structure?.systemTiers?.residents);
      lines.push(`Tier: ${tier}`);
      lines.push(`Population: ${population}`);
      lines.push(`Housing capacity: ${capacity}`);
      return {
        title: getSystemUi(systemId).label,
        lines,
      };
    }

    if (systemId === "faith") {
      const tier = typeof structure?.systemTiers?.faith === "string"
        ? structure.systemTiers.faith
        : "bronze";
      const tracker = getGameState?.()?.populationTracker || {};
      const streak = Math.max(0, Math.floor(tracker?.faithGrowthStreak ?? 0));
      const threshold = getFaithThreshold();
      lines.push(`Tier: ${formatTierLabel(tier)}`);
      lines.push(`Growth streak: ${streak}/${threshold}`);
      return {
        title: "Faith",
        lines,
      };
    }

    if (systemId === "build") {
      const process = getBuildProcess(structure);
      const tier = formatTierLabel(structure?.systemTiers?.build);
      lines.push(`Tier: ${tier}`);
      if (!process) {
        lines.push("Progress: idle");
        return { title: "Build", lines };
      }
      const reqs = Array.isArray(process.requirements) ? process.requirements : [];
      if (reqs.length > 0) {
        lines.push("Materials:");
        for (const req of reqs) {
          const required = Math.max(0, Math.floor(req?.amount ?? 0));
          const progress = Math.max(0, Math.floor(req?.progress ?? 0));
          lines.push(`${formatBuildRequirementLabel(req)}: ${progress}/${required}`);
        }
      }
      lines.push(
        `Labor: ${Math.max(0, Math.floor(process.progress ?? 0))}/${Math.max(
          1,
          Math.floor(process.durationSec ?? 1)
        )}`
      );
      return { title: "Build", lines };
    }

    if (isRecipeSystem(systemId)) {
      const recipeContext = resolveRecipeContextForTag(
        systemId === "cook" ? "canCook" : "canCraft",
        structure
      );
      const recipeId = recipeContext?.recipeId ?? null;
      if (recipeId) {
        lines.push(`Recipe: ${formatRecipeName(recipeId)}`);
        const outputLine = formatRecipeOutputLine(recipeId);
        if (outputLine) lines.push(outputLine);
      }
      const activeProcess = recipeContext?.activeProcess ?? null;
      const reqs = Array.isArray(activeProcess?.requirements)
        ? activeProcess.requirements
        : [];
      if (reqs.length > 0) {
        const materialLines = [];
        const toolLines = [];
        for (const req of reqs) {
          const line = formatRequirementStatusLine(req);
          if (isToolRequirement(req)) toolLines.push(line);
          else materialLines.push(line);
        }
        if (materialLines.length > 0) lines.push("Materials:", ...materialLines);
        if (toolLines.length > 0) lines.push("Tools:", ...toolLines);
      }
      return {
        title: getSystemUi(systemId).label,
        lines,
      };
    }

    if (lines.length <= 0) return null;
    return {
      title: getSystemUi(systemId).label,
      lines,
    };
  }

  function showTooltipForSystem(structure, row, bounds, scale = 1) {
    if (!tooltipView || interaction?.canShowWorldHoverUI?.() === false) return;
    const spec = buildSystemTooltipSpec(structure, row);
    if (!spec || !Array.isArray(spec.lines) || spec.lines.length <= 0) return;
    const anchor =
      bounds?.displayObject
        ? tooltipView.getAnchorRectForDisplayObject?.(bounds.displayObject, "parent") ??
          null
        : bounds;
    tooltipView.show(
      makeDefTooltipSpec({
        def: hubSystemDefs[row?.systemId],
        title: spec.title || getSystemUi(row?.systemId).label,
        lines: spec.lines,
        accentColor: getSystemUi(row?.systemId).color,
        sourceKind: "hubSystem",
        sourceId: row?.systemId ?? null,
        scale,
      }),
      anchor
    );
  }

  function showTooltipForTag(view, entry, structure, row, scale = 1) {
    if (!tooltipView || interaction?.canShowWorldHoverUI?.() === false) return;
    const tagId = entry?.tagId;
    const lines = buildTagHoverLines(view, entry, structure);
    if (!Array.isArray(lines) || lines.length <= 0) return;
    tooltipView.show(
      makeDefTooltipSpec({
        def: hubTagDefs[tagId],
        title: getTagLabel(tagId),
        lines,
        accentColor: MUCHA_UI_COLORS.accents.gold,
        sourceKind: "hubTag",
        sourceId: tagId ?? null,
        scale,
      }),
      tooltipView.getAnchorRectForDisplayObject?.(row, "parent") ?? null
    );
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
      return reqs.map((req, index) => ({
        kind: "requirement",
        index,
        label: formatBuildRequirementLabel(req),
      }));
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
    const roleSpec = getTagRoleVisualSpec(entry.playerRole);
    const bgColor = style.bgColor ?? TAG_PILL_BG_LOW;
    const borderColor = style.borderColor ?? TAG_PILL_BORDER_LOW;
    const textColor = style.textColor ?? TAG_PILL_TEXT;
    const alpha = style.alpha ?? 1;
    const rowScale = style.rowScale ?? 1;
    const bgRenderKey = [
      bgColor,
      borderColor,
      roleSpec.shapeRadius,
      roleSpec.accentColor ?? "none",
    ].join("|");

    if (entry.bgRenderKey !== bgRenderKey) {
      entry.bg.clear();
      entry.bg
        .lineStyle(1, borderColor, 0.9)
        .beginFill(bgColor, 0.95)
        .drawRoundedRect(0, 0, TAG_PILL_WIDTH, TAG_PILL_HEIGHT, roleSpec.shapeRadius)
        .endFill();
      entry.passiveAccent.clear();
      if (roleSpec.accentColor != null) {
        entry.passiveAccent
          .beginFill(roleSpec.accentColor, 0.98)
          .drawRoundedRect(
            TAG_PASSIVE_ACCENT_X,
            TAG_PASSIVE_ACCENT_Y,
            TAG_PASSIVE_ACCENT_WIDTH,
            Math.max(1, TAG_PILL_HEIGHT - TAG_PASSIVE_ACCENT_Y * 2),
            2
          )
          .endFill();
      }
      entry.bgRenderKey = bgRenderKey;
    }

    if (entry.labelText?.style?.fill !== textColor) {
      entry.labelText.style.fill = textColor;
      entry.labelText.dirty = true;
    }
    entry.labelText.x = roleSpec.labelX;
    entry.container.alpha = alpha;
    entry.row.cursor = roleSpec.cursor;

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

  function setSystemRowLayout(row, mode = "bar") {
    if (!row || row.layoutMode === mode) return;
    row.layoutMode = mode;
    if (mode === "badge") {
      row.labelText.anchor.set(0, 0.5);
      row.labelText.x = row.barX + 4;
    } else {
      row.labelText.anchor.set(0.5, 0.5);
      row.labelText.x = row.barX + Math.floor(row.barWidth / 2);
    }
  }

  function clearSystemRowBadge(row) {
    if (!row?.badgeBg || !row?.badgeText) return;
    row.badgeBg.clear();
    row.badgeText.text = "";
  }

  function renderSystemRowBar(row, label, ratio, color, frameCtx = null, opts = null) {
    setSystemRowLayout(row, "bar");
    clearSystemRowBadge(row);
    const displayRatio = resolveDisplayedRatio(
      row,
      "displayRatio",
      ratio,
      frameCtx,
      opts
    );
    const ratioKey = quantizeSystemBarRatio(displayRatio);
    const renderKey = `bar|${color}|${ratioKey}|${label}`;
    if (row.lastBarRenderKey === renderKey) return;
    setSystemRowLabel(row, label);
    drawSystemBar(row, ratioKey / SYSTEM_BAR_RATIO_QUANT, color);
    row.lastBarRenderKey = renderKey;
  }

  function renderSystemRowBadge(row, label, badgeLabel, badgeColor, badgeBorderColor) {
    setSystemRowLayout(row, "badge");
    row.barFill.clear();
    setSystemRowLabel(row, label);
    const safeBadgeLabel = String(badgeLabel || "");
    const renderKey = `badge|${label}|${safeBadgeLabel}|${badgeColor}|${badgeBorderColor}`;
    if (row.lastBarRenderKey === renderKey) return;
    row.badgeBg.clear();
    row.badgeText.text = safeBadgeLabel;
    row.badgeText.style.fill = SYSTEM_BAR_TEXT;
    row.badgeText.dirty = true;
    const badgePadX = 5;
    const badgeWidth = Math.max(28, Math.ceil(row.badgeText.width) + badgePadX * 2);
    const badgeHeight = row.barHeight + 4;
    const badgeX = row.barX + row.barWidth - badgeWidth - 2;
    const badgeY = row.barY - 2;
    row.badgeBg
      .lineStyle(1, badgeBorderColor, 0.95)
      .beginFill(badgeColor, 0.95)
      .drawRoundedRect(
        badgeX,
        badgeY,
        badgeWidth,
        badgeHeight,
        Math.max(4, row.barRadius)
      )
      .endFill();
    row.badgeText.anchor.set(0.5, 0.5);
    row.badgeText.x = badgeX + Math.floor(badgeWidth / 2);
    row.badgeText.y = badgeY + Math.floor(badgeHeight / 2);
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

  function renderFaithRow(structure, row, frameCtx = null) {
    const tier = typeof structure?.systemTiers?.faith === "string"
      ? structure.systemTiers.faith
      : "bronze";
    const tierIndex = getFaithTierIndex(tier);
    const tracker = getGameState?.()?.populationTracker || {};
    const streak = Math.max(0, Math.floor(tracker?.faithGrowthStreak ?? 0));
    const threshold = getFaithThreshold();
    const ratio = clamp01(streak / threshold);
    const displayRatio = resolveAnimatedRatio(row, "displayRatio", ratio, frameCtx);
    const label = `${formatTierLabel(tier)} ${streak}/${threshold}`;
    const renderKey = `faith|${tier}|${quantizeSystemBarRatio(displayRatio)}|${label}`;
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
    if (displayRatio > 0) {
      row.barFill.beginFill(MUCHA_UI_COLORS.intent.alertPop, 0.9);
      row.barFill.drawRect(
        row.barX,
        progressY,
        Math.max(1, Math.floor(row.barWidth * displayRatio)),
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
    const badgeBg = new PIXI.Graphics();
    container.addChild(barBg, barFill, badgeBg);

    const labelText = new PIXI.Text("", {
      fill: SYSTEM_BAR_TEXT,
      fontSize: 9,
    });
    labelText.anchor.set(0.5, 0.5);
    labelText.x = barX + Math.floor(barWidth / 2);
    labelText.y = barY + Math.floor(barHeight / 2);
    container.addChild(labelText);

    const badgeText = new PIXI.Text("", {
      fill: SYSTEM_BAR_TEXT,
      fontSize: 8,
      fontWeight: "bold",
    });
    applyTextResolution(badgeText, 1.5);
    badgeText.anchor.set(0.5, 0.5);
    container.addChild(badgeText);

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
      badgeBg,
      badgeText,
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
      recipeReqIsTool: opts?.isTool === true,
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
      layoutMode: "bar",
    };

    icon.on("pointerover", () => {
      setChildTooltipHoverActive(view, true);
      onSystemIconHover?.(view, processWidgetSystemId);
      showTooltipForSystem(
        view.structure,
        row,
        { displayObject: icon },
        tooltipView?.getRelativeDisplayScale?.(icon, 1) ??
          getDisplayObjectWorldScale(icon, 1)
      );
    });
    icon.on("pointerout", () => {
      setChildTooltipHoverActive(view, false);
      onSystemIconOut?.(view, processWidgetSystemId);
      tooltipView?.hide?.();
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
    const playerRole = getHubTagPlayerRole(tagId);
    const dragEnabled = isHubTagPlayerActive(tagId);
    const processWidgetSystemId = resolveProcessWidgetSystemIdForTagSystems(
      systems,
      tagId
    );
    const actionMode = processWidgetSystemId ? "cog" : "none";
    const hideSystemRows = shouldHideAllSystemRowsForTag(tagId);
    const hiddenSystemRowIds = getHiddenSystemRowIdsForTag(tagId);

    const container = new PIXI.Container();
    const row = new PIXI.Container();
    row.eventMode = "static";
    row.cursor = dragEnabled ? "grab" : "pointer";
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

    const titleFillSecondary = new PIXI.Graphics();
    row.addChild(titleFillSecondary);

    const titleFlash = new PIXI.Graphics();
    row.addChild(titleFlash);

    const passiveAccent = new PIXI.Graphics();
    row.addChild(passiveAccent);

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
      const visibleSystems = systems.filter(
        (systemId) => !hiddenSystemRowIds.has(systemId)
      );
      const firstRecipeSystemId = visibleSystems.find((systemId) =>
        isRecipeSystem(systemId)
      );
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
        for (const systemId of visibleSystems) {
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
      titleFillSecondary,
      titleFlash,
      passiveAccent,
      bgRenderKey: "",
      labelText,
      actionControl,
      actionBg,
      actionIcon,
      actionMode,
      lastActionVisualKey: null,
      playerRole,
      dragEnabled,
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
      showTooltipForTag(
        view,
        entry,
        structure,
        row,
        tooltipView?.getRelativeDisplayScale?.(row, 1) ??
          getDisplayObjectWorldScale(row, 1)
      );
    });
    row.on("pointerout", () => {
      setChildTooltipHoverActive(view, false);
      tooltipView?.hide?.();
    });
    row.on("pointerdown", (ev) => {
      if (view.ignoreNextTagTap) view.ignoreNextTagTap = false;
      ev?.stopPropagation?.();
      if (!entry.dragEnabled) return;
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
    const dragState = view.tagDrag || null;
    const activeEntryCount = entries.filter(
      (entry) => entry?.playerRole === "active"
    ).length;
    const passiveEntryCount = entries.length - activeEntryCount;
    const showRoleDivider = activeEntryCount > 0 && passiveEntryCount > 0;
    const roleDivider = view.roleDivider || null;
    let totalContentHeight = 0;
    let expandedContentBottomY = 0;
    let entryIndex = 0;
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
      totalContentHeight += entryHeight;
      entryIndex += 1;
      if (entryIndex < entries.length) {
        totalContentHeight +=
          showRoleDivider && entryIndex === activeEntryCount
            ? TAG_ROLE_DIVIDER_GAP
            : TAG_PILL_GAP;
      }
      if (entry.expanded) {
        expandedContentBottomY = Math.max(expandedContentBottomY, totalContentHeight);
      }
    }

    const orderedEntries = dragState
      ? entries.filter((entry) => entry && entry !== dragState.entry)
      : entries.slice();
    if (dragState?.entry) {
      const maxInsertIndex =
        dragState.entry?.playerRole === "active"
          ? Math.max(0, activeEntryCount - 1)
          : orderedEntries.length;
      const insertIndex = Math.max(
        0,
        Math.min(orderedEntries.length, Math.min(maxInsertIndex, dragState.targetIndex))
      );
      orderedEntries.splice(insertIndex, 0, null);
    }

    let y = 0;
    let orderedIndex = 0;
    let dividerY = null;
    for (const entry of orderedEntries) {
      const slotHeight =
        entry === null
          ? dragState?.entry?.height ?? TAG_PILL_HEIGHT
          : entry?.height ?? TAG_PILL_HEIGHT;
      if (entry === null) {
        y += slotHeight;
      } else if (entry) {
        entry.container.visible = true;
        entry.container.x = 0;
        if (dragState?.entry !== entry) {
          entry.container.y = y;
        }
        y += slotHeight;
      }
      orderedIndex += 1;
      if (orderedIndex < orderedEntries.length) {
        const gapAfterEntry =
          showRoleDivider && orderedIndex === activeEntryCount
            ? TAG_ROLE_DIVIDER_GAP
            : TAG_PILL_GAP;
        if (showRoleDivider && orderedIndex === activeEntryCount) {
          dividerY = y + gapAfterEntry * 0.5;
        }
        y += gapAfterEntry;
      }
    }

    if (roleDivider) {
      roleDivider.clear();
      roleDivider.visible = false;
      if (showRoleDivider && Number.isFinite(dividerY)) {
        roleDivider
          .lineStyle(1, TAG_ROLE_DIVIDER_COLOR, 0.95)
          .moveTo(TAG_ROLE_DIVIDER_INSET_X, dividerY)
          .lineTo(TAG_PILL_WIDTH - TAG_ROLE_DIVIDER_INSET_X, dividerY);
        roleDivider.visible = true;
      }
    }
    view.totalContentHeight = Math.max(0, totalContentHeight);
    view.expandedContentBottomY = Math.max(0, expandedContentBottomY);
    return {
      totalContentHeight: view.totalContentHeight,
      expandedContentBottomY: view.expandedContentBottomY,
    };
  }

  function renderTagPillFeedback(entry, feedback, frameCtx = null) {
    if (!entry?.titleFill || !entry?.titleFillSecondary || !entry?.titleFlash) return;
    const targetRatio = clamp01(
      feedback?.fillMode === "full" ? 1 : feedback?.ratio ?? 0
    );
    const ratio =
      feedback?.fillMode === "full"
        ? targetRatio
        : resolveDisplayedRatio(
            entry,
            "displayFillRatio",
            targetRatio,
            frameCtx,
            { live: feedback?.live === true }
          );
    const fillAlpha = clamp01(feedback?.alpha ?? 0);
    const fillColor = Number.isFinite(feedback?.color) ? Math.floor(feedback.color) : 0;
    const secondaryTargetRatio = clamp01(feedback?.workRatio ?? 0);
    const secondaryRatio = resolveDisplayedRatio(
      entry,
      "displaySecondaryFillRatio",
      secondaryTargetRatio,
      frameCtx,
      { live: feedback?.workLive === true || feedback?.fillMode === "full" }
    );
    const secondaryAlpha = clamp01(feedback?.workAlpha ?? 0);
    const secondaryColor = Number.isFinite(feedback?.workColor)
      ? Math.floor(feedback.workColor)
      : 0;
    const renderKey = [
      Math.round(ratio * 100),
      Math.round(fillAlpha * 100),
      fillColor,
      Math.round(secondaryRatio * 100),
      Math.round(secondaryAlpha * 100),
      secondaryColor,
    ].join("|");
    if (entry.lastTitleFeedbackKey === renderKey) return;
    entry.lastTitleFeedbackKey = renderKey;

    const x = TAG_TITLE_FILL_INSET;
    const y = TAG_TITLE_FILL_INSET;
    const maxWidth = Math.max(0, TAG_PILL_WIDTH - TAG_TITLE_FILL_INSET * 2);
    const width = Math.max(0, Math.floor(maxWidth * ratio));
    const height = Math.max(0, TAG_PILL_HEIGHT - TAG_TITLE_FILL_INSET * 2);
    const baseRadius =
      entry?.playerRole === "active" ? TAG_PILL_RADIUS : TAG_PASSIVE_RADIUS;
    const radius = Math.max(1, baseRadius - TAG_TITLE_FILL_INSET);

    entry.titleFill.clear();
    if (fillAlpha > 0 && width > 0 && height > 0) {
      entry.titleFill
        .beginFill(fillColor, fillAlpha)
        .drawRoundedRect(x, y, width, height, radius)
        .endFill();
    }
    entry.titleFillSecondary.clear();
    const secondaryWidth = Math.max(0, Math.floor(maxWidth * secondaryRatio));
    if (secondaryAlpha > 0 && secondaryWidth > 0 && height > 0) {
      entry.titleFillSecondary
        .beginFill(secondaryColor, secondaryAlpha)
        .drawRoundedRect(x, y, secondaryWidth, height, radius)
        .endFill();
    }
    entry.titleFlash.clear();
  }

  function updateSystemRow(structure, row, frameCtx = null, opts = null) {
    if (!row) return;
    const systemId = row.systemId;
    if (!systemId) return;
    const allowLive = opts?.allowLive === true;

    if (systemId === "build") {
      const process = getBuildProcess(structure);
      if (!process) {
        renderSystemRowBar(row, "Build", 0, row.uiColor, frameCtx);
        return;
      }
      if (row.buildKind === "requirement") {
        const req = Array.isArray(process.requirements)
          ? process.requirements[row.buildReqIndex]
          : null;
        if (!req) {
          renderSystemRowBar(
            row,
            row.buildLabel || "Material",
            0,
            row.uiColor,
            frameCtx
          );
          return;
        }
        const required = Math.max(0, Math.floor(req.amount ?? 0));
        const progress = Math.max(0, Math.floor(req.progress ?? 0));
        const ratio = required > 0 ? progress / required : 0;
        const label = row.buildLabel || formatBuildRequirementLabel(req);
        const allRequirementsReady = areRequirementsSatisfied(process.requirements);
        const color = allRequirementsReady
          ? getRequirementReadyRowColor(row.uiColor)
          : row.uiColor;
        renderSystemRowBar(
          row,
          `${label} ${progress}/${required}`,
          ratio,
          color,
          frameCtx
        );
        return;
      }
      const runtime = getLiveProcessRuntime(process, {
        workerCount: getStructureWorkerCount(structure),
        fallbackDuration: 1,
      });
      renderSystemRowBar(
        row,
        `Build ${runtime.progress}/${runtime.duration}`,
        runtime.ratio,
        row.uiColor,
        frameCtx,
        { live: true }
      );
      return;
    }

    if (systemId === "residents") {
      const residents = structure?.systemState?.residents || {};
      const population = Math.max(0, Math.floor(residents.population ?? 0));
      const capacity = Math.max(0, Math.floor(residents.housingCapacity ?? 0));
      const ratio = capacity > 0 ? population / capacity : 0;
      renderSystemRowBar(
        row,
        `${population}/${capacity}`,
        ratio,
        row.uiColor,
        frameCtx
      );
      return;
    }

    if (systemId === "faith") {
      renderFaithRow(structure, row, frameCtx);
      return;
    }

    if (isRecipeSystem(systemId)) {
      if (row.recipeKind === "recipeRequirement") {
        const runtime = getRecipeRequirementRowRuntime(
          structure,
          systemId,
          row,
          allowLive
        );
        const required = runtime.required;
        const progress = runtime.progress;
        const label = runtime.label;
        const allRequirementsReady = runtime.allRequirementsReady;
        const color = allRequirementsReady
          ? getRequirementReadyRowColor(row.uiColor)
          : row.uiColor;
        if (runtime.isTool) {
          renderSystemRowBadge(
            row,
            label,
            runtime.isReady ? "Ready" : "Missing",
            runtime.isReady ? 0x5a8a55 : 0x5e3b34,
            runtime.isReady ? 0x8fd49c : MUCHA_UI_COLORS.intent.dangerPop
          );
          return;
        }
        renderSystemRowBar(
          row,
          `${label} ${progress}/${required}`,
          runtime.liveRatio,
          color,
          frameCtx,
          { live: allowLive }
        );
        return;
      }
      if (row.recipeKind === "recipeLabor") {
        const runtime = getRecipeLaborRowRuntime(
          structure,
          systemId,
          row,
          allowLive
        );
        const progress = runtime.progress;
        const duration = runtime.duration;
        const modeLabel = formatRecipeModeLabel(runtime.mode);
        renderSystemRowBar(
          row,
          `${modeLabel} ${progress}/${duration}`,
          runtime.ratio,
          row.uiColor,
          frameCtx,
          { live: allowLive }
        );
        return;
      }
      if (row.recipeKind === "recipeIdle") {
        if (!row.recipeId) {
          renderSystemRowBar(row, "No recipes", 0, row.uiColor, frameCtx);
          return;
        }
        renderSystemRowBar(row, "Work 0/0", 0, row.uiColor, frameCtx);
        return;
      }
      renderSystemRowBar(row, "Work 0/0", 0, row.uiColor, frameCtx);
      return;
    }

    if (systemId === "storage") {
      const info = getDepositPoolInfo(structure);
      const pool = info?.pool;
      if (!pool || typeof pool !== "object") {
        renderSystemRowBar(
          row,
          row.storageLabel || "Storage",
          0,
          row.uiColor,
          frameCtx
        );
        return;
      }
      const totals = getStorageTotals(pool, row.storageItemId);
      const maxTotal = Math.max(1, getStorageMaxTotal(pool));
      const ratio = maxTotal > 0 ? totals.total / maxTotal : 0;
      const label = row.storageLabel || getSystemUi("storage").label;
      renderSystemRowBar(
        row,
        `${label} ${totals.total}`,
        ratio,
        row.uiColor,
        frameCtx
      );
      return;
    }

    renderSystemRowBar(row, getSystemUi(systemId).label, 1, row.uiColor, frameCtx);
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
    if (view?.suppressAutoExpandedTag) return false;
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

  function updateTagEntries(view, structure, frameCtx = null) {
    const tags = getStructureTags(structure);
    const pawnCount =
      Number.isFinite(view?.pawnCount) && view.pawnCount > 0
        ? Math.floor(view.pawnCount)
        : 0;
    const hasPawn = pawnCount > 0;
    const statusPreview = getStructureTagStatusPreview(structure, tags);
    const topTagId = statusPreview?.firstEnabledTagId ?? null;
    const activeTagId =
      hasPawn
        ? statusPreview?.firstActiveTagId ??
          statusPreview?.firstSkippedTagId ??
          topTagId
        : null;
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
        rebuildStructureTags(view, structure, frameCtx);
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
        rebuildStructureTags(view, structure, frameCtx);
        return;
      }
    }
    const storageEntry = (view.tagEntries || []).find(
      (entry) => entry?.storageSignature != null
    );
    if (storageEntry) {
      const signature = getStorageSignature(structure);
      if (signature !== storageEntry.storageSignature) {
        rebuildStructureTags(view, structure, frameCtx);
        return;
      }
    }

    for (const entry of view.tagEntries || []) {
      const tagStatus = statusPreview?.statusById?.[entry.tagId] || null;
      const isDisabled =
        tagStatus?.disabled === true || isTagDisabled(structure, entry.tagId);
      const isActive =
        hasPawn &&
        !isDisabled &&
        (tagStatus?.active === true || tagStatus?.passiveActive === true);
      const isSkipped = hasPawn && !isDisabled && tagStatus?.skipped === true && !isActive;
      const isTopInactive =
        !hasPawn && entry.tagId === topTagId && !isDisabled;
      const isLowerPriority =
        !isDisabled && !isActive && !isSkipped && entry.tagId !== topTagId;

      let style = TAG_PILL_STYLES.low;
      if (isDisabled) {
        style = TAG_PILL_STYLES.bypassed;
      } else if (isActive) {
        style = TAG_PILL_STYLES.active;
      } else if (isSkipped) {
        style = TAG_PILL_STYLES.skipped;
      } else if (isTopInactive) {
        style = TAG_PILL_STYLES.topInactive;
      } else if (isLowerPriority) {
        style = TAG_PILL_STYLES.low;
      }
      if (isRecipePriorityTag(entry.tagId) && isTopInactive && !isDisabled) {
        style = {
          ...TAG_PILL_STYLES.low,
          borderColor: RECIPE_PRIORITY_BORDER,
          textColor: TAG_PILL_TEXT,
          alpha: 0.95,
        };
      }

      setTagPillStyle(entry, style);
      updateActionVisual(entry, isDisabled);
      renderTagPillFeedback(
        entry,
        isDisabled ? null : getTagTitleFeedback(entry, structure, tagStatus),
        frameCtx
      );

      for (const row of entry.systemRows || []) {
        updateSystemRow(structure, row, frameCtx, {
          allowLive: isActive,
        });
      }
    }
  }

  function rebuildStructureTags(view, structure, frameCtx = null) {
    const tags = getStructureTags(structure);
    view.tagSignature = tags.join("|");

    view.tagContainer.removeChildren();
    view.tagEntries = [];
    view.tagContainer.sortableChildren = false;
    view.roleDivider = new PIXI.Graphics();
    view.roleDivider.eventMode = "none";

    if (view.expandedTagId && !tags.includes(view.expandedTagId)) {
      view.expandedTagId = null;
    }

    const pawnCount =
      Number.isFinite(view?.pawnCount) && view.pawnCount > 0
        ? Math.floor(view.pawnCount)
        : 0;
    const statusPreview = getStructureTagStatusPreview(structure, tags);
    const activeTagId =
      pawnCount > 0
        ? statusPreview?.firstActiveTagId ??
          statusPreview?.firstSkippedTagId ??
          statusPreview?.firstEnabledTagId ??
          null
        : null;
    if (!view.expandedTagId && activeTagId && !view.suppressAutoExpandedTag) {
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
    view.tagContainer.addChild(view.roleDivider);

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
    updateTagEntries(view, structure, { ...(frameCtx || {}), dtSec: 0, snap: true });
  }

  return {
    rebuildStructureTags,
    updateTagEntries,
    layoutTagEntries,
  };
}
