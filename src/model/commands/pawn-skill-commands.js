import { envTagDefs } from "../../defs/gamesystems/env-tags-defs.js";
import { PAWN_AI_SUPPRESS_AFTER_PLAYER_MOVE_SEC } from "../../defs/gamesettings/gamerules-defs.js";
import { runEffect } from "../effects/index.js";
import { adjustFollowerCount, adjustWorkerCount } from "../prestige-system.js";
import { ensurePawnAI, isEnvColExposed, isHubVisible } from "../state.js";
import { evaluateSkillNodeUnlock, getSkillNodeUnlockEffects } from "../skills.js";
import { getApCapForSecond } from "./ap-helpers.js";
import { getPawnById } from "./inventory-helpers.js";

export function cmdUnlockSkillNode(state, { leaderPawnId, pawnId, nodeId } = {}) {
  const resolvedPawnId =
    leaderPawnId != null ? leaderPawnId : pawnId != null ? pawnId : null;
  if (resolvedPawnId == null) {
    return { ok: false, reason: "badPawnId" };
  }
  if (typeof nodeId !== "string" || nodeId.length === 0) {
    return { ok: false, reason: "badNodeId" };
  }

  const leaderPawn = getPawnById(state, resolvedPawnId);
  if (!leaderPawn) return { ok: false, reason: "noPawn" };
  if (leaderPawn.role !== "leader") return { ok: false, reason: "notLeaderPawn" };

  const evaluation = evaluateSkillNodeUnlock(state, leaderPawn.id, nodeId);
  if (!evaluation?.ok) {
    return { ok: false, reason: evaluation?.reason || "notUnlockable" };
  }

  const cost = Number.isFinite(evaluation.cost)
    ? Math.max(0, Math.floor(evaluation.cost))
    : 0;
  const currentPoints = Number.isFinite(leaderPawn.skillPoints)
    ? Math.max(0, Math.floor(leaderPawn.skillPoints))
    : 0;
  if (currentPoints < cost) {
    return { ok: false, reason: "insufficientSkillPoints" };
  }

  const nextUnlocked = Array.isArray(leaderPawn.unlockedSkillNodeIds)
    ? leaderPawn.unlockedSkillNodeIds.slice()
    : [];
  if (!nextUnlocked.includes(nodeId)) {
    nextUnlocked.push(nodeId);
  }
  nextUnlocked.sort((a, b) => String(a).localeCompare(String(b)));

  leaderPawn.skillPoints = currentPoints - cost;
  leaderPawn.unlockedSkillNodeIds = nextUnlocked;

  const nowSec = Number.isFinite(state?.tSec) ? Math.floor(state.tSec) : 0;
  const unlockEffects = getSkillNodeUnlockEffects(evaluation.nodeDef);
  if (unlockEffects.length > 0) {
    runEffect(state, unlockEffects, {
      kind: "game",
      state,
      source: leaderPawn,
      pawn: leaderPawn,
      pawnId: leaderPawn.id,
      ownerId: leaderPawn.id,
      tSec: nowSec,
    });
  }

  state.actionPointCap = getApCapForSecond(state, nowSec);
  state.actionPoints = Math.min(
    Math.max(0, Math.floor(state.actionPoints ?? 0)),
    state.actionPointCap
  );

  return {
    ok: true,
    result: "skillNodeUnlocked",
    leaderPawnId: leaderPawn.id,
    pawnId: leaderPawn.id,
    nodeId,
    spent: cost,
    remainingSkillPoints: leaderPawn.skillPoints,
  };
}

export function cmdAdjustFollowerCount(state, payload = {}) {
  const leaderId = Number.isFinite(payload.leaderId) ? Math.floor(payload.leaderId) : null;
  if (leaderId == null) return { ok: false, reason: "badLeaderId" };

  const delta = Number.isFinite(payload.delta) ? Math.trunc(payload.delta) : 0;
  if (delta === 0) return { ok: true, result: "noChange", leaderId };

  return adjustFollowerCount(state, leaderId, delta);
}

export function cmdAdjustWorkerCount(state, payload = {}) {
  const leaderId = Number.isFinite(payload.leaderId) ? Math.floor(payload.leaderId) : null;
  if (leaderId == null) return { ok: false, reason: "badLeaderId" };

  const delta = Number.isFinite(payload.delta) ? Math.trunc(payload.delta) : 0;
  if (delta === 0) return { ok: true, result: "noChange", leaderId };

  return adjustWorkerCount(state, leaderId, delta);
}

function normalizePawnPlacement(placement) {
  const hubCol = Number.isFinite(placement?.hubCol) ? Math.floor(placement.hubCol) : null;
  const envCol = Number.isFinite(placement?.envCol) ? Math.floor(placement.envCol) : null;
  if (hubCol != null) return { hubCol, envCol: null };
  if (envCol != null) return { hubCol: null, envCol };
  return { hubCol: null, envCol: null };
}

function clonePawnPlacement(placement) {
  const normalized = normalizePawnPlacement(placement);
  return { hubCol: normalized.hubCol, envCol: normalized.envCol };
}

function applyPawnPlacementState(
  pawn,
  placement,
  { updateAssignedPlacement = true, clearReturnState = true } = {}
) {
  if (!pawn || typeof pawn !== "object") return clonePawnPlacement(null);
  ensurePawnAI(pawn);
  const normalized = normalizePawnPlacement(placement);
  pawn.hubCol = normalized.hubCol;
  pawn.envCol = normalized.envCol;
  if (updateAssignedPlacement) {
    pawn.ai.assignedPlacement = clonePawnPlacement(normalized);
  }
  if (clearReturnState) {
    pawn.ai.returnState = "none";
  }
  return normalized;
}

