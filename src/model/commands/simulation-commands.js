import { SEASON_DURATION_SEC } from "../../defs/gamesettings/gamerules-defs.js";
import { processSecondChangeForItems } from "../effects/index.js";
import { stepEnvSecond } from "../env-exec.js";
import { stepHubSecond } from "../hub-exec.js";
import { stepPawnSecond } from "../pawn-exec.js";
import {
  enforcePrestigeFollowerCap,
  enforceWorkerPopulationCap,
} from "../prestige-system.js";
import {
  buildSeasonDeckForCurrentSeason,
  getCurrentSeasonKey,
} from "../state.js";
import {
  getApCapForSecond,
  getApIncomePerSecond,
  normalizeApState,
} from "./ap-helpers.js";
import { cmdPlacePawn } from "./pawn-skill-commands.js";

const TICKS_PER_SEC = 60;
const DEFAULT_SEASON_DURATION_SEC = SEASON_DURATION_SEC;

export function cmdAdvanceSeason(state) {
  const oldSeasonKey = getCurrentSeasonKey(state);

  const seasons = state.seasons || [];
  if (!seasons.length) return { ok: false, reason: "noSeasons" };

  const nextSeasonIndex = ((state.currentSeasonIndex || 0) + 1) % seasons.length;
  state.currentSeasonIndex = nextSeasonIndex;

  if (nextSeasonIndex === 0) {
    const currentYear = Number.isFinite(state.year) ? Math.floor(state.year) : 0;
    state.year = Math.max(1, currentYear + 1);
  }

  const newSeasonKey = getCurrentSeasonKey(state);

  state.currentSeasonDeck = null;
  buildSeasonDeckForCurrentSeason(state);
  state._seasonChanged = true;

  return { ok: true, oldSeasonKey, newSeasonKey };
}

function maybeAdvanceSeasonBySimTime(state, dt) {
  const dur =
    typeof state.seasonDurationSec === "number" && state.seasonDurationSec > 0
      ? state.seasonDurationSec
      : DEFAULT_SEASON_DURATION_SEC;

  state.seasonClockSec = typeof state.seasonClockSec === "number" ? state.seasonClockSec : 0;

  state.seasonClockSec += dt;

  let advanced = 0;
  while (state.seasonClockSec >= dur) {
    state.seasonClockSec -= dur;
    const res = cmdAdvanceSeason(state);
    if (res?.ok) advanced += 1;
    else break;
  }

  return advanced;
}

export function cmdTickSimulation(state, dt) {
  if (state.paused) return { ok: false };

  state.simStepIndex = (state.simStepIndex || 0) + 1;

  const prevTSec = state.tSec || 0;
  const newTSec = Math.floor(state.simStepIndex / TICKS_PER_SEC);

  const didAdvanceSecond = newTSec > prevTSec;
  if (didAdvanceSecond) {
    state.tSec = newTSec;

    normalizeApState(state);
    state.actionPointCap = getApCapForSecond(state, state.tSec);

    state.actionPoints += getApIncomePerSecond(state, state.tSec);
    state.actionPoints = Math.min(state.actionPoints, state.actionPointCap);
  }

  let advancedSeasonCount = 0;

  const scaledDt = dt;

  state.simTime = (state.simTime ?? 0) + scaledDt;

  advancedSeasonCount = maybeAdvanceSeasonBySimTime(state, scaledDt);

  const dur =
    typeof state.seasonDurationSec === "number" && state.seasonDurationSec > 0
      ? state.seasonDurationSec
      : DEFAULT_SEASON_DURATION_SEC;
  state.seasonTimeRemaining = Math.max(0, dur - (state.seasonClockSec ?? 0));

  state._seasonChanged = state._seasonChanged === true || advancedSeasonCount > 0;

  if (didAdvanceSecond) {
    processSecondChangeForItems(state);
    stepPawnSecond(state, state.tSec, { placePawn: cmdPlacePawn });
    stepEnvSecond(state, state.tSec);
    stepHubSecond(state, state.tSec);
    enforceWorkerPopulationCap(state);
    enforcePrestigeFollowerCap(state);
    if (state._seasonChanged) state._seasonChanged = false;
  }

  return {
    ok: true,
    advancedSeason: advancedSeasonCount > 0,
    advancedSeasonCount,
  };
}

export function cmdSetPaused(state, paused) {
  if (typeof paused !== "boolean") return { ok: false, reason: "badPaused" };
  state.paused = paused;
  return { ok: true, paused };
}
