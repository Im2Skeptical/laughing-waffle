import { getAbsoluteEditableRangeFromTimegraphState } from "./timegraph/edit-policy.js";

function toSafeSec(value, fallback = 0) {
  if (!Number.isFinite(value)) return Math.max(0, Math.floor(fallback));
  return Math.max(0, Math.floor(value));
}

export function isItemBeyondAbsoluteTimegraphWindow(item, tSec) {
  const range = getAbsoluteEditableRangeFromTimegraphState(
    item?.systemState?.timegraph
  );
  if (!range) return false;
  const sec = toSafeSec(tSec, 0);
  return sec > range.maxSec;
}

export function getItemUseUnavailableReason(state, item, itemDef) {
  if (!itemDef || typeof itemDef !== "object") return null;
  const requires =
    itemDef?.onUseRequires && typeof itemDef.onUseRequires === "object"
      ? itemDef.onUseRequires
      : null;
  if (!requires) return null;

  const tSec = toSafeSec(state?.tSec, 0);

  if (requires.timegraphWindowPast === true) {
    if (!isItemBeyondAbsoluteTimegraphWindow(item, tSec)) {
      return "timegraphWindowNotPast";
    }
  }

  return null;
}

export function isItemUseCurrentlyAvailable(state, item, itemDef) {
  return getItemUseUnavailableReason(state, item, itemDef) == null;
}
