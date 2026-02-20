// src/controllers/eventmanagers/event-log-controller.js
// View-model helpers for transient gameplay event rows.

const HOLD_SEC_DEFAULT = 5;
const FADE_SEC_DEFAULT = 10;

function getStateSafe(getState) {
  return typeof getState === "function" ? getState() : null;
}

function toSafeSec(value) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
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

    const out = [];
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
      });

      if (out.length >= limit) break;
    }

    return out;
  }

  return {
    getVisibleRows,
  };
}

