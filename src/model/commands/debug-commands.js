import { envEventDefs } from "../../defs/gamepieces/env-events-defs.js";
import {
  buildSeasonDeckForCurrentSeason,
  getCurrentSeasonKey,
} from "../state.js";
import { getApCapForSecond, normalizeApState } from "./ap-helpers.js";

export function cmdDebugSetCap(state, { cap, points, enabled } = {}) {
  normalizeApState(state);

  const enableOverride =
    typeof enabled === "boolean"
      ? enabled
      : typeof cap === "number" || typeof points === "number";

  if (enableOverride) {
    const overrideCap =
      typeof cap === "number"
        ? Math.max(0, Math.floor(cap))
        : Math.max(0, Math.floor(state.actionPointCap ?? 0));
    const overridePoints = typeof points === "number" ? Math.floor(points) : overrideCap;

    state.apCapOverride = {
      enabled: true,
      cap: overrideCap,
      points: overridePoints,
    };

    state.actionPointCap = overrideCap;
    state.actionPoints = Math.min(state.actionPointCap, Math.max(0, overridePoints));
  } else {
    state.apCapOverride = null;
    state.actionPointCap = getApCapForSecond(state, state.tSec ?? 0);
    state.actionPoints = Math.min(state.actionPoints, state.actionPointCap);
  }

  return {
    ok: true,
    actionPointCap: state.actionPointCap,
    actionPoints: state.actionPoints,
    apCapOverride: state.apCapOverride,
  };
}

export function cmdDebugQueueEnvEvent(state, { defId } = {}) {
  if (!defId || typeof defId !== "string") {
    return { ok: false, reason: "badDefId" };
  }
  if (!envEventDefs[defId]) {
    return { ok: false, reason: "unknownEvent" };
  }

  const seasonKey = getCurrentSeasonKey(state);
  const seasonIndex = Number.isFinite(state?.currentSeasonIndex)
    ? Math.floor(state.currentSeasonIndex)
    : 0;
  const year = Number.isFinite(state?.year) ? Math.floor(state.year) : 1;
  if (!state.currentSeasonDeck || state.currentSeasonDeck.seasonKey !== seasonKey) {
    buildSeasonDeckForCurrentSeason(state);
  }
  if (!state.currentSeasonDeck || !Array.isArray(state.currentSeasonDeck.deck)) {
    state.currentSeasonDeck = { seasonKey, seasonIndex, year, deck: [] };
  }

  state.currentSeasonDeck.deck.unshift({ defId });
  return { ok: true, result: "eventQueued", defId };
}
