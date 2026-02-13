import { rebuildStateAtSecond } from "../../model/timeline/index.js";

function summarizeProjectionState(state) {
  const pawns = (state?.pawns ?? [])
    .map((pawn) => `${pawn.id}:${pawn.hubCol ?? "n"}:${pawn.envCol ?? "n"}`)
    .sort();

  const tileCrops = [];
  const tagDisabled = [];
  const cols = Number.isFinite(state?.board?.cols)
    ? Math.floor(state.board.cols)
    : 0;

  for (let col = 0; col < cols; col += 1) {
    const tile = state?.board?.occ?.tile?.[col];
    if (!tile) continue;

    const cropId = tile?.systemState?.growth?.selectedCropId ?? null;
    if (cropId != null) tileCrops.push(`${col}:${cropId}`);

    const tagStates = tile?.tagStates ?? {};
    for (const [tagId, entry] of Object.entries(tagStates)) {
      if (entry?.disabled === true) tagDisabled.push(`${col}:${tagId}`);
    }
  }

  tileCrops.sort();
  tagDisabled.sort();
  return `${pawns.join("|")}||${tileCrops.join("|")}||${tagDisabled.join("|")}`;
}

export function createProjectionParityProbe({ runner, controller }) {
  return function getProjectionParity() {
    const tl = runner.getTimeline?.();
    const cs = runner.getCursorState?.();
    if (!tl || !cs) return { ok: false, reason: "noState" };

    const sec = Math.max(0, Math.floor(cs.tSec ?? 0) + 1);
    const projected = controller.getStateAt?.(sec);
    const rebuilt = rebuildStateAtSecond(tl, sec);
    if (!projected || !rebuilt?.ok) {
      return { ok: false, reason: "compareFailed", sec };
    }

    const projSig = summarizeProjectionState(projected);
    const rebuiltSig = summarizeProjectionState(rebuilt.state);
    return {
      ok: true,
      sec,
      mismatch: projSig !== rebuiltSig,
      detail: projSig !== rebuiltSig ? "stateSig" : "ok",
    };
  };
}
