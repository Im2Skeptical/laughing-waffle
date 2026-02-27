export function createProcessWidgetSignatures({
  listCandidateEndpoints,
  getTemplateProcessForSystem,
  getProcessDefForInstance,
} = {}) {
  function buildCandidateSignature(state, target, process, processDef) {
    if (!state || !target || !process || !processDef) return "none";
    const parts = [];
    const context = { leaderId: process?.leaderId ?? null };
    for (const kind of ["inputs", "outputs"]) {
      const slots = processDef?.routingSlots?.[kind] || [];
      for (const slotDef of slots) {
        if (!slotDef || slotDef.locked) continue;
        const candidates = listCandidateEndpoints(
          state,
          process,
          slotDef,
          target,
          context
        );
        const list = candidates.length ? candidates.join(",") : "none";
        parts.push(`${kind}:${slotDef.slotId}:${list}`);
      }
    }
    return parts.length ? parts.join("|") : "none";
  }

  function buildTemplateCandidateSignature(state, target, systemId) {
    if (!state || !target || !systemId) return "none";
    const templateProcess = getTemplateProcessForSystem(target, systemId, {
      state,
    });
    if (!templateProcess) return "none";
    const templateDef = getProcessDefForInstance(templateProcess, target, {});
    if (!templateDef) return "none";
    return buildCandidateSignature(state, target, templateProcess, templateDef);
  }

  function buildProcessSignature(state, targetKey, target, entries) {
    if (!Array.isArray(entries) || entries.length === 0) return null;
    const parts = [];
    for (const entry of entries) {
      const process = entry?.process;
      if (!process) continue;
      const routingSig = process.routing ? JSON.stringify(process.routing) : "";
      const reqSig = Array.isArray(process.requirements)
        ? process.requirements
            .map(
              (r) =>
                `${r.kind}:${r.itemId || r.tag || r.resource}:${r.progress ?? 0}:${r.amount ?? 0}`
            )
            .join("|")
        : "";
      const outSig = Array.isArray(process.outputs)
        ? process.outputs
            .map(
              (o) =>
                `${o.kind}:${o.itemId || o.resource || o.system || ""}:${o.qty ?? o.amount ?? 0}`
            )
            .join("|")
        : "";
      const progress = Number.isFinite(process.progress)
        ? Math.floor(process.progress)
        : 0;
      const candidateSig = buildCandidateSignature(
        state,
        target,
        process,
        entry?.processDef
      );
      parts.push(
        `${process.id}|${progress}|${routingSig}|${reqSig}|${outSig}|${candidateSig}`
      );
    }
    return `${targetKey}|${parts.join("||")}`;
  }

  function buildRoutingTemplateSignature(target, systemId) {
    if (!target || !systemId) return "none";
    const template = target?.systemState?.[systemId]?.routingTemplate;
    if (!template || typeof template !== "object") return "none";
    return JSON.stringify(template);
  }

  function buildGrowthSignature(state, targetKey, target, entries) {
    const growth = target?.systemState?.growth || {};
    const cropId = growth.selectedCropId || "";
    const pool = growth.maturedPool || {};
    const poolSig = `${pool.bronze ?? 0}:${pool.silver ?? 0}:${pool.gold ?? 0}:${pool.diamond ?? 0}`;
    const templateSig = buildRoutingTemplateSignature(target, "growth");
    const candidateSig = buildTemplateCandidateSignature(state, target, "growth");
    const baseSig = buildProcessSignature(state, targetKey, target, entries) || "empty";
    return `growth:${targetKey}:${cropId}:${poolSig}:${templateSig}:${candidateSig}:${baseSig}`;
  }

  function buildBuildSignature(state, targetKey, target, entries) {
    const templateSig = buildRoutingTemplateSignature(target, "build");
    const candidateSig = buildTemplateCandidateSignature(state, target, "build");
    const baseSig = buildProcessSignature(state, targetKey, target, entries) || "empty";
    return `build:${targetKey}:${templateSig}:${candidateSig}:${baseSig}`;
  }

  function buildResidentsSignature(state, targetKey, target, entries) {
    const population = Math.max(0, Math.floor(state?.resources?.population ?? 0));
    const templateSig = buildRoutingTemplateSignature(target, "residents");
    const candidateSig = buildTemplateCandidateSignature(state, target, "residents");
    const baseSig = buildProcessSignature(state, targetKey, target, entries) || "empty";
    return `residents:${targetKey}:${population}:${templateSig}:${candidateSig}:${baseSig}`;
  }

  function buildDepositSignature(state, targetKey, target, entries, poolSig = "none") {
    const templateSig = buildRoutingTemplateSignature(target, "deposit");
    const baseSig = buildProcessSignature(state, targetKey, target, entries) || "empty";
    return `deposit:${targetKey}:${poolSig}:${templateSig}:${baseSig}`;
  }

  function buildBasketSignature(targetKey, itemSig = "none", poolSig = "none") {
    return `basket:${targetKey}:${itemSig}:${poolSig}`;
  }

  function buildRecipeSystemSignature(
    state,
    targetKey,
    target,
    entries,
    systemId,
    recipePrioritySignature = "none",
    recipeFocusId = "none"
  ) {
    const templateSig = buildRoutingTemplateSignature(target, systemId);
    const candidateSig = buildTemplateCandidateSignature(state, target, systemId);
    const baseSig = buildProcessSignature(state, targetKey, target, entries) || "empty";
    return `recipe:${systemId}:${targetKey}:${recipePrioritySignature}:${recipeFocusId}:${templateSig}:${candidateSig}:${baseSig}`;
  }

  return {
    buildCandidateSignature,
    buildTemplateCandidateSignature,
    buildProcessSignature,
    buildRoutingTemplateSignature,
    buildGrowthSignature,
    buildBuildSignature,
    buildResidentsSignature,
    buildDepositSignature,
    buildBasketSignature,
    buildRecipeSystemSignature,
  };
}
