import { itemDefs } from "../../../defs/gamepieces/gamepieces-defs.js";

function itemTimingPass(timing, state, tSec, mode) {
  if (mode === "season") {
    return timing?.onSeasonChange === true;
  }
  if (!timing || typeof timing !== "object") return true;
  if (timing.onSeasonChange === true) return false;
  if (Number.isFinite(timing.cadenceSec)) {
    const cadence = Math.max(1, Math.floor(timing.cadenceSec));
    return Number.isFinite(tSec) ? tSec % cadence === 0 : false;
  }
  return true;
}

export function runItemPassives(state, inv, ownerId, item, tSec, mode, runEffect) {
  const def = itemDefs[item?.kind];
  const passives = Array.isArray(def?.passives) ? def.passives : [];
  if (!passives.length) return false;

  let changed = false;
  const initialKind = item.kind;
  const baseContext = {
    kind: "item",
    state,
    inv,
    item,
    ownerId,
    tSec,
  };

  for (const passive of passives) {
    if (!passive || typeof passive !== "object") continue;
    if (!itemTimingPass(passive.timing, state, tSec, mode)) continue;
    if (passive.effect) {
      runEffect(state, passive.effect, { ...baseContext });
    }

    if (!inv.itemsById?.[item.id]) {
      changed = true;
      break;
    }
    if (item.kind !== initialKind) {
      changed = true;
      break;
    }
  }

  return changed;
}
