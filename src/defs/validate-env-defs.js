// validate-env-defs.js
// Dev-only integrity checks for env defs.

const EFFECT_OPS = new Set([
  "moveItem",
  "stackItem",
  "splitStack",
  "AddResource",
  "ExposeDiscovery",
  "TransformItem",
  "RemoveItem",
  "ExpireItemChance",
  "ExpireStoredPerishables",
  "AddTag",
  "RemoveTag",
  "DisableTag",
  "EnableTag",
  "HideTag",
  "SetSystemTier",
  "UpgradeSystemTier",
  "SetSystemState",
  "ResetSystemState",
  "AddToSystemState",
  "ClampSystemState",
  "AccumulateRatio",
  "AdjustSystemState",
  "ClearSystemState",
  "RemoveEvent",
  "TransformEvent",
  "ConsumeItem",
  "TransferUnits",
  "SpawnItem",
  "SpawnDropPackage",
  "SpawnFromDropTable",
  "CreateWorkProcess",
  "AdvanceWorkProcess",
  "SetProp",
  "SetDiscoveryState",
  "SetLocationName",
  "AddProp",
  "AddSkillPoints",
  "AddSkillPointsIfSkillNodeUnlocked",
  "GrantSkillNode",
  "AddModifier",
  "MulModifier",
  "GrantUnlock",
  "RevokeUnlock",
  "RevealDiscovery",
  "RevealTag",
]);

const TARGETING_KEYS = new Set([
  "all",
  "at",
  "ref:self",
  "ref:tileWhere",
  "area:adjacent",
  "where.tileId",
  "where.hasTag",
  "where.hasAllTags",
  "where.hasAnyTags",
  "where.notTag",
  "where.excludeTags",
  "where.systemAtLeast",
  "where.systemAtMost",
  "where.systemBetween",
  "kind:tileOccupants",
  "ownerId",
  "ownerIds",
]);

const REQUIRED_TIERS = ["bronze", "silver", "gold", "diamond"];

function addIssue(list, message) {
  list.push(message);
}

function normalizeEffectList(effectSpec) {
  if (!effectSpec) return [];
  if (Array.isArray(effectSpec)) return effectSpec;
  return [effectSpec];
}

function validateRegistryIds(registry, label, errors, warnings) {
  const seen = new Set();
  if (!registry || typeof registry !== "object") {
    addIssue(errors, `${label}: registry missing or not an object.`);
    return seen;
  }

  for (const [key, def] of Object.entries(registry)) {
    if (!def || typeof def !== "object") {
      addIssue(errors, `${label}: entry "${key}" is not an object.`);
      continue;
    }

    const id = def.id;
    if (!id || typeof id !== "string") {
      addIssue(errors, `${label}: entry "${key}" missing string id.`);
      continue;
    }

    if (seen.has(id)) {
      addIssue(errors, `${label}: duplicate id "${id}".`);
    } else {
      seen.add(id);
    }

    if (key !== id) {
      addIssue(warnings, `${label}: key "${key}" does not match id "${id}".`);
    }
  }

  return seen;
}

function validateEffectSpec(effectSpec, contextLabel, tagIds, systemIds, eventIds, errors) {
  const list = normalizeEffectList(effectSpec);
  for (const effect of list) {
    if (!effect || typeof effect !== "object") {
      addIssue(errors, `${contextLabel}: effect is not an object.`);
      continue;
    }

    const op = effect.op || effect.kind;
    if (!op || typeof op !== "string") {
      addIssue(errors, `${contextLabel}: effect missing op.`);
      continue;
    }

    if (!EFFECT_OPS.has(op)) {
      addIssue(errors, `${contextLabel}: invalid op "${op}".`);
      continue;
    }

    if (
      op === "AddTag" ||
      op === "RemoveTag" ||
      op === "DisableTag" ||
      op === "EnableTag" ||
      op === "HideTag" ||
      op === "RevealTag"
    ) {
      if (!effect.tag || typeof effect.tag !== "string") {
        addIssue(errors, `${contextLabel}: ${op} missing tag.`);
      } else if (!tagIds.has(effect.tag)) {
        addIssue(errors, `${contextLabel}: ${op} tag "${effect.tag}" not found.`);
      }
    }

    if (
      op === "SetSystemTier" ||
      op === "UpgradeSystemTier" ||
      op === "SetSystemState" ||
      op === "ResetSystemState" ||
      op === "AddToSystemState" ||
      op === "ClampSystemState" ||
      op === "AccumulateRatio" ||
      op === "AdjustSystemState" ||
      op === "CreateWorkProcess" ||
      op === "AdvanceWorkProcess" ||
      op === "TransferUnits"
    ) {
      if (!effect.system || typeof effect.system !== "string") {
        addIssue(errors, `${contextLabel}: ${op} missing system.`);
      } else if (!systemIds.has(effect.system)) {
        addIssue(
          errors,
          `${contextLabel}: ${op} system "${effect.system}" not found.`
        );
      }
    }

    if (op === "ClearSystemState") {
      if (
        effect.systems != null &&
        (!Array.isArray(effect.systems) ||
          effect.systems.some((sys) => !systemIds.has(sys)))
      ) {
        addIssue(
          errors,
          `${contextLabel}: ${op} systems must reference known systems.`
        );
      }
    }

    if (op === "TransformEvent") {
      if (!effect.defId || typeof effect.defId !== "string") {
        addIssue(errors, `${contextLabel}: TransformEvent missing defId.`);
      } else if (!eventIds.has(effect.defId)) {
        addIssue(
          errors,
          `${contextLabel}: TransformEvent defId "${effect.defId}" not found.`
        );
      }
    }
  }
}

