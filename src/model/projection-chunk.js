import { deserializeGameState, serializeGameState } from "./state.js";
import { canonicalizeSnapshot } from "./canonicalize.js";
import { updateGame } from "./game-model.js";
import { applyAction } from "./actions.js";

const TICKS_PER_SEC = 60;
const DEFAULT_DT_STEP = 1 / TICKS_PER_SEC;

function clampSec(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function normalizeStepSec(stepSec) {
  if (!Number.isFinite(stepSec) || stepSec <= 0) return 1;
  return Math.max(1, Math.floor(stepSec));
}

function resolveDtStepStrict(dtStep) {
  if (dtStep == null) return { ok: true, dt: DEFAULT_DT_STEP };
  if (!Number.isFinite(dtStep) || dtStep !== DEFAULT_DT_STEP) {
    return { ok: false, reason: "unsupportedDtStep" };
  }
  return { ok: true, dt: DEFAULT_DT_STEP };
}

function normalizeActionsBySecond(actionsBySecond) {
  const out = new Map();
  if (actionsBySecond instanceof Map) {
    for (const [secRaw, actionsRaw] of actionsBySecond.entries()) {
      const sec = clampSec(secRaw);
      const list = Array.isArray(actionsRaw) ? actionsRaw : [];
      if (!list.length) continue;
      out.set(sec, list.map((action) => ({ ...action, tSec: sec })));
    }
    return out;
  }
  if (Array.isArray(actionsBySecond)) {
    for (const entry of actionsBySecond) {
      const sec = clampSec(entry?.tSec ?? entry?.sec ?? entry?.second ?? 0);
      const list = Array.isArray(entry?.actions) ? entry.actions : [];
      if (!list.length) continue;
      out.set(sec, list.map((action) => ({ ...action, tSec: sec })));
    }
    return out;
  }
  if (actionsBySecond && typeof actionsBySecond === "object") {
    for (const [secRaw, actionsRaw] of Object.entries(actionsBySecond)) {
      const sec = clampSec(Number(secRaw));
      const list = Array.isArray(actionsRaw) ? actionsRaw : [];
      if (!list.length) continue;
      out.set(sec, list.map((action) => ({ ...action, tSec: sec })));
    }
  }
  return out;
}

export function buildProjectionChunkFromStateData(
  boundaryStateData,
  baseSec,
  endSec,
  opts = {}
) {
  if (boundaryStateData == null) return { ok: false, reason: "noBaseStateData" };

  const dtRes = resolveDtStepStrict(opts?.dtStep);
  if (!dtRes.ok) return dtRes;
  const dt = dtRes.dt;

  const startSec = clampSec(baseSec);
  const targetEndSec = clampSec(endSec);
  if (targetEndSec < startSec) {
    return { ok: false, reason: "badEndSec" };
  }

  const stepSec = normalizeStepSec(opts?.stepSec);
  const scheduledActionsBySecond = normalizeActionsBySecond(
    opts?.actionsBySecond
  );

  const state = deserializeGameState(boundaryStateData);
  canonicalizeSnapshot(state);
  state.paused = false;
  state.tSec = startSec;
  state.simStepIndex = startSec * TICKS_PER_SEC;

  const stateDataBySecond = new Map();
  let lastStateData = serializeGameState(state);

  for (let sec = startSec + 1; sec <= targetEndSec; sec += 1) {
    for (let i = 0; i < TICKS_PER_SEC; i += 1) {
      updateGame(dt, state);
    }

    const actions = scheduledActionsBySecond.get(sec);
    if (actions && actions.length) {
      for (const action of actions) {
        const result = applyAction(state, action, { isReplay: true });
        if (!result?.ok) {
          return {
            ok: false,
            reason: result?.reason ?? "actionFailed",
            detail: result?.detail ?? result ?? null,
            action,
            tSec: sec,
          };
        }
      }
    }

    canonicalizeSnapshot(state);
    lastStateData = serializeGameState(state);
    if ((sec - startSec) % stepSec === 0) {
      stateDataBySecond.set(sec, lastStateData);
    }
  }

  return {
    ok: true,
    baseSec: startSec,
    endSec: targetEndSec,
    stepSec,
    stateDataBySecond,
    lastStateData,
  };
}

