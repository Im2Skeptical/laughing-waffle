import { createMuchaPaintFilter } from "./filters/mucha-paint-filter.js";
import {
  computeTimeWarp,
  getVisualTimeSec,
} from "./filters/mucha-time-uniforms.js";

const VALID_QUALITIES = new Set(["low", "medium", "high"]);
const VALID_PROFILE_NAMES = new Set(["playfield", "backdrop", "topbar"]);

const DEFAULT_PROFILE_CONFIGS = Object.freeze({
  playfield: Object.freeze({
    intensity: 1,
    mottling: 0.6,
    warmth: 0.7,
    vintageAmount: 0.7,
    grain: 0.65,
    misregister: 0.2,
    misregisterMode: 1,
    wobbleAmount: 0.14,
    wobbleScale: 1.5,
    wobbleSpeed: 0.4,
    vignetteStrength: 0.06,
    vignetteInner: 0.36,
    vignetteOuter: 0.92,
    alwaysAnimated: false,
  }),
  backdrop: Object.freeze({
    intensity: 0.86,
    mottling: 0.55,
    warmth: 0.82,
    vintageAmount: 0.9,
    grain: 0.45,
    misregister: 0.24,
    misregisterMode: 1,
    wobbleAmount: 0.3,
    wobbleScale: 1.8,
    wobbleSpeed: 0.6,
    vignetteStrength: 0.24,
    vignetteInner: 0.24,
    vignetteOuter: 0.9,
    alwaysAnimated: true,
  }),
  topbar: Object.freeze({
    intensity: 0.72,
    mottling: 0.36,
    warmth: 0.76,
    vintageAmount: 0.86,
    grain: 0.24,
    misregister: 0.16,
    misregisterMode: 1,
    wobbleAmount: 0.18,
    wobbleScale: 2.2,
    wobbleSpeed: 0.5,
    vignetteStrength: 0.12,
    vignetteInner: 0.18,
    vignetteOuter: 0.88,
    alwaysAnimated: true,
  }),
});

const QUALITY_PRESETS = Object.freeze({
  low: Object.freeze({
    resolutionScale: 1,
    intensityScale: 0.65,
    mottleScale: 0.65,
    grainScale: 0.55,
    bleedScale: 0.5,
    noiseScale: 0.82,
  }),
  medium: Object.freeze({
    resolutionScale: 1,
    intensityScale: 1,
    mottleScale: 1,
    grainScale: 1,
    bleedScale: 1,
    noiseScale: 1,
  }),
  high: Object.freeze({
    resolutionScale: 1,
    intensityScale: 1.16,
    mottleScale: 1.2,
    grainScale: 1.22,
    bleedScale: 1.08,
    noiseScale: 1.2,
  }),
});

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

function normalizeProfileName(value, fallback = "playfield") {
  const key = typeof value === "string" ? value.toLowerCase() : "";
  if (VALID_PROFILE_NAMES.has(key)) return key;
  return fallback;
}

function resolveMisregister(raw, fallback) {
  if (Number.isFinite(raw?.misregister)) return Number(raw.misregister);
  if (Number.isFinite(raw?.colorBleed)) return Number(raw.colorBleed);
  return fallback;
}

function resolveVintage(raw, fallback) {
  if (Number.isFinite(raw?.vintageAmount)) return Number(raw.vintageAmount);
  if (Number.isFinite(raw?.vintageAge)) return Number(raw.vintageAge);
  return fallback;
}

function resolveWobbleAmount(raw, fallback) {
  if (Number.isFinite(raw?.wobbleAmount)) return Number(raw.wobbleAmount);
  if (Number.isFinite(raw?.lineWobble)) return Number(raw.lineWobble);
  return fallback;
}

function resolveAlwaysAnimated(raw, fallback) {
  if (typeof raw?.alwaysAnimated === "boolean") return raw.alwaysAnimated;
  return fallback;
}

