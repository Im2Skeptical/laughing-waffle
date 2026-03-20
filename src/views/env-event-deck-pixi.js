// src/views/env-event-deck-pixi.js
// Environment event deck visuals with deterministic, reversible timeline motion.
// View-only: reads state/timeline snapshots and renders feedback.

import { envEventDefs } from "../defs/gamepieces/env-events-defs.js";
import { ENV_EVENT_DRAW_CADENCE_SEC } from "../defs/gamesettings/gamerules-defs.js";
import { getVisibleEnvColCount, isEnvColRevealed } from "../model/state.js";
import {
  VIEW_LAYOUT,
  BOARD_COL_GAP,
  BOARD_COL_WIDTH,
  BOARD_COLS,
  EVENT_HEIGHT,
  EVENT_ROW_Y,
  EVENT_WIDTH,
  getBoardColumnXForVisibleCols,
} from "./layout-pixi.js";
import { installSolidUiHitArea } from "./ui-helpers/solid-ui-hit-area.js";

const TWO_PI = Math.PI * 2;
const DEFAULT_CARD_W = 48;
const DEFAULT_CARD_H = 64;
export const ENV_EVENT_DECK_SPLIT_STAGGER_SEC = 0.04;
const eventRevealLockRemainingByInstanceId = new Map();

const SEASON_THEME = {
  spring: {
    base: 0x6f8f61,
    accent: 0xb9da7a,
    ring: 0xcbe7a8,
    cardEdge: 0xe9f6cf,
  },
  summer: {
    base: 0x8f6f43,
    accent: 0xf5c95a,
    ring: 0xffe49c,
    cardEdge: 0xffeec8,
  },
  autumn: {
    base: 0x7f573b,
    accent: 0xd69042,
    ring: 0xf0be73,
    cardEdge: 0xffddae,
  },
  winter: {
    base: 0x4f6178,
    accent: 0x9cc4f5,
    ring: 0xd5e7ff,
    cardEdge: 0xeef6ff,
  },
  default: {
    base: 0x575e69,
    accent: 0x9aa8c3,
    ring: 0xc8d4ea,
    cardEdge: 0xe3ebf9,
  },
};

export const ENV_EVENT_DECK_LAYOUT = {
  ...VIEW_LAYOUT.envEventDeck,
  placementStaggerSec:
    Number(VIEW_LAYOUT.envEventDeck?.placementStaggerSec) ||
    ENV_EVENT_DECK_SPLIT_STAGGER_SEC,
};

