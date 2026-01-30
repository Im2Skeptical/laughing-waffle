// gamerules-defs.js
// Gameplay rules and tuning constants.

import "../env-defs-dev.js";

export const SEASON_DURATION_SEC = 32; // seconds of simulation per season

// --- Moon / Action Point Cap ---
export const MOON_CYCLE_SEC = 30;
export const MOON_PHASE_OFFSET_SEC = 15;
export const AP_CAP_MIN = 0;
export const AP_CAP_MAX = 120;
export const AP_INCOME_PER_SEC = 1;
export const AP_INCOME_MULT_WAXING = 8;
export const AP_INCOME_MULT_WANING = 0;
export const BASE_PROJECTION_HORIZON_SEC = 350;

export const SEASONS = ["spring", "summer", "autumn", "winter"];

export const SEASON_DISPLAY = {
  spring: "Spring",
  summer: "Summer",
  autumn: "Autumn",
  winter: "Winter",
};

// --- Prestige + Followers ---
export const PRESTIGE_COST_PER_FOLLOWER = 10;
export const HUNGER_THRESHOLD = 40;
export const SECONDS_BELOW_HUNGER_THRESHOLD = 5;
export const PRESTIGE_DEBT_CADENCE_SEC = 5;
export const PRESTIGE_DEBT_PER_HUNGRY_FOLLOWER = 1;
export const PRESTIGE_CURVE_A_BY_TIER = {
  bronze: 3,
  silver: 5,
  gold: 8,
  diamond: 12,
};
