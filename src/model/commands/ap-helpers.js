import {
  AP_INCOME_MULT_WANING,
  AP_INCOME_MULT_WAXING,
  AP_INCOME_PER_SEC,
} from "../../defs/gamesettings/gamerules-defs.js";
import { getActionPointCapAtSecond, isMoonWaxingAtSecond } from "../moon.js";
import { getGlobalSkillModifier } from "../skills.js";

export function normalizeApState(state) {
  if (typeof state.actionPoints !== "number") state.actionPoints = 0;
  if (typeof state.actionPointCap !== "number") state.actionPointCap = 0;
}

export function getApCapForSecond(state, tSec) {
  const override = state.apCapOverride;
  if (override && override.enabled) {
    const cap =
      typeof override.cap === "number"
        ? Math.max(0, Math.floor(override.cap))
        : Math.max(0, Math.floor(state.actionPointCap ?? 0));
    return cap;
  }
  const baseCap = getActionPointCapAtSecond(tSec);
  const bonus = Math.floor(getGlobalSkillModifier(state, "apCapBonus", 0));
  return Math.max(0, baseCap + bonus);
}

export function getApIncomePerSecond(state, tSec) {
  const income = Number.isFinite(AP_INCOME_PER_SEC) ? AP_INCOME_PER_SEC : 1;
  const base = Math.max(0, income);

  if (state?.apCapOverride?.enabled) return base;

  const mult = isMoonWaxingAtSecond(tSec)
    ? AP_INCOME_MULT_WAXING
    : AP_INCOME_MULT_WANING;
  const multSafe = Number.isFinite(mult) ? Math.max(0, mult) : 1;

  return base * multSafe;
}
