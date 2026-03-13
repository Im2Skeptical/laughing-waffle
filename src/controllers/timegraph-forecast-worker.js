import { buildProjectionChunkFromStateData } from "../model/projection-chunk.js";

function serializeChunkResult(result) {
  if (!result?.ok) return result;
  return {
    ...result,
    stateDataBySecond: Array.from(result.stateDataBySecond.entries()),
  };
}

globalThis.onmessage = (event) => {
  const message = event?.data ?? null;
  if (!message || message.kind !== "buildChunk") return;

  const result = buildProjectionChunkFromStateData(
    message.boundaryStateData,
    message.baseSec,
    message.endSec,
    {
      stepSec: message.stepSec,
      actionsBySecond: message.scheduledActionsBySecond,
    }
  );

  globalThis.postMessage({
    kind: "chunkResult",
    requestId: message.requestId,
    requestKey: message.requestKey,
    timelineToken: message.timelineToken,
    historyEndSec: message.historyEndSec,
    baseSec: message.baseSec,
    endSec: message.endSec,
    stepSec: message.stepSec,
    result: serializeChunkResult(result),
  });
};

