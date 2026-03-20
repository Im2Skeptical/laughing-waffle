// event-log-types-defs.js
// Central registry for gameplay event feed entry types and their UI colors.

const DEFAULT_EVENT_TYPE_ID = "event";

export const eventLogTypeDefs = {
  event: {
    id: "event",
    label: "Event",
    color: 0x9aa0b5,
    glyph: "EV",
  },
  envEventAppeared: {
    id: "envEventAppeared",
    label: "Env Event",
    color: 0x6fc6ff,
    glyph: "EE",
  },
  pawnHungry: {
    id: "pawnHungry",
    label: "Hungry",
    color: 0xffa640,
    glyph: "H",
  },
  pawnTired: {
    id: "pawnTired",
    label: "Tired",
    color: 0xffd166,
    glyph: "T",
  },
  pawnAte: {
    id: "pawnAte",
    label: "Ate",
    color: 0x7bd88f,
    glyph: "A",
  },
  leaderFaithEatFailureWarning: {
    id: "leaderFaithEatFailureWarning",
    label: "Leader Warn",
    color: 0xffa640,
    glyph: "LW",
  },
  leaderFaithDecayed: {
    id: "leaderFaithDecayed",
    label: "Leader Faith",
    color: 0xff7b7b,
    glyph: "LF",
  },
  leaderFaithAtRisk: {
    id: "leaderFaithAtRisk",
    label: "Faith Risk",
    color: 0xff8f6f,
    glyph: "FR",
  },
  skillPointsAvailable: {
    id: "skillPointsAvailable",
    label: "Skills",
    color: 0x7ac7ff,
    glyph: "SK",
  },
  leaderFaithCollapsed: {
    id: "leaderFaithCollapsed",
    label: "Leader Lost",
    color: 0xff4f4f,
    glyph: "LL",
  },
  pawnMovedToFood: {
    id: "pawnMovedToFood",
    label: "Seek Food",
    color: 0x6fc6ff,
    glyph: "SF",
  },
  pawnMovedToRest: {
    id: "pawnMovedToRest",
    label: "Seek Rest",
    color: 0x9ca3ff,
    glyph: "SR",
  },
  hubBuildComplete: {
    id: "hubBuildComplete",
    label: "Build Done",
    color: 0xd9d27a,
    glyph: "BD",
  },
  populationSeasonMeal: {
    id: "populationSeasonMeal",
    label: "Pop Meal",
    color: 0xff8c00,
    glyph: "PM",
  },
  populationYearlyUpdate: {
    id: "populationYearlyUpdate",
    label: "Pop Year",
    color: 0x04ff00,
    glyph: "PY",
  },
  runComplete: {
    id: "runComplete",
    label: "Run Complete",
    color: 0xff4f4f,
    glyph: "RC",
  },
  forageRoll: {
    id: "forageRoll",
    label: "Forage",
    color: 0x6fce7a,
    glyph: "FO",
  },
  fishingRoll: {
    id: "fishingRoll",
    label: "Fishing",
    color: 0x6fb7ff,
    glyph: "FI",
  },
};

export function getEventLogTypeDef(typeId) {
  const key =
    typeof typeId === "string" && typeId.length > 0
      ? typeId
      : DEFAULT_EVENT_TYPE_ID;
  return (
    eventLogTypeDefs[key] ||
    eventLogTypeDefs[DEFAULT_EVENT_TYPE_ID] || {
      id: DEFAULT_EVENT_TYPE_ID,
      label: "Event",
      color: 0x9aa0b5,
    }
  );
}