export function getEventRevealLockRemainingSec(eventInstanceId) {
  if (!Number.isFinite(eventInstanceId)) return 0;
  return Math.max(
    0,
    Number(
      eventRevealLockRemainingByInstanceId.get(Math.floor(eventInstanceId)) ?? 0
    )
  );
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function clampInt(value, fallback) {
  const n = Math.floor(value);
  return Number.isFinite(n) ? n : fallback;
}

function getSafeStateSecond(state) {
  const tSec = Math.floor(state?.tSec ?? 0);
  return Number.isFinite(tSec) ? Math.max(0, tSec) : 0;
}

function getTimeSecForVisuals(state) {
  const tSec = getSafeStateSecond(state);
  const steps = state?.simStepIndex;
  if (Number.isFinite(steps)) {
    const tf = Math.max(0, steps / 60);
    if (Math.floor(tf) === tSec) return tf;
  }
  return tSec;
}

function getSeasonKey(state) {
  const seasons = Array.isArray(state?.seasons) ? state.seasons : null;
  const idx = Number.isFinite(state?.currentSeasonIndex)
    ? Math.floor(state.currentSeasonIndex)
    : 0;
  if (seasons && seasons.length > 0) {
    const wrapped = ((idx % seasons.length) + seasons.length) % seasons.length;
    return seasons[wrapped];
  }
  return "default";
}

function getSeasonTheme(state) {
  const key = getSeasonKey(state);
  return SEASON_THEME[key] || SEASON_THEME.default;
}

function resolveSeasonalColoringEnabled(state, getSeasonalColoringEnabled) {
  if (typeof getSeasonalColoringEnabled !== "function") return true;
  return getSeasonalColoringEnabled(state) === true;
}

function getDeckTheme(state, seasonalColoringEnabled) {
  if (!seasonalColoringEnabled) return SEASON_THEME.default;
  return getSeasonTheme(state);
}

function getDeckThemeKey(state, seasonalColoringEnabled) {
  if (!seasonalColoringEnabled) return "neutral";
  return `season:${getSeasonKey(state)}`;
}

function resolveDeckVisibilityEnabled(state, layout, getDeckVisibilityEnabled) {
  if (layout?.enabled === false) return false;
  if (typeof getDeckVisibilityEnabled !== "function") return true;
  return getDeckVisibilityEnabled(state) === true;
}

function getBoardRightX(screenWidth, boardCols) {
  const cols = Math.max(1, clampInt(boardCols, BOARD_COLS));
  const lastColX = getBoardColumnXForVisibleCols(screenWidth, cols - 1, cols);
  return lastColX + BOARD_COL_WIDTH;
}

function getDeckAnchorPosition({ app, state, layout, sunMoonLayout }) {
  const cols = Math.max(1, getVisibleEnvColCount(state));
  const boardRight = getBoardRightX(app.screen.width, cols);
  const seasonDiskX = Number.isFinite(sunMoonLayout?.season?.x)
    ? sunMoonLayout.season.x
    : app.screen.width - 220;
  const minX = boardRight + 32;
  const maxX = seasonDiskX - Math.max(30, (layout?.width ?? 72) * 0.4);
  const mid = boardRight + (seasonDiskX - boardRight) * 0.44;
  const x = Math.round(Math.max(minX, Math.min(maxX, mid)));
  const y = Math.round(EVENT_ROW_Y + EVENT_HEIGHT * 0.5);
  return { x, y };
}

export function getEnvEventDeckPlacementTargetPosition(screenWidth, state, placement) {
  const col = Number.isFinite(placement?.col) ? Math.floor(placement.col) : 0;
  const span =
    Number.isFinite(placement?.span) && placement.span > 0
      ? Math.floor(placement.span)
      : 1;
  const visibleCols = Math.max(1, getVisibleEnvColCount(state));
  const width = EVENT_WIDTH * span + BOARD_COL_GAP * (span - 1);
  return {
    x: getBoardColumnXForVisibleCols(screenWidth, col, visibleCols) + width / 2,
    y: EVENT_ROW_Y + EVENT_HEIGHT * 0.5,
  };
}

function getPlacementTargetPosition(app, state, placement) {
  return getEnvEventDeckPlacementTargetPosition(app.screen.width, state, placement);
}

function normalizePlacement(placement) {
  const col = Number.isFinite(placement?.col) ? Math.floor(placement.col) : null;
  if (col == null) return null;
  const span =
    Number.isFinite(placement?.span) && placement.span > 0
      ? Math.floor(placement.span)
      : 1;
  const instanceId = Number.isFinite(placement?.instanceId)
    ? Math.floor(placement.instanceId)
    : null;
  return { col, span, instanceId };
}

export function isEnvEventDeckPlacementRevealed(state, placement) {
  const col = Number.isFinite(placement?.col) ? Math.floor(placement.col) : null;
  if (col == null || col < 0) return false;
  const span =
    Number.isFinite(placement?.span) && placement.span > 0
      ? Math.floor(placement.span)
      : 1;
  for (let offset = 0; offset < span; offset++) {
    if (!isEnvColRevealed(state, col + offset)) return false;
  }
  return true;
}

export function getRenderableEnvEventDeckPlacements(state, placementsRaw) {
  const placements = Array.isArray(placementsRaw) ? placementsRaw : [];
  return placements.filter((placement) =>
    isEnvEventDeckPlacementRevealed(state, placement)
  );
}

function normalizeDrawEventPayload(rawData) {
  if (!rawData || typeof rawData !== "object") return null;
  const defId = typeof rawData.defId === "string" ? rawData.defId : null;
  if (!defId) return null;
  const rawOutcome = rawData.outcome;
  const outcome =
    rawOutcome === "placed" ||
    rawOutcome === "aggregated" ||
    rawOutcome === "returned" ||
    rawOutcome === "consumedNoPlacement"
      ? rawOutcome
      : "consumedNoPlacement";
  const placementsRaw = Array.isArray(rawData.placements) ? rawData.placements : [];
  const placements = placementsRaw
    .map(normalizePlacement)
    .filter(Boolean)
    .sort(
      (a, b) =>
        a.col - b.col ||
        (a.instanceId ?? Number.MAX_SAFE_INTEGER) -
          (b.instanceId ?? Number.MAX_SAFE_INTEGER)
    );
  return {
    defId,
    seasonKey:
      typeof rawData.seasonKey === "string" ? rawData.seasonKey : "default",
    consumePolicy:
      typeof rawData.consumePolicy === "string" ? rawData.consumePolicy : null,
    outcome,
    aggregation:
      rawData.aggregation && typeof rawData.aggregation === "object"
        ? {
            aggregateKey:
              typeof rawData.aggregation.aggregateKey === "string"
                ? rawData.aggregation.aggregateKey
                : null,
            cardsDrawn: Number.isFinite(rawData.aggregation.cardsDrawn)
              ? Math.max(1, Math.floor(rawData.aggregation.cardsDrawn))
              : 1,
            magnitudeId:
              typeof rawData.aggregation.magnitudeId === "string"
                ? rawData.aggregation.magnitudeId
                : null,
            expiresSec: Number.isFinite(rawData.aggregation.expiresSec)
              ? Math.max(0, Math.floor(rawData.aggregation.expiresSec))
              : null,
          }
        : null,
    placements,
  };
}

function findDrawEventAtSecond(stateData, targetSec) {
  const feed = Array.isArray(stateData?.gameEventFeed) ? stateData.gameEventFeed : [];
  const sec = Math.max(0, Math.floor(targetSec ?? 0));
  for (let i = feed.length - 1; i >= 0; i--) {
    const entry = feed[i];
    if (!entry || entry.type !== "envDeckDraw") continue;
    const tSec = Number.isFinite(entry.tSec) ? Math.floor(entry.tSec) : -1;
    if (tSec !== sec) continue;
    const payload = normalizeDrawEventPayload(entry?.data);
    if (!payload) return null;
    return payload;
  }
  return null;
}

function getCrossedCadenceSeconds(fromSec, toSec, cadenceSec) {
  const out = [];
  const cadence = Math.max(1, Math.floor(cadenceSec));
  const from = Math.max(0, Math.floor(fromSec ?? 0));
  const to = Math.max(0, Math.floor(toSec ?? 0));
  if (to > from) {
    for (let sec = from + 1; sec <= to; sec++) {
      if (sec > 0 && sec % cadence === 0) out.push(sec);
    }
  } else if (to < from) {
    for (let sec = from; sec > to; sec--) {
      if (sec > 0 && sec % cadence === 0) out.push(sec);
    }
  }
  return out;
}

function easeOutCubic(t) {
  const x = clamp01(t);
  return 1 - Math.pow(1 - x, 3);
}

function easeInOutSine(t) {
  const x = clamp01(t);
  return 0.5 - 0.5 * Math.cos(Math.PI * x);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function drawDeckBody(graphics, width, height, theme) {
  graphics.clear();
  const halfW = width * 0.5;
  const halfH = height * 0.5;
  const radius = 10;

  for (let i = 2; i >= 0; i--) {
    const ox = -halfW + i * 1.8;
    const oy = -halfH + i * 2.4;
    const alpha = 0.22 + i * 0.1;
    graphics
      .lineStyle(1, theme.cardEdge, 0.4 + i * 0.15)
      .beginFill(theme.base, alpha)
      .drawRoundedRect(ox, oy, width, height, radius)
      .endFill();
  }

  graphics
    .lineStyle(2, theme.cardEdge, 0.95)
    .beginFill(theme.base, 0.95)
    .drawRoundedRect(-halfW, -halfH, width, height, radius)
    .endFill();

  graphics.lineStyle(2, theme.accent, 0.95);
  graphics.moveTo(-halfW + 10, -halfH + 14);
  graphics.bezierCurveTo(-8, -halfH + 4, 10, -halfH + 22, halfW - 10, -halfH + 10);
  graphics.moveTo(-halfW + 10, halfH - 14);
  graphics.bezierCurveTo(-8, halfH - 2, 10, halfH - 24, halfW - 10, halfH - 10);
}

function drawTimerRing(graphics, radius, progress01, theme) {
  const progress = clamp01(progress01);
  graphics.clear();
  graphics.lineStyle(2, theme.ring, 0.3);
  graphics.drawCircle(0, 0, radius);

  if (progress <= 0) return;
  const start = -Math.PI * 0.5;
  const end = start + progress * TWO_PI;
  graphics.lineStyle(4, theme.ring, 0.95);
  graphics.arc(0, 0, radius, start, end);
}

function createFlightSprite({
  theme,
  color,
  label,
  width = DEFAULT_CARD_W,
  height = DEFAULT_CARD_H,
}) {
  const cont = new PIXI.Container();
  const bg = new PIXI.Graphics();
  const halfW = width * 0.5;
  const halfH = height * 0.5;
  const accent = Number.isFinite(color) ? color : theme.accent;

  bg
    .lineStyle(2, theme.cardEdge, 0.96)
    .beginFill(0x0f1318, 0.32)
    .drawRoundedRect(-halfW + 2, -halfH + 2, width, height, 8)
    .endFill()
    .lineStyle(2, accent, 0.95)
    .beginFill(theme.base, 0.96)
    .drawRoundedRect(-halfW, -halfH, width, height, 8)
    .endFill()
    .lineStyle(1, theme.cardEdge, 0.55)
    .beginFill(accent, 0.72)
    .drawRoundedRect(-halfW + 5, -halfH + 6, width - 10, 14, 4)
    .endFill();

  const text = new PIXI.Text(label, {
    fill: theme.cardEdge,
    fontSize: 10,
    fontWeight: "bold",
    fontFamily: "Arial",
    align: "center",
  });
  text.anchor.set(0.5);
  text.x = 0;
  text.y = 18;

  cont.addChild(bg, text);
  return cont;
}

function getDrawEventLabel(defId) {
  const def = envEventDefs?.[defId];
  const raw =
    (typeof def?.name === "string" && def.name) ||
    (typeof def?.ui?.name === "string" && def.ui.name) ||
    defId ||
    "Event";
  const parts = String(raw).trim().split(/\s+/);
  if (!parts.length) return "EV";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? "E"}${parts[1][0] ?? "V"}`.toUpperCase();
}

function getDrawEventColor(defId, fallbackColor) {
  const def = envEventDefs?.[defId];
  const uiColor = def?.ui?.color;
  if (Number.isFinite(uiColor)) return uiColor;
  if (Number.isFinite(def?.color)) return def.color;
  return fallbackColor;
}

function syncEventRevealLocksFromMotions(activeMotions) {
  eventRevealLockRemainingByInstanceId.clear();
  for (const motion of activeMotions) {
    const eventId = Number.isFinite(motion?.revealLockEventId)
      ? Math.floor(motion.revealLockEventId)
      : null;
    if (eventId == null) continue;
    if (motion.direction < 0) continue;
    const totalSec = Math.max(
      0.01,
      Number(motion.delaySec ?? 0) + Number(motion.durationSec ?? 0)
    );
    const ageSec = Math.max(0, Number(motion.ageSec ?? 0));
    const remainingSec = Math.max(0, totalSec - ageSec);
    if (remainingSec <= 0) continue;
    const prevRemainingSec = eventRevealLockRemainingByInstanceId.get(eventId) ?? 0;
    if (remainingSec > prevRemainingSec) {
      eventRevealLockRemainingByInstanceId.set(eventId, remainingSec);
    }
  }
}

export function createEnvEventDeckView({
  app,
  layer,
  getState,
  getDeckVisibilityEnabled,
  getSeasonalColoringEnabled,
  getTimeline,
  getStateDataAtSecond,
  layout = ENV_EVENT_DECK_LAYOUT,
  sunMoonLayout = null,
} = {}) {
let root = null;
let deckContainer = null;
  let deckBody = null;
  let timerRing = null;
  let deckLabel = null;
  let fxLayer = null;
let overflowBadge = null;
let overflowText = null;
let solidHitArea = null;
  let lastEnabled = null;
  let lastDeckThemeKey = null;
  let lastSeenSec = null;

  const activeMotions = [];
  const drawEventCache = new Map();
  const drawEventCacheOrder = [];
  let overflowBadgeSecRemaining = 0;

  function putCachedDrawEvent(sec, payload) {
    const key = Math.max(0, Math.floor(sec ?? 0));
    if (!drawEventCache.has(key)) drawEventCacheOrder.push(key);
    drawEventCache.set(key, payload);
    const maxCache = Math.max(64, Math.floor(layout?.cacheSeconds ?? 512));
    while (drawEventCacheOrder.length > maxCache) {
      const oldest = drawEventCacheOrder.shift();
      drawEventCache.delete(oldest);
    }
  }

  function resolveDrawEventAtSecond(sec) {
    const key = Math.max(0, Math.floor(sec ?? 0));
    if (drawEventCache.has(key)) return drawEventCache.get(key);
    const stateData =
      typeof getStateDataAtSecond === "function"
        ? getStateDataAtSecond(key)
        : null;
    const payload = stateData ? findDrawEventAtSecond(stateData, key) : null;
    putCachedDrawEvent(key, payload);
    return payload;
  }

  function clearMotions() {
    while (activeMotions.length > 0) {
      const motion = activeMotions.pop();
      motion?.sprite?.removeFromParent?.();
      motion?.sprite?.destroy?.({ children: true });
    }
    overflowBadgeSecRemaining = 0;
    if (overflowBadge) overflowBadge.visible = false;
    eventRevealLockRemainingByInstanceId.clear();
  }

  function buildMotion({
    theme,
    defId,
    allowEventColor = true,
    startX,
    startY,
    endX,
    endY,
    kind,
    direction,
    revealLockEventId = null,
    delaySec,
    durationSec,
    arcHeight,
  }) {
    const label = getDrawEventLabel(defId);
    const color = allowEventColor
      ? getDrawEventColor(defId, theme.accent)
      : theme.accent;
    const sprite = createFlightSprite({
      theme,
      color,
      label,
    });
    sprite.x = startX;
    sprite.y = startY;
    sprite.zIndex = 2;
    fxLayer.addChild(sprite);
    return {
      kind,
      direction,
      revealLockEventId,
      startX,
      startY,
      endX,
      endY,
      delaySec,
      durationSec,
      arcHeight,
      ageSec: 0,
      sprite,
    };
  }

  function addOverflowBadge(amount) {
    if (!overflowText || !overflowBadge) return;
    if (!Number.isFinite(amount) || amount <= 0) return;
    overflowText.text = `+${Math.floor(amount)}`;
    overflowText.x = Math.floor(-overflowText.width * 0.5);
    overflowText.y = Math.floor(-overflowText.height * 0.5) - 1;
    overflowBadge.visible = true;
    overflowBadgeSecRemaining = Math.max(
      0.2,
      Number(layout?.overflowBadgeHoldSec ?? 1.25)
    );
  }

  function enqueueDrawMotionForSecond({
    sec,
    state,
    drawEvent,
    direction,
    deckPos,
    theme,
    seasonalColoringEnabled,
    motionCollector,
  }) {
    if (!drawEvent) return;
    const defId = drawEvent.defId;
    const baseDelay = motionCollector.length * (layout?.interFlightDelaySec ?? 0.045);
    const forward = direction >= 0;
    const placedDuration = Number(layout?.placedDurationSec ?? 0.72);
    const returnedDuration = Number(layout?.returnedDurationSec ?? 0.5);
    const consumedDuration = Number(layout?.consumedDurationSec ?? 0.58);

    if (drawEvent.outcome === "placed" && drawEvent.placements.length > 0) {
      const sortedPlacements = getRenderableEnvEventDeckPlacements(
        state,
        drawEvent.placements
      );
      if (!sortedPlacements.length) return;
      const placementStaggerSec = Number(
        layout?.placementStaggerSec ?? ENV_EVENT_DECK_SPLIT_STAGGER_SEC
      );
      for (let i = 0; i < sortedPlacements.length; i++) {
        const placement = sortedPlacements[i];
        const target = getPlacementTargetPosition(app, state, placement);
        const delaySec = baseDelay + i * placementStaggerSec;
        const startX = forward ? deckPos.x : target.x;
        const startY = forward ? deckPos.y : target.y;
        const endX = forward ? target.x : deckPos.x;
        const endY = forward ? target.y : deckPos.y;
        const eventInstanceId = Number.isFinite(placement?.instanceId)
          ? Math.floor(placement.instanceId)
          : null;
        motionCollector.push(
          buildMotion({
            theme,
            defId,
            allowEventColor: seasonalColoringEnabled,
            startX,
            startY,
            endX,
            endY,
            kind: "placed",
            direction,
            revealLockEventId: forward ? eventInstanceId : null,
            delaySec,
            durationSec: placedDuration,
            arcHeight: 36 + i * 4,
          })
        );
      }
      return;
    }

    if (drawEvent.outcome === "returned") {
      const peekX = deckPos.x + 54;
      const peekY = deckPos.y - 24;
      motionCollector.push(
        buildMotion({
          theme,
          defId,
          allowEventColor: seasonalColoringEnabled,
          startX: deckPos.x,
          startY: deckPos.y,
          endX: peekX,
          endY: peekY,
          kind: "returned",
          direction,
          delaySec: baseDelay,
          durationSec: returnedDuration,
          arcHeight: 18,
        })
      );
      return;
    }

    const boardCols = Math.max(1, getVisibleEnvColCount(state));
    const boardRight = getBoardRightX(app.screen.width, boardCols);
    const dissipateX = boardRight - EVENT_WIDTH * 0.75;
    const dissipateY = deckPos.y - 14;
    const startX = forward ? deckPos.x : dissipateX;
    const startY = forward ? deckPos.y : dissipateY;
    const endX = forward ? dissipateX : deckPos.x;
    const endY = forward ? dissipateY : deckPos.y;
    motionCollector.push(
      buildMotion({
        theme,
        defId,
        allowEventColor: seasonalColoringEnabled,
        startX,
        startY,
        endX,
        endY,
        kind: "consumed",
        direction,
        delaySec: baseDelay,
        durationSec: consumedDuration,
        arcHeight: 14,
      })
    );
  }

  function processCrossedSeconds(fromSec, toSec, state) {
    const crossed = getCrossedCadenceSeconds(
      fromSec,
      toSec,
      ENV_EVENT_DRAW_CADENCE_SEC
    );
    if (!crossed.length) return;
    const direction = toSec >= fromSec ? 1 : -1;
    const deckPos = getDeckAnchorPosition({
      app,
      state,
      layout,
      sunMoonLayout,
    });
    const seasonalColoringEnabled = resolveSeasonalColoringEnabled(
      state,
      getSeasonalColoringEnabled
    );
    const theme = getDeckTheme(state, seasonalColoringEnabled);
    const pending = [];
    for (const sec of crossed) {
      const drawEvent = resolveDrawEventAtSecond(sec);
      enqueueDrawMotionForSecond({
        sec,
        state,
        drawEvent,
        direction,
        deckPos,
        theme,
        seasonalColoringEnabled,
        motionCollector: pending,
      });
    }

    if (!pending.length) return;
    const maxFlights = Math.max(1, Math.floor(layout?.maxCatchupFlights ?? 16));
    const overflowCount = Math.max(0, pending.length - maxFlights);
    if (overflowCount > 0) {
      for (let i = pending.length - 1; i >= maxFlights; i--) {
        const motion = pending[i];
        motion?.sprite?.removeFromParent?.();
        motion?.sprite?.destroy?.({ children: true });
        pending.pop();
      }
      addOverflowBadge(overflowCount);
    }
    activeMotions.push(...pending);
  }

  function drawDeckStatic(state) {
    if (!deckBody || !timerRing || !deckLabel) return;
    const seasonalColoringEnabled = resolveSeasonalColoringEnabled(
      state,
      getSeasonalColoringEnabled
    );
    const theme = getDeckTheme(state, seasonalColoringEnabled);
    const deckThemeKey = getDeckThemeKey(state, seasonalColoringEnabled);
    if (deckThemeKey !== lastDeckThemeKey) {
      drawDeckBody(
        deckBody,
        Number(layout?.width ?? 72),
        Number(layout?.height ?? 98),
        theme
      );
      lastDeckThemeKey = deckThemeKey;
    }
    deckLabel.text = "Deck";
    deckLabel.style.fill = theme.cardEdge;
    deckLabel.x = Math.floor(-deckLabel.width * 0.5);
    deckLabel.y = Math.floor(-deckLabel.height * 0.5);

    const timeSec = getTimeSecForVisuals(state);
    const cadence = Math.max(1, Math.floor(ENV_EVENT_DRAW_CADENCE_SEC));
    const progress = clamp01((timeSec % cadence) / cadence);
    drawTimerRing(
      timerRing,
      Math.max(44, Number(layout?.height ?? 98) * 0.64),
      progress,
      theme
    );
  }

  function updateMotionPlayback(dt) {
    const frameDt = Number.isFinite(dt) && dt > 0 ? dt : 1 / 60;
    for (let i = activeMotions.length - 1; i >= 0; i--) {
      const motion = activeMotions[i];
      if (!motion || !motion.sprite) {
        activeMotions.splice(i, 1);
        continue;
      }
      motion.ageSec += frameDt;
      const localSec = motion.ageSec - motion.delaySec;
      if (localSec < 0) {
        motion.sprite.visible = false;
        continue;
      }
      motion.sprite.visible = true;
      const duration = Math.max(0.1, motion.durationSec);
      const t = clamp01(localSec / duration);

      let x = motion.startX;
      let y = motion.startY;
      let alpha = 0.98;
      let flipProgress = t;

      if (motion.kind === "returned") {
        const outT = t <= 0.5 ? t * 2 : (1 - t) * 2;
        const eased = easeOutCubic(outT);
        x = lerp(motion.startX, motion.endX, eased);
        y = lerp(motion.startY, motion.endY, eased) - Math.sin(outT * Math.PI) * 9;
        alpha = t <= 0.5 ? 0.98 : 0.98 - (t - 0.5) * 1.1;
        flipProgress = outT;
      } else {
        const eased = easeInOutSine(t);
        x = lerp(motion.startX, motion.endX, eased);
        y =
          lerp(motion.startY, motion.endY, eased) -
          Math.sin(eased * Math.PI) * (motion.arcHeight ?? 0);
        if (motion.kind === "consumed") {
          alpha = motion.direction >= 0 ? 1 - eased : eased;
        }
      }

      const flip = 0.22 + 0.78 * Math.abs(Math.cos(flipProgress * Math.PI));
      const baseScale = 1;
      motion.sprite.scale.set(baseScale * flip, baseScale);
      motion.sprite.x = x;
      motion.sprite.y = y;
      motion.sprite.alpha = clamp01(alpha);

      if (localSec >= duration) {
        motion.sprite.removeFromParent();
        motion.sprite.destroy({ children: true });
        activeMotions.splice(i, 1);
      }
    }
    syncEventRevealLocksFromMotions(activeMotions);
  }

  function updateOverflowBadge(dt) {
    if (!overflowBadge) return;
    const frameDt = Number.isFinite(dt) && dt > 0 ? dt : 1 / 60;
    if (overflowBadgeSecRemaining > 0) {
      overflowBadgeSecRemaining = Math.max(0, overflowBadgeSecRemaining - frameDt);
      overflowBadge.alpha = clamp01(overflowBadgeSecRemaining / 0.35);
      overflowBadge.visible = true;
      return;
    }
    overflowBadge.visible = false;
  }

  function ensureCreated() {
    if (!app || !layer) return { ok: false, reason: "missingViewDeps" };
    if (root) return { ok: true };

    root = new PIXI.Container();
    root.sortableChildren = true;
    root.zIndex = Number.isFinite(layout?.zIndex) ? layout.zIndex : 1;
    solidHitArea = installSolidUiHitArea(root, () => {
      const bounds = root.getLocalBounds?.() ?? null;
      return {
        x: 0,
        y: 0,
        width: bounds?.width ?? 0,
        height: bounds?.height ?? 0,
      };
    });

    deckContainer = new PIXI.Container();
    deckContainer.eventMode = "none";
    deckContainer.zIndex = 1;
    root.addChild(deckContainer);

    timerRing = new PIXI.Graphics();
    timerRing.zIndex = 1;
    deckContainer.addChild(timerRing);

    deckBody = new PIXI.Graphics();
    deckBody.zIndex = 2;
    deckContainer.addChild(deckBody);

    deckLabel = new PIXI.Text("Deck", {
      fill: 0xffffff,
      fontSize: 13,
      fontFamily: "Arial",
      fontWeight: "bold",
      align: "center",
    });
    deckLabel.zIndex = 3;
    deckContainer.addChild(deckLabel);

    fxLayer = new PIXI.Container();
    fxLayer.eventMode = "none";
    fxLayer.sortableChildren = true;
    fxLayer.zIndex = 4;
    root.addChild(fxLayer);

    overflowBadge = new PIXI.Container();
    overflowBadge.eventMode = "none";
    overflowBadge.visible = false;
    overflowBadge.zIndex = 4;
    const overflowBg = new PIXI.Graphics();
    overflowBg
      .lineStyle(1, 0xfff2c9, 0.95)
      .beginFill(0xa54b20, 0.96)
      .drawRoundedRect(-12, -9, 24, 18, 7)
      .endFill();
    overflowText = new PIXI.Text("+0", {
      fill: 0xfff2c9,
      fontSize: 10,
      fontFamily: "Arial",
      fontWeight: "bold",
    });
    overflowBadge.addChild(overflowBg, overflowText);
    deckContainer.addChild(overflowBadge);

    layer.addChild(root);
    return { ok: true };
  }

  function applyLayout() {
    if (!deckContainer || !getState) return;
    const state = getState();
    const pos = getDeckAnchorPosition({
      app,
      state,
      layout,
      sunMoonLayout,
    });
    deckContainer.x = pos.x;
    deckContainer.y = pos.y;
    if (overflowBadge) {
      overflowBadge.x = Math.round((layout?.width ?? 72) * 0.42);
      overflowBadge.y = Math.round(-(layout?.height ?? 98) * 0.46);
    }
    solidHitArea?.refresh?.();
  }

  function init() {
    const res = ensureCreated();
    if (!res.ok) return res;
    applyLayout();
    const state = getState?.();
    const enabled = resolveDeckVisibilityEnabled(
      state,
      layout,
      getDeckVisibilityEnabled
    );
    root.visible = enabled;
    lastEnabled = enabled;
    if (state) {
      lastSeenSec = getSafeStateSecond(state);
      if (enabled) drawDeckStatic(state);
    }
    return { ok: true };
  }

  function update(frameDt) {
    if (!root || !getState) {
      eventRevealLockRemainingByInstanceId.clear();
      return;
    }

    const state = getState();
    if (!state) {
      eventRevealLockRemainingByInstanceId.clear();
      return;
    }

    const enabled = resolveDeckVisibilityEnabled(
      state,
      layout,
      getDeckVisibilityEnabled
    );
    if (enabled !== lastEnabled) {
      root.visible = enabled;
      lastEnabled = enabled;
      clearMotions();
      lastSeenSec = getSafeStateSecond(state);
      if (enabled) {
        applyLayout();
        drawDeckStatic(state);
      }
    }
    if (!enabled) return;

    applyLayout();
    drawDeckStatic(state);

    const nowSec = getSafeStateSecond(state);
    if (Number.isFinite(lastSeenSec)) {
      if (nowSec !== lastSeenSec) {
        processCrossedSeconds(lastSeenSec, nowSec, state);
      }
    }
    lastSeenSec = nowSec;

    updateMotionPlayback(frameDt);
    updateOverflowBadge(frameDt);
  }

  function destroy() {
    clearMotions();
    drawEventCache.clear();
    drawEventCacheOrder.length = 0;
    if (!root) return;
    root.removeFromParent();
    root.destroy({ children: true });
    root = null;
    deckContainer = null;
    deckBody = null;
    timerRing = null;
    deckLabel = null;
    fxLayer = null;
    overflowBadge = null;
    overflowText = null;
    solidHitArea = null;
  }

  return {
    init,
    update,
    applyLayout,
    destroy,
    getRoot: () => root,
    getScreenRect: () =>
      !root || !root.visible || typeof root.getBounds !== "function"
        ? null
        : root.getBounds(),
  };
}
