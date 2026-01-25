import { stepItemSecond } from "../../item-exec.js";

export function processSeasonChangeForItems(state, runEffect) {
  if (!state?.ownerInventories) return;
  const tSec = Number.isFinite(state.tSec) ? state.tSec : 0;
  stepItemSecond(state, tSec, runEffect);
}