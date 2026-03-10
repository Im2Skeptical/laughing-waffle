// gamerules-defs.js
// Gameplay rules and tuning constants.

import "../env-defs-dev.js";
import "../skill-defs-dev.js";

export const BASE_PROJECTION_HORIZON_SEC = 1200;
export const BASE_EDITABLE_HISTORY_WINDOW_SEC = 0;
export const ENV_EVENT_DRAW_CADENCE_SEC = 5;

export const SEASON_DURATION_SEC = 32; // seconds of simulation per season
export const SEASONS = ["spring", "summer", "autumn", "winter"];
export const SEASON_DISPLAY = {
  spring: "Spring",
  summer: "Summer",
  autumn: "Autumn",
  winter: "Winter",
};

// --- Moon / Action Point Cap ---
export const MOON_CYCLE_SEC = 30;
export const MOON_PHASE_OFFSET_SEC = 15;
export const AP_CAP_MIN = 0;
export const AP_CAP_MAX = 120;
export const AP_INCOME_PER_SEC = 1;
export const AP_INCOME_MULT_WAXING = 8;
export const AP_INCOME_MULT_WANING = 0;


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

// --- Pawn AI (eat/rest automation) ---
export const PAWN_AI_SUPPRESS_AFTER_PLAYER_MOVE_SEC = 20;
export const PAWN_AI_HUNGER_WARNING = 50;
export const PAWN_AI_HUNGER_START_EAT = 40;
export const PAWN_AI_HUNGER_FULL = 100;
export const PAWN_AI_STAMINA_WARNING = 30;
export const PAWN_AI_STAMINA_START_REST = 20;
export const PAWN_AI_STAMINA_FULL = 100;
export const PAWN_IDLE_STAMINA_REGEN_CADENCE_SEC = 5;
export const PAWN_IDLE_STAMINA_REGEN_AMOUNT = 1;

// --- Population ---
export const INITIAL_POPULATION_DEFAULT = 0;
export const POPULATION_ATTRACTION_PER_VACANCY_PER_YEAR = 0.25;
export const POPULATION_GROWTH_FULL_FEED_RATE = 0.2;
export const POPULATION_COLLAPSE_ALL_FAIL_MULTIPLIER = 0.5;
export const YEAR_END_SKILL_POINTS_NO_POPULATION_CHANGE = 1;
export const YEAR_END_SKILL_POINTS_POPULATION_CHANGE = 3;
export const YEAR_END_SKILL_POINTS_POPULATION_HALVING = 2;
export const FAITH_STARTING_TIER = "gold";
export const FAITH_GROWTH_STREAK_FOR_UPGRADE = 3;
export const LEADER_FAITH_STARTING_TIER = "gold";
export const LEADER_FAITH_GROWTH_STREAK_FOR_UPGRADE = 3;
export const LEADER_FAITH_HUNGER_DECAY_THRESHOLD = 20;
export const LEADER_FAITH_DECAY_CADENCE_SEC = 30;

// --- Perishability ---
export const PERISHABLE_ROT_CHANCE_PER_SEC = 0.005;
export const PERISHABILITY_ROT_MULTIPLIER_BY_TIER = {
  bronze: 1,
  silver: 0.75,
  gold: 0.5,
  diamond: 0.25,
};
