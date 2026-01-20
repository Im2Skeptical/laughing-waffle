// env-exec.js
// Per-second environment execution (events + tile intents).

import { envEventDefs } from "../defs/gamepieces/env-events-defs.js";
import { envTagDefs } from "../defs/gamesystems/env-tags-defs.js";
import { getCurrentSeasonKey, rebuildBoardOccupancy } from "./state.js";
import { runEffect } from "./effects.js";

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
  if (!Array.isArray(state.tilePawnsByCol)) return false;
  return !!state.tilePawnsByCol[col];
}

export function stepEnvSecond(state, tSec) {
  if (!state || !state.board) return;

  const board = state.board;
  const seasonKey = getCurrentSeasonKey(state);

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
        state._boardDirty = true;
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

  if (state._boardDirty) {
    rebuildBoardOccupancy(state);
    state._boardDirty = false;
  }
}
