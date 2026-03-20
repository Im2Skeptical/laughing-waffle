// src/controllers/eventmanagers/event-log-controller.js
// View-model helpers for transient gameplay event rows.

import {
  LEADER_FAITH_HUNGER_DECAY_THRESHOLD,
  PAWN_AI_HUNGER_WARNING,
} from "../../defs/gamesettings/gamerules-defs.js";
import { getUnlockableSkillNodes } from "../../model/skills.js";

const HOLD_SEC_DEFAULT = 5;
const FADE_SEC_DEFAULT = 10;

function getStateSafe(getState) {
  return typeof getState === "function" ? getState() : null;
}

function toSafeSec(value) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function toSafeInt(value, fallback = 0) {
  return Number.isFinite(value) ? Math.floor(value) : Math.floor(fallback);
}

function toSafeAlpha(value) {
  if (!Number.isFinite(value)) return 1;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function computeDecayAlpha(ageSec, holdSec, fadeSec) {
  const age = toSafeSec(ageSec);
  const hold = Math.max(0, toSafeSec(holdSec));
  const fade = Math.max(1, toSafeSec(fadeSec));
  if (age <= hold) return 1;
  return toSafeAlpha(1 - (age - hold) / fade);
}

function getPawnLabel(pawn, pawnId) {
  if (typeof pawn?.name === "string" && pawn.name.length > 0) return pawn.name;
  return `Pawn ${pawnId}`;
}

function getPawnIdToken(pawn, fallbackIndex = 0) {
  if (Number.isFinite(pawn?.id)) return String(Math.floor(pawn.id));
  if (typeof pawn?.id === "string" && pawn.id.length > 0) return pawn.id;
  return `unknown-${Math.max(0, Math.floor(fallbackIndex))}`;
}

function comparePawnsById(a, b) {
  const aNum = Number.isFinite(a?.id) ? Math.floor(a.id) : null;
  const bNum = Number.isFinite(b?.id) ? Math.floor(b.id) : null;
  if (aNum != null && bNum != null) return aNum - bNum;
  if (aNum != null) return -1;
  if (bNum != null) return 1;

  const aText = String(a?.id ?? "");
  const bText = String(b?.id ?? "");
  if (aText < bText) return -1;
  if (aText > bText) return 1;
  return 0;
}

function getPawnHungerCur(pawn) {
  const value = pawn?.systemState?.hunger?.cur;
  if (!Number.isFinite(value)) return null;
  return Math.floor(value);
}

function getPawnSkillPoints(pawn) {
  const value = pawn?.skillPoints;
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function formatSkillPointsText(skillPoints) {
  const points = Math.max(0, Math.floor(skillPoints ?? 0));
  return `${points} skill ${points === 1 ? "point" : "points"} to spend`;
}

function buildPinnedRows(state, nowSec) {
  const pawns = Array.isArray(state?.pawns) ? state.pawns.slice() : [];
  if (!pawns.length) return [];
  pawns.sort(comparePawnsById);

  const hungryThreshold = toSafeInt(PAWN_AI_HUNGER_WARNING, 0);
  const faithThreshold = toSafeInt(LEADER_FAITH_HUNGER_DECAY_THRESHOLD, 0);

  const hungryRows = [];
  const faithRows = [];
  const skillRows = [];
  for (let i = 0; i < pawns.length; i++) {
    const pawn = pawns[i];
    if (!pawn || typeof pawn !== "object") continue;
    const hungerCur = getPawnHungerCur(pawn);
    const pawnIdToken = getPawnIdToken(pawn, i);
    const pawnIdValue = Number.isFinite(pawn?.id)
      ? Math.floor(pawn.id)
      : pawn?.id ?? null;
    const ownerIds = pawnIdValue != null ? [pawnIdValue] : [];
    const pawnLabel = getPawnLabel(pawn, pawnIdToken);

    if (hungerCur != null && hungerCur <= hungryThreshold) {
      hungryRows.push({
        id: `pin:hungry:${pawnIdToken}`,
        tSec: nowSec,
        ageSec: 0,
        alpha: 1,
        text: `${pawnLabel} is hungry`,
        type: "pawnHungry",
        data: {
          focusKind: "pawn",
          pawnId: pawnIdValue,
          ownerIds,
          value: hungerCur,
          threshold: hungryThreshold,
        },
        pinned: true,
        pinKind: "hungry",
      });
    }

    if (pawn?.role === "leader" && hungerCur != null && hungerCur <= faithThreshold) {
      faithRows.push({
        id: `pin:faithRisk:${pawnIdToken}`,
        tSec: nowSec,
        ageSec: 0,
        alpha: 1,
        text: `${pawnLabel} is losing faith from starvation`,
        type: "leaderFaithAtRisk",
        data: {
          focusKind: "pawn",
          pawnId: pawnIdValue,
          ownerIds,
          value: hungerCur,
          threshold: faithThreshold,
        },
        pinned: true,
        pinKind: "faithRisk",
      });
    }

    const skillPoints = getPawnSkillPoints(pawn);
    if (pawn?.role !== "leader" || skillPoints <= 0 || pawnIdValue == null) continue;

    const unlockableNodeIds = getUnlockableSkillNodes(state, pawnIdValue);
    if (!unlockableNodeIds.length) continue;

    skillRows.push({
      id: `pin:skillPoints:${pawnIdToken}`,
      tSec: nowSec,
      ageSec: 0,
      alpha: 1,
      text: `${pawnLabel} has ${formatSkillPointsText(skillPoints)}`,
      type: "skillPointsAvailable",
      data: {
        focusKind: "pawn",
        pawnId: pawnIdValue,
        leaderPawnId: pawnIdValue,
        ownerIds,
        skillPoints,
        openSkillTree: true,
      },
      pinned: true,
      pinKind: "skillPoints",
    });
  }

  return hungryRows.concat(faithRows, skillRows);
}

export function createEventLogController({ getState } = {}) {
  function getVisibleRows({
    holdSec = HOLD_SEC_DEFAULT,
    fadeSec = FADE_SEC_DEFAULT,
    maxRows = 12,
  } = {}) {
    const state = getStateSafe(getState);
    const nowSec = toSafeSec(state?.tSec);
    const feed = Array.isArray(state?.gameEventFeed) ? state.gameEventFeed : [];
    const limit = Math.max(1, Math.floor(maxRows ?? 12));
    const maxAgeSec = Math.max(0, toSafeSec(holdSec)) + Math.max(1, toSafeSec(fadeSec));

    const out = buildPinnedRows(state, nowSec);
    if (out.length >= limit) {
      return out.slice(0, limit);
    }

    for (let i = feed.length - 1; i >= 0; i--) {
      const entry = feed[i];
      if (!entry || typeof entry !== "object") continue;

      const eventSec = toSafeSec(entry.tSec);
      const ageSec = nowSec - eventSec;
      if (ageSec < 0) continue;
      if (ageSec > maxAgeSec) break;
      if (entry?.data?.showInEventLog === false) continue;

      const alpha = computeDecayAlpha(ageSec, holdSec, fadeSec);
      if (alpha <= 0) continue;

      out.push({
        id: Number.isFinite(entry.id) ? Math.floor(entry.id) : `event:${i}`,
        tSec: eventSec,
        ageSec,
        alpha,
        text: typeof entry.text === "string" ? entry.text : "",
        type: typeof entry.type === "string" ? entry.type : "event",
        data: entry.data && typeof entry.data === "object" ? entry.data : null,
        pinned: false,
        pinKind: null,
      });

      if (out.length >= limit) break;
    }

    return out;
  }

  return {
    getVisibleRows,
  };
}