function normalizeProfileConfig(
  rawProfile = null,
  fallbackProfile = DEFAULT_PROFILE_CONFIGS.playfield
) {
  const src = rawProfile && typeof rawProfile === "object" ? rawProfile : {};
  const fallback = fallbackProfile || DEFAULT_PROFILE_CONFIGS.playfield;
  const vignetteInner = clampRange(
    toFinite(src.vignetteInner, fallback.vignetteInner),
    0,
    0.95,
    fallback.vignetteInner
  );
  const vignetteOuterRaw = clampRange(
    toFinite(src.vignetteOuter, fallback.vignetteOuter),
    vignetteInner + 0.01,
    1.4,
    fallback.vignetteOuter
  );
  return {
    intensity: clampRange(
      toFinite(src.intensity, fallback.intensity),
      0,
      1.5,
      fallback.intensity
    ),
    mottling: clampRange(
      toFinite(src.mottling, fallback.mottling),
      0,
      1.5,
      fallback.mottling
    ),
    warmth: clamp01(toFinite(src.warmth, fallback.warmth)),
    vintageAmount: clamp01(resolveVintage(src, fallback.vintageAmount)),
    grain: clampRange(
      toFinite(src.grain, fallback.grain),
      0,
      1.5,
      fallback.grain
    ),
    misregister: clampRange(
      resolveMisregister(src, fallback.misregister),
      0,
      1,
      fallback.misregister
    ),
    misregisterMode: clampRange(
      toFinite(src.misregisterMode, fallback.misregisterMode),
      0,
      1,
      fallback.misregisterMode
    ) >= 0.5
      ? 1
      : 0,
    wobbleAmount: clampRange(
      resolveWobbleAmount(src, fallback.wobbleAmount),
      0,
      1.5,
      fallback.wobbleAmount
    ),
    wobbleScale: clampRange(
      toFinite(src.wobbleScale, fallback.wobbleScale),
      0.1,
      8,
      fallback.wobbleScale
    ),
    wobbleSpeed: clampRange(
      toFinite(src.wobbleSpeed, fallback.wobbleSpeed),
      0,
      8,
      fallback.wobbleSpeed
    ),
    vignetteStrength: clamp01(
      toFinite(src.vignetteStrength, fallback.vignetteStrength)
    ),
    vignetteInner,
    vignetteOuter: vignetteOuterRaw,
    alwaysAnimated: resolveAlwaysAnimated(src, fallback.alwaysAnimated),
  };
}

export function normalizeMuchaStyleConfig(layout = null) {
  const cfg = layout && typeof layout === "object" ? layout : {};
  const profileBag =
    cfg.profiles && typeof cfg.profiles === "object" ? cfg.profiles : null;
  const playfieldSource = profileBag?.playfield ?? cfg;
  const backdropSource = profileBag?.backdrop ?? null;
  const topbarSource = profileBag?.topbar ?? null;

  return {
    enabled: cfg.enabled !== false,
    quality: normalizeQuality(cfg.quality, "medium"),
    timeReactive: cfg.timeReactive !== false,
    driftWindowSec: Math.max(1, Math.floor(toFinite(cfg.driftWindowSec, 120))),
    forecastBoost: clamp01(toFinite(cfg.forecastBoost, 0.35)),
    historyBoost: clamp01(toFinite(cfg.historyBoost, 0.18)),
    profiles: {
      playfield: normalizeProfileConfig(
        playfieldSource,
        DEFAULT_PROFILE_CONFIGS.playfield
      ),
      backdrop: normalizeProfileConfig(
        backdropSource,
        DEFAULT_PROFILE_CONFIGS.backdrop
      ),
      topbar: normalizeProfileConfig(topbarSource, DEFAULT_PROFILE_CONFIGS.topbar),
    },
  };
}

export function computeProfileAnimationWarp(baseWarp, alwaysAnimated = false) {
  const warp = clamp01(baseWarp);
  if (!alwaysAnimated) return warp;
  return clamp01(Math.max(0.22, warp));
}

