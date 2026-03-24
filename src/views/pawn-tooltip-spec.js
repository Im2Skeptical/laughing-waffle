import { envTileDefs } from "../defs/gamepieces/env-tiles-defs.js";
import { hubStructureDefs } from "../defs/gamepieces/hub-structure-defs.js";
import {
  LEADER_FAITH_HUNGER_DECAY_THRESHOLD,
  PAWN_AI_HUNGER_FULL,
  PAWN_AI_HUNGER_START_EAT,
  PAWN_AI_HUNGER_WARNING,
  PAWN_AI_STAMINA_FULL,
  PAWN_AI_STAMINA_START_REST,
  PAWN_AI_STAMINA_WARNING,
} from "../defs/gamesettings/gamerules-defs.js";
import { pawnSystemDefs } from "../defs/gamesystems/pawn-systems-defs.js";
import { isEnvColRevealed } from "../model/state.js";
import {
  makeMeterSection,
  makeParagraphSection,
  makeTableSection,
} from "./tooltip-spec.js";
import { getUnlockableSkillNodes } from "../model/skills.js";

const DEFAULT_SYSTEM_BUBBLE_COLORS = Object.freeze({
  hunger: 0xd0a04d,
  stamina: 0x7f5b37,
  leaderFaith: 0xb64d4d,
  skillPoints: 0xf0c95b,
});

function normalizePlacement(placement) {
  const hubCol = Number.isFinite(placement?.hubCol) ? Math.floor(placement.hubCol) : null;
  const envCol = Number.isFinite(placement?.envCol) ? Math.floor(placement.envCol) : null;
  if (hubCol != null) return { hubCol, envCol: null };
  if (envCol != null) return { hubCol: null, envCol };
  return { hubCol: null, envCol: null };
}

function placementsMatch(a, b) {
  const left = normalizePlacement(a);
  const right = normalizePlacement(b);
  if (left.hubCol != null || right.hubCol != null) {
    return left.hubCol != null && right.hubCol != null && left.hubCol === right.hubCol;
  }
  if (left.envCol != null || right.envCol != null) {
    return left.envCol != null && right.envCol != null && left.envCol === right.envCol;
  }
  return true;
}

function formatSystemValue(value) {
  if (!Number.isFinite(value)) return "?";
  if (Math.abs(value - Math.round(value)) < 0.0001) return String(Math.round(value));
  return String(Math.round(value * 10) / 10);
}

function getPlacementLabel(state, placement) {
  const normalized = normalizePlacement(placement);
  if (normalized.hubCol != null) {
    const structure = state?.hub?.occ?.[normalized.hubCol] ?? state?.hub?.slots?.[normalized.hubCol]?.structure ?? null;
    const defName = structure?.defId ? hubStructureDefs?.[structure.defId]?.name : null;
    return defName || `Hub ${normalized.hubCol}`;
  }
  if (normalized.envCol != null) {
    if (!isEnvColRevealed(state, normalized.envCol)) return "???";
    const tile = state?.board?.occ?.tile?.[normalized.envCol] ?? null;
    const defName = tile?.defId ? envTileDefs?.[tile.defId]?.name : null;
    return defName || `Tile ${normalized.envCol}`;
  }
  return "Unassigned";
}

function getSystemLines(pawn) {
  const lines = [];
  const systemState = pawn?.systemState ?? {};
  const systemTiers = pawn?.systemTiers ?? {};
  for (const systemId of Object.keys(pawnSystemDefs)) {
    const def = pawnSystemDefs[systemId];
    if (!def || def.ui?.hideInTooltip) continue;
    const label = def.ui?.name || systemId;
    const tier =
      typeof systemTiers[systemId] === "string" ? systemTiers[systemId] : null;
    const state = systemState[systemId] || def.stateDefaults || {};
    const cur = formatSystemValue(state.cur);
    const max = formatSystemValue(state.max);
    lines.push(`${label}${tier ? ` (${tier})` : ""}: ${cur}/${max}`);
  }
  if (pawn?.role === "leader") {
    const faithTier =
      typeof pawn?.leaderFaith?.tier === "string" && pawn.leaderFaith.tier.length > 0
        ? pawn.leaderFaith.tier
        : "gold";
    lines.push(`Faith (${faithTier})`);
    const workers = Number.isFinite(pawn?.workerCount)
      ? Math.max(0, Math.floor(pawn.workerCount))
      : 0;
    lines.push(`Workers: ${workers}`);
  }
  return lines;
}

