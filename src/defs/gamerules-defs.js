// gamerules-defs.js
// Gameplay rules and tuning constants.

export const SEASON_DURATION_SEC = 32; // seconds of simulation per season

// --- Moon / Action Point Cap ---
export const MOON_CYCLE_SEC = 30;
export const MOON_PHASE_OFFSET_SEC = 0;
export const AP_CAP_MIN = 0;
export const AP_CAP_MAX = 120;
export const AP_INCOME_PER_SEC = 8;
export const BASE_PROJECTION_HORIZON_SEC = 1200;

export const SEASONS = ["spring", "summer", "autumn", "winter"];

export const SEASON_DISPLAY = {
  spring: "Spring",
  summer: "Summer",
  autumn: "Autumn",
  winter: "Winter",
};
