import { createMuchaPaintFilter } from "./filters/mucha-paint-filter.js";
import {
  computeTimeWarp,
  getVisualTimeSec,
} from "./filters/mucha-time-uniforms.js";

const VALID_QUALITIES = new Set(["low", "medium", "high"]);

const QUALITY_PRESETS = {
  low: {
    resolutionScale: 1,
    intensityScale: 0.62,
    mottleScale: 0.6,
    grainScale: 0.55,
    bleedScale: 0.5,
    noiseScale: 0.85,
  },
  medium: {
    resolutionScale: 1,
    intensityScale: 1,
    mottleScale: 1,
    grainScale: 1,
    bleedScale: 1,
    noiseScale: 1,
  },
  high: {
    resolutionScale: 1,
    intensityScale: 1.18,
    mottleScale: 1.22,
    grainScale: 1.24,
    bleedScale: 1,
    noiseScale: 1.2,
  },
};

function toFinite(value, fallback) {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function clampRange(value, min, max, fallback = min) {
  if (!Number.isFinite(value)) return fallback;
  if (value <= min) return min;
  if (value >= max) return max;
  return value;
}

function normalizeQuality(value, fallback = "medium") {
  const key = typeof value === "string" ? value.toLowerCase() : "";
  if (VALID_QUALITIES.has(key)) return key;
  return fallback;
}

function normalizeConfig(layout = null) {
  const cfg = layout && typeof layout === "object" ? layout : {};
  return {
    enabled: cfg.enabled !== false,
    quality: normalizeQuality(cfg.quality, "medium"),
    intensity: clampRange(toFinite(cfg.intensity, 1), 0, 1.5, 1),
    mottling: clampRange(toFinite(cfg.mottling, 0.6), 0, 1.5, 0.6),
    warmth: clamp01(toFinite(cfg.warmth, 0.7)),
    grain: clampRange(toFinite(cfg.grain, 0.7), 0, 1.5, 0.7),
    colorBleed: clampRange(toFinite(cfg.colorBleed, 0.4), 0, 1, 0.4),
    timeReactive: cfg.timeReactive !== false,
    driftWindowSec: Math.max(1, Math.floor(toFinite(cfg.driftWindowSec, 120))),
    forecastBoost: clamp01(toFinite(cfg.forecastBoost, 0.35)),
    historyBoost: clamp01(toFinite(cfg.historyBoost, 0.18)),
  };
}

function attachFilter(container, filter) {
  if (!container || !filter) return;
  const existing = Array.isArray(container?.filters)
    ? container.filters.slice()
    : [];
  if (!existing.includes(filter)) {
    existing.push(filter);
  }
  container.filters = existing;
}

function detachFilter(container, filter) {
  if (!container || !filter) return;
  const existing = Array.isArray(container.filters)
    ? container.filters.slice()
    : [];
  const next = existing.filter((entry) => entry !== filter);
  container.filters = next.length > 0 ? next : null;
}

function sanitizeUniform(uniforms, key, fallback = 0) {
  if (!uniforms || typeof uniforms !== "object") return fallback;
  const value = Number(uniforms[key]);
  if (!Number.isFinite(value)) {
    uniforms[key] = fallback;
    return fallback;
  }
  return value;
}

function ensureVec2Uniform(uniforms, key) {
  if (!uniforms || typeof uniforms !== "object") return [0, 0];
  const current = uniforms[key];
  if (Array.isArray(current) && current.length >= 2) {
    if (!Number.isFinite(current[0])) current[0] = 0;
    if (!Number.isFinite(current[1])) current[1] = 0;
    return current;
  }
  if (
    current &&
    typeof current === "object" &&
    Number.isFinite(current[0]) &&
    Number.isFinite(current[1])
  ) {
    return current;
  }
  const next = [0, 0];
  uniforms[key] = next;
  return next;
}

export function createPlayfieldMuchaStyle({
  layout = null,
  getState,
  getTimeline,
  getPreviewStatus,
} = {}) {
  const config = normalizeConfig(layout);
  let enabled = config.enabled;
  let quality = config.quality;
  let lastError = null;

  /** @type {Map<any, { container: any, filter: any }>} */
  const registry = new Map();

  function createFilterSafe() {
    try {
      const filter = createMuchaPaintFilter();
      if (!filter || typeof filter !== "object") {
        throw new Error("createMuchaPaintFilter() returned invalid filter");
      }
      return filter;
    } catch (err) {
      lastError =
        err && typeof err.message === "string" && err.message.length > 0
          ? err.message
          : "failed to create Mucha paint filter";
      return null;
    }
  }

  function applyQualityToFilter(filter, preset) {
    if (!filter || !preset) return;
    filter.resolution = preset.resolutionScale;
    filter.padding = preset.bleedScale > 0 ? 2 : 0;
  }

  function ensureEntryFilter(entry, preset) {
    if (!entry || entry.filter) return entry?.filter || null;
    const filter = createFilterSafe();
    if (!filter) return null;
    entry.filter = filter;
    applyQualityToFilter(filter, preset);
    return filter;
  }

  function registerPaintContainer(container) {
    if (!container || typeof container !== "object") return false;
    if (registry.has(container)) return true;

    const preset = QUALITY_PRESETS[quality];
    const filter = createFilterSafe();
    const entry = { container, filter };
    registry.set(container, entry);

    if (enabled && filter) {
      attachFilter(container, filter);
    }

    applyQualityToFilter(filter, preset);
    return true;
  }

  function unregisterPaintContainer(container) {
    const entry = registry.get(container);
    if (!entry) return false;
    detachFilter(entry.container, entry.filter);
    registry.delete(container);
    return true;
  }

  function setEnabled(nextEnabled) {
    if (typeof nextEnabled !== "boolean") {
      return enabled;
    }
    enabled = nextEnabled;
    for (const entry of registry.values()) {
      if (!entry?.container || entry.container.destroyed) continue;
      const preset = QUALITY_PRESETS[quality];
      const filter = ensureEntryFilter(entry, preset);
      if (enabled) {
        attachFilter(entry.container, filter);
      } else {
        detachFilter(entry.container, entry.filter);
      }
    }
    return enabled;
  }

  function setQuality(nextQuality) {
    quality = normalizeQuality(nextQuality, quality);
    return quality;
  }

  function getStateSnapshot() {
    let attachedCount = 0;
    let nullFilterCount = 0;
    for (const entry of registry.values()) {
      const filter = entry?.filter || null;
      if (!filter) {
        nullFilterCount += 1;
        continue;
      }
      const active = Array.isArray(entry?.container?.filters)
        ? entry.container.filters.includes(filter)
        : false;
      if (active) attachedCount += 1;
    }
    return {
      enabled,
      quality,
      registeredCount: registry.size,
      attachedCount,
      nullFilterCount,
      lastError,
      config: {
        intensity: config.intensity,
        mottling: config.mottling,
        warmth: config.warmth,
        grain: config.grain,
        colorBleed: config.colorBleed,
        timeReactive: config.timeReactive,
        driftWindowSec: config.driftWindowSec,
        forecastBoost: config.forecastBoost,
        historyBoost: config.historyBoost,
      },
    };
  }

  function update() {
    const state = typeof getState === "function" ? getState() : null;
    const timeline = typeof getTimeline === "function" ? getTimeline() : null;
    const preview =
      typeof getPreviewStatus === "function" ? getPreviewStatus() : null;

    const timeSec = getVisualTimeSec(state);
    const warpInfo = computeTimeWarp({
      state,
      timeline,
      preview,
      timeReactive: config.timeReactive,
      driftWindowSec: config.driftWindowSec,
      forecastBoost: config.forecastBoost,
      historyBoost: config.historyBoost,
    });

    const preset = QUALITY_PRESETS[quality];
    const warp = clamp01(warpInfo.warp);

    const intensity = clampRange(
      config.intensity * preset.intensityScale * (1 + warp * 0.22),
      0,
      1.5,
      config.intensity
    );
    const mottling = clampRange(
      config.mottling * preset.mottleScale * (1 + warp * 0.12),
      0,
      1.5,
      config.mottling
    );
    const warmth = clamp01(
      config.warmth * (1 + warp * 0.15)
    );
    const grain = clampRange(
      config.grain * preset.grainScale * (1 + warp * 0.2),
      0,
      1.5,
      config.grain
    );
    const colorBleed = clampRange(
      config.colorBleed * preset.bleedScale * (1 + warp * 0.35),
      0,
      1,
      config.colorBleed
    );

    for (const [container, entry] of registry.entries()) {
      if (!container || container.destroyed) {
        registry.delete(container);
        continue;
      }
      const filter = ensureEntryFilter(entry, preset);

      if (enabled) {
        attachFilter(entry.container, filter);
      } else {
        detachFilter(entry.container, entry.filter);
      }

      if (!filter) {
        continue;
      }

      filter.resolution = preset.resolutionScale;
      filter.padding = colorBleed > 0 ? 2 : 0;

      const uniforms = filter.uniforms;
      sanitizeUniform(uniforms, "u_timeSec", 0);
      sanitizeUniform(uniforms, "u_timeWarp", 0);
      sanitizeUniform(uniforms, "u_intensity", config.intensity);
      sanitizeUniform(uniforms, "u_mottling", config.mottling);
      sanitizeUniform(uniforms, "u_warmth", config.warmth);
      sanitizeUniform(uniforms, "u_grain", config.grain);
      sanitizeUniform(uniforms, "u_colorBleed", config.colorBleed);
      sanitizeUniform(uniforms, "u_noiseScale", 1);
      const worldOffset = ensureVec2Uniform(uniforms, "u_worldOffset");
      const wt = container.worldTransform;
      const offsetX = Number.isFinite(wt?.tx) ? wt.tx : 0;
      const offsetY = Number.isFinite(wt?.ty) ? wt.ty : 0;
      uniforms.u_timeSec = timeSec;
      uniforms.u_timeWarp = warp;
      uniforms.u_intensity = intensity;
      uniforms.u_mottling = mottling;
      uniforms.u_warmth = warmth;
      uniforms.u_grain = grain;
      uniforms.u_colorBleed = colorBleed;
      uniforms.u_noiseScale = preset.noiseScale;
      worldOffset[0] = offsetX;
      worldOffset[1] = offsetY;
    }
  }

  function destroy() {
    for (const entry of registry.values()) {
      detachFilter(entry.container, entry.filter);
    }
    registry.clear();
  }

  return {
    registerPaintContainer,
    unregisterPaintContainer,
    setEnabled,
    setQuality,
    getState: getStateSnapshot,
    update,
    destroy,
  };
}