export function cmdPlacePawn(state, payload = {}) {
  const { pawnId, hubCol } = payload;
  const resolvedPawnId = Number.isFinite(pawnId) ? Math.floor(pawnId) : null;
  const pawns = Array.isArray(state?.pawns) ? state.pawns : [];
  if (!Array.isArray(state?.pawns)) state.pawns = pawns;
  const pawn = pawns.find((c) => c.id === resolvedPawnId);
  if (!pawn) return { ok: false, reason: "noPawn" };

  const toPlacement =
    payload.toPlacement ||
    (Number.isFinite(payload.toEnvCol) || Number.isFinite(payload.envCol)
      ? {
          envCol: Number.isFinite(payload.toEnvCol) ? payload.toEnvCol : payload.envCol,
        }
      : Number.isFinite(payload.toHubCol) || Number.isFinite(hubCol)
        ? {
            hubCol: Number.isFinite(payload.toHubCol) ? payload.toHubCol : hubCol,
          }
        : null);

  if (!toPlacement) {
    return { ok: false, reason: "badPlacement" };
  }

  const isEnvTarget = Number.isFinite(toPlacement.envCol);
  const rawCol = isEnvTarget ? toPlacement.envCol : toPlacement.hubCol;
  if (!Number.isFinite(rawCol)) {
    return { ok: false, reason: "badHubCol" };
  }
  const col = Math.floor(rawCol);
  const envCols = Number.isFinite(state?.board?.cols) ? Math.floor(state.board.cols) : 0;
  const hubCols = Array.isArray(state?.hub?.slots) ? state.hub.slots.length : 0;
  const cols = isEnvTarget ? envCols : hubCols;

  if (col < 0 || col >= cols) {
    return { ok: false, reason: isEnvTarget ? "badEnvCol" : "badHubCol" };
  }

  let nextEnvCol = null;
  let nextHubCol = null;

  if (isEnvTarget) {
    if (!isEnvColExposed(state, col)) {
      return { ok: false, reason: "envColHidden" };
    }
    const tile = state?.board?.occ?.tile?.[col] ?? null;
    if (!tile) return { ok: false, reason: "noTile" };
    const tags = Array.isArray(tile.tags) ? tile.tags : [];
    for (const tag of tags) {
      const def = envTagDefs[tag];
      const aff = Array.isArray(def?.affordances) ? def.affordances : [];
      if (aff.includes("noOccupy")) {
        return { ok: false, reason: "tileBlocked" };
      }
    }
    nextEnvCol = col;
  } else {
    if (!isHubVisible(state)) {
      return { ok: false, reason: "hubHidden" };
    }
    let hubTargetCol = col;
    const hubOcc = state?.hub?.occ;
    if (Array.isArray(hubOcc)) {
      const anchor = hubOcc[col];
      if (anchor && Number.isFinite(anchor.col)) {
        hubTargetCol = Math.floor(anchor.col);
      }
    }
    if (hubTargetCol < 0 || hubTargetCol >= hubCols) {
      return { ok: false, reason: "badHubCol" };
    }
    nextHubCol = hubTargetCol;
  }

  const updateAssignedPlacement = payload.skipAssignedPlacementUpdate !== true;
  applyPawnPlacementState(
    pawn,
    { hubCol: nextHubCol, envCol: nextEnvCol },
    {
      updateAssignedPlacement,
      clearReturnState: updateAssignedPlacement,
    }
  );
  ensurePawnAI(pawn);
  if (payload.skipAutoSuppress !== true) {
    const nowSec = Number.isFinite(state?.tSec) ? Math.floor(state.tSec) : 0;
    pawn.ai.mode = null;
    pawn.ai.suppressAutoUntilSec = nowSec + PAWN_AI_SUPPRESS_AFTER_PLAYER_MOVE_SEC;
  }

  maybeAutoFollowLeader(state, pawn, { updateAssignedPlacement });

  return {
    ok: true,
    result: "placed",
    pawnId: resolvedPawnId,
    envCol: nextEnvCol,
    hubCol: nextHubCol,
  };
}

function shouldFollowersAutoFollow(leader) {
  const flag = leader?.systemState?.leadership?.followersAutoFollow;
  return typeof flag === "boolean" ? flag : true;
}

function getFollowersForLeaderSorted(state, leaderId) {
  const pawns = Array.isArray(state?.pawns) ? state.pawns : [];
  const followers = pawns.filter(
    (pawn) => pawn && pawn.role === "follower" && pawn.leaderId === leaderId
  );
  followers.sort((a, b) => {
    const ai = Number.isFinite(a?.followerCreationOrderIndex) ? a.followerCreationOrderIndex : 0;
    const bi = Number.isFinite(b?.followerCreationOrderIndex) ? b.followerCreationOrderIndex : 0;
    if (ai !== bi) return ai - bi;
    return (a?.id ?? 0) - (b?.id ?? 0);
  });
  return followers;
}

function maybeAutoFollowLeader(state, leader, { updateAssignedPlacement = true } = {}) {
  if (!leader || leader.role !== "leader") return;
  if (!shouldFollowersAutoFollow(leader)) return;

  const followers = getFollowersForLeaderSorted(state, leader.id);
  if (!followers.length) return;

  const hubCol = Number.isFinite(leader.hubCol) ? Math.floor(leader.hubCol) : null;
  const envCol = Number.isFinite(leader.envCol) ? Math.floor(leader.envCol) : null;

  for (const follower of followers) {
    if (!follower) continue;
    const nextPlacement =
      hubCol != null ? { hubCol, envCol: null } : { hubCol: null, envCol };
    applyPawnPlacementState(follower, nextPlacement, {
      updateAssignedPlacement,
      clearReturnState: updateAssignedPlacement,
    });
  }
}
