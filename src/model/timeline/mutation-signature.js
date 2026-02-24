// src/model/timeline/mutation-signature.js
// Timeline mutation signatures used to detect out-of-band action/base mutations.

export function computeTimelineMutationSig(tl) {
  const acts = Array.isArray(tl.actions) ? tl.actions : [];

  const aLen = acts.length;
  const aLast = aLen ? acts[aLen - 1] : null;

  const baseRef = tl.baseStateData;
  const aRef = tl.actions;
  const persistentKnowledgeRef = tl?.persistentKnowledge ?? null;

  const aLastRef = aLast;
  const aLastSec = aLast ? Math.floor(aLast.tSec ?? 0) : 0;

  return {
    baseRef,
    aRef,
    aLen,
    aLastRef,
    aLastSec,
    persistentKnowledgeRef,
  };
}

export function mutationSigEquals(a, b) {
  if (!a || !b) return false;
  return (
    a.baseRef === b.baseRef &&
    a.aRef === b.aRef &&
    a.aLen === b.aLen &&
    a.aLastRef === b.aLastRef &&
    a.aLastSec === b.aLastSec &&
    a.persistentKnowledgeRef === b.persistentKnowledgeRef
  );
}