export function validateEnvDefs({ tags, systems, tiles, events, structures }) {
  const errors = [];
  const warnings = [];

  const tagIds = validateRegistryIds(tags, "envTags", errors, warnings);
  const systemIds = validateRegistryIds(systems, "envSystems", errors, warnings);
  const tileIds = validateRegistryIds(tiles, "envTiles", errors, warnings);
  const eventIds = validateRegistryIds(events, "envEvents", errors, warnings);
  const structureIds = validateRegistryIds(
    structures,
    "envStructures",
    errors,
    warnings
  );

  if (tags && typeof tags === "object") {
    for (const def of Object.values(tags)) {
      if (!def || typeof def !== "object") continue;
      if (Object.prototype.hasOwnProperty.call(def, "tierMap")) {
        addIssue(errors, `envTags: "${def.id}" should not include tierMap.`);
      }

      if (Array.isArray(def.systems)) {
        for (const systemId of def.systems) {
          if (!systemIds.has(systemId)) {
            addIssue(
              errors,
              `envTags: "${def.id}" references missing system "${systemId}".`
            );
          }
        }
      }

      if (Array.isArray(def.intents)) {
        for (const intent of def.intents) {
          if (!intent || typeof intent !== "object") continue;
          if (intent.effect) {
            validateEffectSpec(
              intent.effect,
              `envTags: "${def.id}" intent "${intent.id}"`,
              tagIds,
              systemIds,
              eventIds,
              errors
            );
          }
        }
      }

      if (Array.isArray(def.passives)) {
        for (const passive of def.passives) {
          if (!passive || typeof passive !== "object") continue;
          if (passive.effect) {
            validateEffectSpec(
              passive.effect,
              `envTags: "${def.id}" passive "${passive.id}"`,
              tagIds,
              systemIds,
              eventIds,
              errors
            );
          }
          const timing = passive.timing;
          if (timing && typeof timing === "object") {
            if (
              timing.cadenceSec != null &&
              (!Number.isFinite(timing.cadenceSec) || timing.cadenceSec < 1)
            ) {
              addIssue(
                errors,
                `envTags: "${def.id}" passive "${passive.id}" cadenceSec must be >= 1.`
              );
            }
            if (
              timing.trigger != null &&
              timing.trigger !== "onFirstActive"
            ) {
              addIssue(
                errors,
                `envTags: "${def.id}" passive "${passive.id}" trigger must be "onFirstActive".`
              );
            }
          }
        }
      }
    }
  }

  if (systems && typeof systems === "object") {
    for (const def of Object.values(systems)) {
      if (!def || typeof def !== "object") continue;
      const tierMap = def.tierMap;
      if (!tierMap || typeof tierMap !== "object") {
        addIssue(errors, `envSystems: "${def.id}" missing tierMap.`);
        continue;
      }

      for (const tier of REQUIRED_TIERS) {
        if (typeof tierMap[tier] !== "number") {
          addIssue(
            errors,
            `envSystems: "${def.id}" tierMap missing numeric "${tier}".`
          );
        }
      }
    }
  }

  if (tiles && typeof tiles === "object") {
    for (const def of Object.values(tiles)) {
      if (!def || typeof def !== "object") continue;
      if (Array.isArray(def.baseTags)) {
        for (const tagId of def.baseTags) {
          if (!tagIds.has(tagId)) {
            addIssue(
              errors,
              `envTiles: "${def.id}" baseTag "${tagId}" not found.`
            );
          }
        }
      }

      if (def.seasonTables && typeof def.seasonTables === "object") {
        for (const [season, entries] of Object.entries(def.seasonTables)) {
          if (!Array.isArray(entries)) {
            addIssue(
              errors,
              `envTiles: "${def.id}" season "${season}" table is not an array.`
            );
            continue;
          }
          for (const entry of entries) {
            if (!entry || typeof entry !== "object") {
              addIssue(
                errors,
                `envTiles: "${def.id}" season "${season}" entry invalid.`
              );
              continue;
            }
            if (!eventIds.has(entry.defId)) {
              addIssue(
                errors,
                `envTiles: "${def.id}" season "${season}" event "${entry.defId}" not found.`
              );
            }
            if (!Number.isFinite(entry.weight) || entry.weight < 0) {
              addIssue(
                errors,
                `envTiles: "${def.id}" season "${season}" weight must be >= 0.`
              );
            }
          }
        }
      }
    }
  }

  if (events && typeof events === "object") {
    for (const def of Object.values(events)) {
      if (!def || typeof def !== "object") continue;
      if (def.durationSec != null) {
        if (!Number.isFinite(def.durationSec) || def.durationSec < 1) {
          addIssue(
            errors,
            `envEvents: "${def.id}" durationSec must be >= 1.`
          );
        }
      }
      if (def.defaultSpan != null) {
        if (!Number.isFinite(def.defaultSpan) || def.defaultSpan < 1) {
          addIssue(
            errors,
            `envEvents: "${def.id}" defaultSpan must be >= 1.`
          );
        }
      }

      if (def.onEnter) {
        validateEffectSpec(
          def.onEnter,
          `envEvents: "${def.id}" onEnter`,
          tagIds,
          systemIds,
          eventIds,
          errors
        );
      }
      if (def.onTick) {
        validateEffectSpec(
          def.onTick,
          `envEvents: "${def.id}" onTick`,
          tagIds,
          systemIds,
          eventIds,
          errors
        );
      }
      if (def.onExit) {
        validateEffectSpec(
          def.onExit,
          `envEvents: "${def.id}" onExit`,
          tagIds,
          systemIds,
          eventIds,
          errors
        );
      }
    }
  }

  return { ok: errors.length === 0, warnings, errors };
}