function getAutomataLabel(pawn, currentPlacement, assignedPlacement) {
  const returnState = pawn?.ai?.returnState ?? "none";
  if (returnState === "ready" && !placementsMatch(currentPlacement, assignedPlacement)) {
    return "returning to assigned tile";
  }
  if (pawn?.ai?.mode === "eat" || returnState === "waitingForEat") {
    return "seeking food";
  }
  if (pawn?.ai?.mode === "rest" || returnState === "waitingForRest") {
    return "seeking rest";
  }
  return "idle";
}

function getActiveThresholdStates(pawn) {
  const states = [];
  const hungerCur = Number.isFinite(pawn?.systemState?.hunger?.cur)
    ? Math.floor(pawn.systemState.hunger.cur)
    : null;
  const staminaCur = Number.isFinite(pawn?.systemState?.stamina?.cur)
    ? Math.floor(pawn.systemState.stamina.cur)
    : null;
  if (hungerCur != null && hungerCur <= PAWN_AI_HUNGER_WARNING) states.push("Hungry");
  if (staminaCur != null && staminaCur <= PAWN_AI_STAMINA_WARNING) states.push("Tired");
  if (
    pawn?.role === "leader" &&
    hungerCur != null &&
    hungerCur <= LEADER_FAITH_HUNGER_DECAY_THRESHOLD
  ) {
    states.push("Losing faith");
  }
  if (pawn?.leaderFaith?.failedEatWarnActive === true) {
    states.push("Failed eat warning active");
  }
  return states.length ? states : ["None"];
}

function buildLegacyDebugLines(pawn, state) {
  const assignedPlacement = normalizePlacement(pawn?.ai?.assignedPlacement);
  const currentPlacement = normalizePlacement(pawn);
  const hungerCur = formatSystemValue(pawn?.systemState?.hunger?.cur);
  const hungerMax = formatSystemValue(pawn?.systemState?.hunger?.max);
  const staminaCur = formatSystemValue(pawn?.systemState?.stamina?.cur);
  const staminaMax = formatSystemValue(pawn?.systemState?.stamina?.max);
  const systemLines = getSystemLines(pawn);
  const activeThresholdStates = getActiveThresholdStates(pawn);
  const lines = [
    `Assigned tile: ${getPlacementLabel(state, assignedPlacement)}`,
    `Current tile: ${getPlacementLabel(state, currentPlacement)}`,
    `Automata: ${getAutomataLabel(pawn, currentPlacement, assignedPlacement)}`,
    `AI mode: ${pawn?.ai?.mode ?? "none"}`,
    `Return state: ${pawn?.ai?.returnState ?? "none"}`,
    "Threshold states:",
    ...activeThresholdStates,
    "Threshold debug:",
    `Hunger: ${hungerCur}/${hungerMax} (warn ${PAWN_AI_HUNGER_WARNING}, eat ${PAWN_AI_HUNGER_START_EAT}, full ${PAWN_AI_HUNGER_FULL})`,
    `Stamina: ${staminaCur}/${staminaMax} (warn ${PAWN_AI_STAMINA_WARNING}, rest ${PAWN_AI_STAMINA_START_REST}, full ${PAWN_AI_STAMINA_FULL})`,
  ];
  if (pawn?.role === "leader") {
    const faithTier =
      typeof pawn?.leaderFaith?.tier === "string" && pawn.leaderFaith.tier.length > 0
        ? pawn.leaderFaith.tier
        : "gold";
    lines.push(
      `Faith: ${faithTier} (decay when hunger <= ${LEADER_FAITH_HUNGER_DECAY_THRESHOLD})`
    );
  }
  if (systemLines.length) {
    lines.push("Systems:", ...systemLines);
  }
  return lines;
}

