// event-feed.js
// Lightweight state-backed gameplay event feed for UI logs.

const MAX_EVENT_FEED_ENTRIES = 256;

function cloneData(value) {
  if (!value || typeof value !== "object") return null;
  try {
    if (typeof structuredClone === "function") {
      return structuredClone(value);
    }
  } catch (_) {
    // ignore and fallback
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return null;
  }
}

export function ensureGameEventFeed(state) {
  if (!state || typeof state !== "object") return [];
  if (!Array.isArray(state.gameEventFeed)) {
    state.gameEventFeed = [];
  }
  if (!Number.isFinite(state.nextGameEventFeedId)) {
    state.nextGameEventFeedId = 1;
  }
  return state.gameEventFeed;
}

export function pushGameEvent(state, spec = {}) {
  if (!state || typeof state !== "object") return null;
  const feed = ensureGameEventFeed(state);

  const id = Math.max(1, Math.floor(state.nextGameEventFeedId ?? 1));
  state.nextGameEventFeedId = id + 1;

  const tSec = Number.isFinite(spec.tSec)
    ? Math.max(0, Math.floor(spec.tSec))
    : Math.max(0, Math.floor(state.tSec ?? 0));

  const entry = {
    id,
    tSec,
    type: typeof spec.type === "string" ? spec.type : "event",
    text: typeof spec.text === "string" ? spec.text : "",
    data: cloneData(spec.data),
  };

  feed.push(entry);
  if (feed.length > MAX_EVENT_FEED_ENTRIES) {
    const trim = feed.length - MAX_EVENT_FEED_ENTRIES;
    feed.splice(0, trim);
  }

  return entry;
}

