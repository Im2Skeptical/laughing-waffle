// event-log-types-defs.js
// Central registry for gameplay event feed entry types and their UI colors.

const DEFAULT_EVENT_TYPE_ID = "event";

export const eventLogTypeDefs = {
  event: {
    id: "event",
    label: "Event",
    color: 0x9aa0b5,
  },
  envEventAppeared: {
    id: "envEventAppeared",
    label: "Env Event",
    color: 0x6fc6ff,
  },
  pawnHungry: {
    id: "pawnHungry",
    label: "Hungry",
    color: 0xff0000, //#ff8c00
  },
  pawnAte: {
    id: "pawnAte",
    label: "Ate",
    color: 0x7bd88f,
  },
  hubBuildComplete: {
    id: "hubBuildComplete",
    label: "Build Done",
    color: 0xd9d27a,
  },
  populationSeasonMeal: {
    id: "populationSeasonMeal",
    label: "Pop Meal",
    color: 0xff8c00,
  },
  populationYearlyUpdate: {
    id: "populationYearlyUpdate",
    label: "Pop Year",
    color: 0x04ff00,
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

