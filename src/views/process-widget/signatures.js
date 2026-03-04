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

  function buildGrowthPoolSignature(pool) {
    if (!pool || typeof pool !== "object") return "none";
    const hasTierKeys =
      Object.prototype.hasOwnProperty.call(pool, "bronze") ||
      Object.prototype.hasOwnProperty.call(pool, "silver") ||
      Object.prototype.hasOwnProperty.call(pool, "gold") ||
      Object.prototype.hasOwnProperty.call(pool, "diamond");
    if (hasTierKeys) {
      return `${pool.bronze ?? 0}:${pool.silver ?? 0}:${pool.gold ?? 0}:${pool.diamond ?? 0}`;
    }
    const cropIds = Object.keys(pool).sort((a, b) => a.localeCompare(b));
    if (cropIds.length <= 0) return "empty";
    const parts = [];
    for (const cropId of cropIds) {
      const bucket = pool[cropId];
      if (!bucket || typeof bucket !== "object") continue;
      parts.push(
        `${cropId}:${bucket.bronze ?? 0},${bucket.silver ?? 0},${bucket.gold ?? 0},${bucket.diamond ?? 0}`
      );
    }
    return parts.length > 0 ? parts.join("|") : "empty";
  }

  function buildGrowthSignature(state, targetKey, target, entries) {
    const growth = target?.systemState?.growth || {};
    const cropId = growth.selectedCropId || "";
    const recipePriority = growth.recipePriority || null;
    const ordered = Array.isArray(recipePriority?.ordered)
      ? recipePriority.ordered
      : [];
    const enabled =
      recipePriority?.enabled && typeof recipePriority.enabled === "object"
        ? recipePriority.enabled
        : {};
    const prioritySig =
      ordered.length > 0
        ? ordered
            .map((seedId) => `${seedId}:${enabled[seedId] === false ? 0 : 1}`)
            .join("|")
        : "none";
    const pool = growth.maturedPool || {};
    const poolSig = buildGrowthPoolSignature(pool);
    const templateSig = buildRoutingTemplateSignature(target, "growth");
    const candidateSig = buildTemplateCandidateSignature(state, target, "growth");
    const baseSig = buildProcessSignature(state, targetKey, target, entries) || "empty";
    return `growth:${targetKey}:${cropId}:${prioritySig}:${poolSig}:${templateSig}:${candidateSig}:${baseSig}`;
  }

  function buildBuildSignature(state, targetKey, target, entries) {
    const templateSig = buildRoutingTemplateSignature(target, "build");
    const candidateSig = buildTemplateCandidateSignature(state, target, "build");
    const baseSig = buildProcessSignature(state, targetKey, target, entries) || "empty";
    return `build:${targetKey}:${templateSig}:${candidateSig}:${baseSig}`;
  }

  function buildResidentsSignature(state, targetKey, target, entries) {
    const population = Math.max(0, Math.floor(state?.resources?.population ?? 0));
    const residentsState = target?.systemState?.residents ?? {};
    const housingCapacity = Math.max(
      0,
      Math.floor(residentsState?.housingCapacity ?? 0)
    );
    const housingVacancy = Math.max(
      0,
      Math.floor(residentsState?.housingVacancy ?? 0)
    );
    const templateSig = buildRoutingTemplateSignature(target, "residents");
    const candidateSig = buildTemplateCandidateSignature(state, target, "residents");
    const baseSig = buildProcessSignature(state, targetKey, target, entries) || "empty";
    return `residents:${targetKey}:${population}:${housingCapacity}:${housingVacancy}:${templateSig}:${candidateSig}:${baseSig}`;
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
    recipeFocusId = "none",
    recipeAvailabilitySignature = "none"
  ) {
    const templateSig = buildRoutingTemplateSignature(target, systemId);
    const candidateSig = buildTemplateCandidateSignature(state, target, systemId);
    const baseSig = buildProcessSignature(state, targetKey, target, entries) || "empty";
    return `recipe:${systemId}:${targetKey}:${recipePrioritySignature}:${recipeFocusId}:${recipeAvailabilitySignature}:${templateSig}:${candidateSig}:${baseSig}`;
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