function getSystemColor(systemId) {
  const def = pawnSystemDefs?.[systemId];
  return (
    def?.ui?.bubbleColor ??
    DEFAULT_SYSTEM_BUBBLE_COLORS[systemId] ??
    0x8f7c60
  );
}

function getSystemShortLabel(systemId) {
  const def = pawnSystemDefs?.[systemId];
  return def?.ui?.shortLabel ?? def?.ui?.name?.[0]?.toUpperCase?.() ?? "?";
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function getBubbleMeterData(pawn, systemId, state = null) {
  if (systemId === "skillPoints") {
    return {
      value: null,
      max: null,
      fillRatio: null,
      hoverText: null,
    };
  }
  if (systemId === "leaderFaith") {
    return {
      value: null,
      max: null,
      fillRatio: null,
      hoverText: null,
    };
  }
  const systemDef = pawnSystemDefs?.[systemId];
  const systemState = pawn?.systemState?.[systemId] ?? systemDef?.stateDefaults ?? {};
  const value = Number.isFinite(systemState?.cur) ? Math.max(0, systemState.cur) : 0;
  const max = Number.isFinite(systemState?.max) ? Math.max(0, systemState.max) : 0;
  return {
    value,
    max,
    fillRatio: max > 0 ? clamp01(value / max) : value > 0 ? 1 : 0,
    hoverText: `${formatSystemValue(value)}/${formatSystemValue(max)}`,
  };
}

function getSpendableSkillNodeIds(pawn, state) {
  if (pawn?.role !== "leader" || pawn?.id == null) return [];
  return getUnlockableSkillNodes(state, pawn.id);
}

function hasSpendableSkillPoints(pawn, state) {
  return getSpendableSkillNodeIds(pawn, state).length > 0;
}

function getPawnSupportedBubbleIds(pawn, state) {
  const ids = ["hunger", "stamina"];
  if (pawn?.role === "leader") ids.unshift("leaderFaith");
  if (hasSpendableSkillPoints(pawn, state)) ids.unshift("skillPoints");
  return ids;
}

export function getVisiblePawnBubbleIds(pawn, hoverActive = false, state = null) {
  const supported = getPawnSupportedBubbleIds(pawn, state);
  if (hoverActive) return supported;
  const visible = [];
  const hungerCur = Number.isFinite(pawn?.systemState?.hunger?.cur)
    ? Math.floor(pawn.systemState.hunger.cur)
    : null;
  const staminaCur = Number.isFinite(pawn?.systemState?.stamina?.cur)
    ? Math.floor(pawn.systemState.stamina.cur)
    : null;
  if (
    pawn?.ai?.mode === "eat" ||
    (hungerCur != null && hungerCur <= PAWN_AI_HUNGER_START_EAT) ||
    pawn?.leaderFaith?.failedEatWarnActive === true
  ) {
    visible.push("hunger");
  }
  if (
    pawn?.ai?.mode === "rest" ||
    (staminaCur != null && staminaCur <= PAWN_AI_STAMINA_START_REST)
  ) {
    visible.push("stamina");
  }
  if (
    pawn?.role === "leader" &&
    ((hungerCur != null && hungerCur <= LEADER_FAITH_HUNGER_DECAY_THRESHOLD) ||
      pawn?.leaderFaith?.failedEatWarnActive === true)
  ) {
    visible.push("leaderFaith");
  }
  if (hasSpendableSkillPoints(pawn, state)) {
    visible.push("skillPoints");
  }
  return supported.filter((systemId) => visible.includes(systemId));
}

function makeSystemBubbleTooltipSpec(pawn, systemId, state) {
  if (systemId === "skillPoints") {
    const skillPoints = Number.isFinite(pawn?.skillPoints)
      ? Math.max(0, Math.floor(pawn.skillPoints))
      : 0;
    const unlockableNodeIds = getSpendableSkillNodeIds(pawn, state);
    return {
      title: "Skill Points Ready",
      subtitle: "Leader",
      accentColor: getSystemColor(systemId),
      sections: [
        makeParagraphSection([
          "This leader has spendable ",
          { kind: "keyword", keywordId: "skillPoints", text: "skill points" },
          ".",
        ]),
        makeTableSection("Spendable", [
          { label: "Skill points", value: String(skillPoints) },
          { label: "Unlockable nodes", value: String(unlockableNodeIds.length) },
        ]),
      ],
    };
  }
  if (systemId === "leaderFaith") {
    const tier = typeof pawn?.leaderFaith?.tier === "string" ? pawn.leaderFaith.tier : "gold";
    const hungerCur = Number.isFinite(pawn?.systemState?.hunger?.cur)
      ? Math.floor(pawn.systemState.hunger.cur)
      : 0;
    return {
      title: "Faith",
      subtitle: "Leader",
      accentColor: getSystemColor(systemId),
      sections: [
        makeParagraphSection([
          { kind: "keyword", keywordId: "faith", text: "Faith" },
          " falls when a leader stays hungry for too long.",
        ]),
        makeTableSection("Thresholds", [
          { label: "Decay threshold", value: String(LEADER_FAITH_HUNGER_DECAY_THRESHOLD) },
          { label: "Current hunger", value: String(hungerCur) },
          { label: "Tier", value: tier },
        ]),
      ],
    };
  }
  const systemDef = pawnSystemDefs?.[systemId];
  const systemState = pawn?.systemState?.[systemId] ?? systemDef?.stateDefaults ?? {};
  const cur = Number.isFinite(systemState?.cur) ? Math.max(0, systemState.cur) : 0;
  const max = Number.isFinite(systemState?.max) ? Math.max(0, systemState.max) : 0;
  if (systemId === "hunger") {
    return {
      title: systemDef?.ui?.name ?? "Hunger",
      subtitle: pawn?.role === "leader" ? "Leader system" : "Follower system",
      accentColor: getSystemColor(systemId),
      sections: [
        makeMeterSection({
          label: "Hunger",
          value: cur,
          max,
          accentColor: getSystemColor(systemId),
          text: `${Math.round(cur)}/${Math.round(max)}`,
        }),
        makeParagraphSection([
          { kind: "keyword", keywordId: "hunger", text: "Hunger" },
          " decays over time. Low hunger makes pawns ",
          { kind: "keyword", keywordId: "seek", text: "seek" },
          " food.",
        ]),
        makeTableSection("Thresholds", [
          { label: "Warning", value: String(PAWN_AI_HUNGER_WARNING) },
          { label: "Start eat", value: String(PAWN_AI_HUNGER_START_EAT) },
          { label: "Full", value: String(PAWN_AI_HUNGER_FULL) },
        ]),
      ],
    };
  }
  return {
    title: systemDef?.ui?.name ?? "Stamina",
    subtitle: pawn?.role === "leader" ? "Leader system" : "Follower system",
    accentColor: getSystemColor(systemId),
    sections: [
      makeMeterSection({
        label: "Stamina",
        value: cur,
        max,
        accentColor: getSystemColor(systemId),
        text: `${Math.round(cur)}/${Math.round(max)}`,
      }),
      makeParagraphSection([
        { kind: "keyword", keywordId: "stamina", text: "Stamina" },
        " is spent on work and restored by ",
        { kind: "keyword", keywordId: "rest", text: "rest" },
        ".",
      ]),
      makeTableSection("Thresholds", [
        { label: "Warning", value: String(PAWN_AI_STAMINA_WARNING) },
        { label: "Start rest", value: String(PAWN_AI_STAMINA_START_REST) },
        { label: "Full", value: String(PAWN_AI_STAMINA_FULL) },
      ]),
    ],
  };
}

export function getPawnBubbleSpecs(pawn, state, { hoverActive = false } = {}) {
  const visibleIds = getVisiblePawnBubbleIds(pawn, hoverActive, state);
  return visibleIds.map((systemId) => ({
    ...getBubbleMeterData(pawn, systemId, state),
    systemId,
    shortLabel:
      systemId === "leaderFaith"
        ? "Fa"
        : systemId === "skillPoints"
          ? "!"
          : getSystemShortLabel(systemId),
    label:
      systemId === "leaderFaith"
        ? "Faith"
        : systemId === "skillPoints"
          ? "Skill Points"
          : pawnSystemDefs?.[systemId]?.ui?.name ?? systemId,
    color: getSystemColor(systemId),
    tooltipSpec: makeSystemBubbleTooltipSpec(pawn, systemId, state),
  }));
}

export function makePawnDebugInspectorSpec(pawn, state) {
  const lines = buildLegacyDebugLines(pawn, state);
  return {
    title: pawn?.name || `Pawn ${pawn?.id ?? ""}`,
    subtitle: "Raw inspector",
    accentColor: typeof pawn?.color === "number" ? pawn.color : 0x8f7c60,
    debugSections: lines.map((line) => makeParagraphSection([line])),
  };
}

export function makePawnInfocardSpec(pawn, state) {
  const currentPlacement = normalizePlacement(pawn);
  const assignedPlacement = normalizePlacement(pawn?.ai?.assignedPlacement);
  const hungerCur = Number.isFinite(pawn?.systemState?.hunger?.cur)
    ? pawn.systemState.hunger.cur
    : 0;
  const hungerMax = Number.isFinite(pawn?.systemState?.hunger?.max)
    ? pawn.systemState.hunger.max
    : 100;
  const staminaCur = Number.isFinite(pawn?.systemState?.stamina?.cur)
    ? pawn.systemState.stamina.cur
    : 0;
  const staminaMax = Number.isFinite(pawn?.systemState?.stamina?.max)
    ? pawn.systemState.stamina.max
    : 100;
  const thresholdStates = getActiveThresholdStates(pawn);
  const roleLabel = pawn?.role === "leader" ? "Leader" : "Follower";
  const sections = [
    makeParagraphSection([
      pawn?.role === "leader"
        ? "Leads the group and spends "
        : "A ",
      pawn?.role === "leader"
        ? { kind: "keyword", keywordId: "prestige", text: "Prestige" }
        : { kind: "keyword", keywordId: "follower", text: "Follower" },
      pawn?.role === "leader"
        ? " to support followers."
        : " who spends ",
      ...(pawn?.role === "leader"
        ? []
        : [
            { kind: "keyword", keywordId: "stamina", text: "Stamina" },
            " on local tasks.",
          ]),
    ]),
    makeParagraphSection(`Assigned: ${getPlacementLabel(state, assignedPlacement)}`),
    makeParagraphSection(`Current: ${getPlacementLabel(state, currentPlacement)}`),
    makeParagraphSection(
      `Automata: ${getAutomataLabel(pawn, currentPlacement, assignedPlacement)}`
    ),
    makeMeterSection({
      label: "Hunger",
      value: hungerCur,
      max: hungerMax,
      accentColor: getSystemColor("hunger"),
      text: `${Math.round(hungerCur)}/${Math.round(hungerMax)}`,
    }),
    makeMeterSection({
      label: "Stamina",
      value: staminaCur,
      max: staminaMax,
      accentColor: getSystemColor("stamina"),
      text: `${Math.round(staminaCur)}/${Math.round(staminaMax)}`,
    }),
    makeTableSection("State", [
      { label: "Mode", value: String(pawn?.ai?.mode ?? "idle") },
      { label: "Return", value: String(pawn?.ai?.returnState ?? "none") },
      { label: "Flags", value: thresholdStates.join(", ") },
    ]),
  ];
  if (pawn?.role === "leader") {
    sections.push(
      makeTableSection("Faith", [
        {
          label: "Tier",
          value: String(pawn?.leaderFaith?.tier ?? "gold"),
        },
        {
          label: "Decay threshold",
          value: String(LEADER_FAITH_HUNGER_DECAY_THRESHOLD),
        },
        {
          label: "Workers",
          value: String(Math.max(0, Math.floor(pawn?.workerCount ?? 0))),
        },
      ])
    );
  }
  return {
    title: pawn?.name || `Pawn ${pawn?.id ?? ""}`,
    subtitle: roleLabel,
    accentColor: typeof pawn?.color === "number" ? pawn.color : 0x8f7c60,
    sourceKind: "pawn",
    sourceId: pawn?.id ?? null,
    sections,
    debugSections: makePawnDebugInspectorSpec(pawn, state).debugSections,
  };
}

export function makePawnTooltipSpec(pawn, state) {
  return makePawnInfocardSpec(pawn, state);
}
