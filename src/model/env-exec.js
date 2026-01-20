// env-exec.js
// Per-second environment execution (events + tile intents).

import { envEventDefs } from "../defs/gamepieces/env-events-defs.js";
import { envTagDefs } from "../defs/gamesystems/env-tags-defs.js";
import {
  drawSeasonDeckEntry,
  getCurrentSeasonKey,
  makeEnvEventInstance,
  rebuildBoardOccupancy,
} from "./state.js";
import { runEffect } from "./effects.js";

const EVENT_CADENCE_SEC = 5;

function isIntentEligible(intent, seasonKey, tile, hasPawn) {
  if (!intent || typeof intent !== "object") return false;
  const requires = intent.requires;
  if (!requires || typeof requires !== "object") return true;

  if (Array.isArray(requires.season) && requires.season.length > 0) {
    if (!seasonKey || !requires.season.includes(seasonKey)) return false;
  }

  if (typeof requires.hasPawn === "boolean") {
    if (requires.hasPawn !== hasPawn) return false;
  }

  if (Object.prototype.hasOwnProperty.call(requires, "hasEquipment")) {
    return false;
  }

  const tagReq = requires.hasTag;
  if (tagReq != null) {
    const tileTags = Array.isArray(tile?.tags) ? tile.tags : [];
    const requiredTags = Array.isArray(tagReq)
      ? tagReq
      : typeof tagReq === "string"
        ? [tagReq]
        : [];

    for (const tag of requiredTags) {
      if (!tileTags.includes(tag)) return false;
    }
  }

  return true;
}

function hasPawnOnCol(state, col) {
  const chars = Array.isArray(state?.characters) ? state.characters : [];
  for (const ch of chars) {
    const slot = Number.isFinite(ch?.slotIndex) ? Math.floor(ch.slotIndex) : null;
    if (slot === col) return true;
  }
  return false;
}

export function stepEnvSecond(state, tSec) {
  if (!state || !state.board) return;

  const board = state.board;
  const seasonKey = getCurrentSeasonKey(state);
  let needsRebuild = state._boardDirty === true;

  const eventAnchors = board.layers?.event?.anchors;
  if (Array.isArray(eventAnchors) && eventAnchors.length > 0) {
    for (let i = eventAnchors.length - 1; i >= 0; i--) {
      const anchor = eventAnchors[i];
      if (!anchor) continue;

      const def = envEventDefs[anchor.defId];
      if (!def) continue;

      const context = { kind: "game", state, source: anchor, tSec };

      if (!anchor.entered) {
        if (def.onEnter) runEffect(state, def.onEnter, context);
        anchor.entered = true;
      }

      if (def.onTick) runEffect(state, def.onTick, context);

      const expiredByTime =
        anchor.expiresSec != null && tSec >= anchor.expiresSec;
      const expiredBySeason =
        state._seasonChanged === true &&
        (anchor.expiresOnSeasonChange || def.expiresOnSeasonChange);

      if (expiredByTime || expiredBySeason) {
        if (def.onExit) runEffect(state, def.onExit, context);
        eventAnchors.splice(i, 1);
        needsRebuild = true;
        const occ = board.occ?.event;
        if (Array.isArray(occ)) {
          const col = Number.isFinite(anchor.col) ? anchor.col : 0;
          const span = Number.isFinite(anchor.span) ? anchor.span : 1;
          for (let offset = 0; offset < span; offset++) {
            const occCol = col + offset;
            if (occCol < 0 || occCol >= occ.length) continue;
            if (occ[occCol] === anchor) occ[occCol] = null;
          }
        }
      }
    }
  }

  if (
    Number.isFinite(tSec) &&
    tSec > 0 &&
    tSec % EVENT_CADENCE_SEC === 0
  ) {
    // Collision policy: consume the draw even if the spawn is blocked.
    const entry = drawSeasonDeckEntry(state);
    if (entry) {
      const def = envEventDefs[entry.defId];
      if (def) {
        const col = Number.isFinite(entry.col) ? Math.floor(entry.col) : 0;
        const span =
          Number.isFinite(def.defaultSpan) && def.defaultSpan > 0
            ? Math.floor(def.defaultSpan)
            : 1;

        const occ = board.occ?.event;
        let blocked = false;
        if (Array.isArray(occ)) {
          for (let offset = 0; offset < span; offset++) {
            const occCol = col + offset;
            if (occCol < 0 || occCol >= board.cols) continue;
            if (occ[occCol]) {
              blocked = true;
              break;
            }
          }
        }

        if (!blocked) {
          const anchor = makeEnvEventInstance(entry.defId, state, col, span, tSec);
          board.layers.event.anchors.push(anchor);
          needsRebuild = true;
        }
      }
    }
  }

  const cols = board.cols ?? 12;
  const tileOcc = board.occ?.tile;
  for (let col = 0; col < cols; col++) {
    const tile = tileOcc?.[col];
    if (!tile) continue;
    const hasPawn = hasPawnOnCol(state, col);
    if (!hasPawn) continue;

    const tags = Array.isArray(tile.tags) ? tile.tags : [];
    let executed = false;
    for (const tagId of tags) {
      const tagDef = envTagDefs[tagId];
      if (!tagDef) continue;
      const intents = Array.isArray(tagDef.intents) ? tagDef.intents : [];
      for (const intent of intents) {
        if (!isIntentEligible(intent, seasonKey, tile, hasPawn)) continue;
        if (intent.effect) {
          runEffect(state, intent.effect, {
            kind: "game",
            state,
            source: tile,
            tSec,
          });
        }
        executed = true;
        break;
      }
      if (executed) break;
    }
  }

  if (needsRebuild) {
    rebuildBoardOccupancy(state);
    state._boardDirty = false;
  }
}