function attachFilter(container, filter) {
  if (!container || !filter) return;
  const existing = Array.isArray(container.filters) ? container.filters.slice() : [];
  if (!existing.includes(filter)) {
    existing.push(filter);
  }
  container.filters = existing;
}

function detachFilter(container, filter) {
  if (!container || !filter) return;
  const existing = Array.isArray(container.filters) ? container.filters.slice() : [];
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
  const next = [0, 0];
  uniforms[key] = next;
  return next;
}

function buildProfileCounts() {
  return {
    playfield: { registered: 0, attached: 0, nullFilters: 0 },
    backdrop: { registered: 0, attached: 0, nullFilters: 0 },
    topbar: { registered: 0, attached: 0, nullFilters: 0 },
  };
}

export function createPlayfieldMuchaStyle({
  layout = null,
  getState,
  getTimeline,
  getPreviewStatus,
  getViewportSize,
  getPlayfieldCameraState,
  getPlayfieldWorldBounds,
} = {}) {
  const config = normalizeMuchaStyleConfig(layout);
  let enabled = config.enabled;
  let quality = config.quality;
  let lastError = null;

  /** @type {Map<any, { container: any, filter: any, profile: "playfield"|"backdrop"|"topbar" }>} */
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

  function applyQualityToFilter(filter, preset, misregister = 0) {
    if (!filter || !preset) return;
    filter.resolution = preset.resolutionScale;
    filter.padding = misregister > 0.001 ? 2 : 1;
  }

  function ensureEntryFilter(entry, preset, misregister = 0) {
    if (!entry) return null;
    if (entry.filter) {
      applyQualityToFilter(entry.filter, preset, misregister);
      return entry.filter;
    }
    const filter = createFilterSafe();
    if (!filter) return null;
    entry.filter = filter;
    applyQualityToFilter(filter, preset, misregister);
    return filter;
  }

  function registerPaintContainer(container, opts = null) {
    if (!container || typeof container !== "object") return false;
    const nextProfile = normalizeProfileName(opts?.profile, "playfield");
    const existing = registry.get(container);
    if (existing) {
      existing.profile = nextProfile;
      return true;
    }

    const entry = { container, filter: null, profile: nextProfile };
    registry.set(container, entry);

    if (enabled) {
      const preset = QUALITY_PRESETS[quality];
      const profileCfg = config.profiles[nextProfile] || config.profiles.playfield;
      const filter = ensureEntryFilter(entry, preset, profileCfg.misregister);
      if (filter) {
        attachFilter(container, filter);
      }
    }
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
    if (typeof nextEnabled !== "boolean") return enabled;
    enabled = nextEnabled;
    for (const entry of registry.values()) {
      if (!entry?.container || entry.container.destroyed) continue;
      const preset = QUALITY_PRESETS[quality];
      const profileCfg = config.profiles[entry.profile] || config.profiles.playfield;
      const filter = ensureEntryFilter(entry, preset, profileCfg.misregister);
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
    const profileCounts = buildProfileCounts();
    let attachedCount = 0;
    let nullFilterCount = 0;

    for (const entry of registry.values()) {
      const profileName = normalizeProfileName(entry?.profile, "playfield");
      const bucket = profileCounts[profileName];
      bucket.registered += 1;

      const filter = entry?.filter || null;
      if (!filter) {
        nullFilterCount += 1;
        bucket.nullFilters += 1;
        continue;
      }

      const active = Array.isArray(entry?.container?.filters)
        ? entry.container.filters.includes(filter)
        : false;
      if (active) {
        attachedCount += 1;
        bucket.attached += 1;
      }
    }

    return {
      enabled,
      quality,
      registeredCount: registry.size,
      attachedCount,
      nullFilterCount,
      lastError,
      profileCounts,
      config,
    };
  }

  function update() {
    if (registry.size <= 0) return;

    if (!enabled) {
      for (const [container, entry] of registry.entries()) {
        if (!container || container.destroyed) {
          registry.delete(container);
          continue;
        }
        detachFilter(entry.container, entry.filter);
      }
      return;
    }

    const state = typeof getState === "function" ? getState() : null;
    const timeline = typeof getTimeline === "function" ? getTimeline() : null;
    const preview =
      typeof getPreviewStatus === "function" ? getPreviewStatus() : null;
    const viewport =
      typeof getViewportSize === "function" ? getViewportSize() : null;
    const stageWidth = Math.max(1, Math.floor(viewport?.width ?? 1));
    const stageHeight = Math.max(1, Math.floor(viewport?.height ?? 1));

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
    const baseWarp = clamp01(warpInfo.warp);
    const playfieldCameraState =
      typeof getPlayfieldCameraState === "function"
        ? getPlayfieldCameraState()
        : null;
    const playfieldWorldBounds =
      typeof getPlayfieldWorldBounds === "function"
        ? getPlayfieldWorldBounds()
        : null;

    for (const [container, entry] of registry.entries()) {
      if (!container || container.destroyed) {
        registry.delete(container);
        continue;
      }

      const profileName = normalizeProfileName(entry.profile, "playfield");
      entry.profile = profileName;
      const profile = config.profiles[profileName] || config.profiles.playfield;
      const animationWarp = computeProfileAnimationWarp(
        baseWarp,
        profile.alwaysAnimated
      );

      const intensity = clampRange(
        profile.intensity * preset.intensityScale * (1 + animationWarp * 0.16),
        0,
        1.5,
        profile.intensity
      );
      const mottling = clampRange(
        profile.mottling * preset.mottleScale * (1 + animationWarp * 0.1),
        0,
        1.5,
        profile.mottling
      );
      const warmth = clamp01(profile.warmth * (1 + animationWarp * 0.06));
      const vintageAmount = clamp01(
        profile.vintageAmount * (1 + animationWarp * 0.08)
      );
      const grain = clampRange(
        profile.grain * preset.grainScale * (1 + animationWarp * 0.12),
        0,
        1.5,
        profile.grain
      );
      const misregister = clampRange(
        profile.misregister * preset.bleedScale * (1 + animationWarp * 0.18),
        0,
        1,
        profile.misregister
      );
      const wobbleAmount = clampRange(
        profile.wobbleAmount * (0.84 + animationWarp * 0.36),
        0,
        1.5,
        profile.wobbleAmount
      );
      const wobbleScale = clampRange(
        profile.wobbleScale * (0.95 + animationWarp * 0.08),
        0.1,
        8,
        profile.wobbleScale
      );
      const wobbleSpeed = clampRange(
        profile.wobbleSpeed * (0.88 + animationWarp * 0.22),
        0,
        8,
        profile.wobbleSpeed
      );
      const vignetteStrength = clamp01(profile.vignetteStrength);
      const vignetteInner = clampRange(
        profile.vignetteInner,
        0,
        0.95,
        profile.vignetteInner
      );
      const vignetteOuter = clampRange(
        Math.max(profile.vignetteOuter, vignetteInner + 0.01),
        vignetteInner + 0.01,
        1.4,
        profile.vignetteOuter
      );

      const filter = ensureEntryFilter(entry, preset, misregister);
      attachFilter(entry.container, filter);
      if (!filter) continue;

      applyQualityToFilter(filter, preset, misregister);
      const uniforms = filter.uniforms;
      sanitizeUniform(uniforms, "u_timeSec", 0);
      sanitizeUniform(uniforms, "u_timeWarp", 0);
      sanitizeUniform(uniforms, "u_intensity", profile.intensity);
      sanitizeUniform(uniforms, "u_mottling", profile.mottling);
      sanitizeUniform(uniforms, "u_warmth", profile.warmth);
      sanitizeUniform(uniforms, "u_vintageAmount", profile.vintageAmount);
      sanitizeUniform(uniforms, "u_grain", profile.grain);
      sanitizeUniform(uniforms, "u_colorBleed", profile.misregister);
      sanitizeUniform(uniforms, "u_noiseScale", 1);
      sanitizeUniform(uniforms, "u_wobbleAmount", profile.wobbleAmount);
      sanitizeUniform(uniforms, "u_wobbleScale", profile.wobbleScale);
      sanitizeUniform(uniforms, "u_wobbleSpeed", profile.wobbleSpeed);
      sanitizeUniform(
        uniforms,
        "u_misregisterMode",
        profile.misregisterMode >= 1 ? 1 : 0
      );
      sanitizeUniform(uniforms, "u_vignetteStrength", profile.vignetteStrength);
      sanitizeUniform(uniforms, "u_vignetteInner", profile.vignetteInner);
      sanitizeUniform(uniforms, "u_vignetteOuter", profile.vignetteOuter);
      sanitizeUniform(uniforms, "u_worldSpaceMode", 0);
      sanitizeUniform(uniforms, "u_cameraScale", 1);

      const stageSize = ensureVec2Uniform(uniforms, "u_stageSize");
      const worldOffset = ensureVec2Uniform(uniforms, "u_worldOffset");
      const cameraPosition = ensureVec2Uniform(uniforms, "u_cameraPosition");
      if (!Array.isArray(uniforms.u_worldBounds) || uniforms.u_worldBounds.length < 4) {
        uniforms.u_worldBounds = [0, 0, 1, 1];
      }
      const worldBoundsVec4 = uniforms.u_worldBounds;
      const useWorldSpace =
        profileName === "playfield" || profileName === "backdrop";
      const cameraX = Number.isFinite(playfieldCameraState?.x)
        ? playfieldCameraState.x
        : 0;
      const cameraY = Number.isFinite(playfieldCameraState?.y)
        ? playfieldCameraState.y
        : 0;
      const cameraScale = Number.isFinite(playfieldCameraState?.scale)
        ? playfieldCameraState.scale
        : 1;
      const worldBoundsX = Number.isFinite(playfieldWorldBounds?.minX)
        ? playfieldWorldBounds.minX
        : 0;
      const worldBoundsY = Number.isFinite(playfieldWorldBounds?.minY)
        ? playfieldWorldBounds.minY
        : 0;
      const worldBoundsWidth = Number.isFinite(playfieldWorldBounds?.width)
        ? playfieldWorldBounds.width
        : stageWidth;
      const worldBoundsHeight = Number.isFinite(playfieldWorldBounds?.height)
        ? playfieldWorldBounds.height
        : stageHeight;

      uniforms.u_timeSec = timeSec;
      uniforms.u_timeWarp = animationWarp;
      uniforms.u_intensity = intensity;
      uniforms.u_mottling = mottling;
      uniforms.u_warmth = warmth;
      uniforms.u_vintageAmount = vintageAmount;
      uniforms.u_grain = grain;
      uniforms.u_colorBleed = misregister;
      uniforms.u_noiseScale = preset.noiseScale;
      uniforms.u_wobbleAmount = wobbleAmount;
      uniforms.u_wobbleScale = wobbleScale;
      uniforms.u_wobbleSpeed = wobbleSpeed;
      uniforms.u_misregisterMode = profile.misregisterMode;
      uniforms.u_vignetteStrength = vignetteStrength;
      uniforms.u_vignetteInner = vignetteInner;
      uniforms.u_vignetteOuter = vignetteOuter;
      uniforms.u_worldSpaceMode = useWorldSpace ? 1 : 0;
      stageSize[0] = stageWidth;
      stageSize[1] = stageHeight;
      worldOffset[0] = 0;
      worldOffset[1] = 0;
      cameraPosition[0] = cameraX;
      cameraPosition[1] = cameraY;
      uniforms.u_cameraScale = cameraScale;
      worldBoundsVec4[0] = worldBoundsX;
      worldBoundsVec4[1] = worldBoundsY;
      worldBoundsVec4[2] = worldBoundsWidth;
      worldBoundsVec4[3] = worldBoundsHeight;
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
