import { itemDefs } from "../../../defs/gamepieces/item-defs.js";
import { cropDefs } from "../../../defs/gamepieces/crops-defs.js";
import { envSystemDefs } from "../../../defs/gamesystems/env-systems-defs.js";

function getDefRegistry(name) {
  if (!name || typeof name !== "string") return null;
  switch (name) {
    case "crops":
    case "cropDefs":
      return cropDefs;
    case "items":
    case "itemDefs":
      return itemDefs;
    case "envSystems":
    case "envSystemDefs":
      return envSystemDefs;
    default:
      return null;
  }
}

export function resolveEffectDef(effect, tile, context) {
  const registryName = effect.defRegistry || effect.registry || null;
  const registry = getDefRegistry(registryName);
  if (!registry) return { registry: null, defId: null, def: null };

  let defId = effect.defId ?? null;
  if (defId == null && effect.defIdFromVar && context?.vars) {
    defId = context.vars[effect.defIdFromVar];
  }
  if (defId == null && effect.defIdFromContextKey && context) {
    defId = context[effect.defIdFromContextKey];
  }
  if (defId == null && effect.defIdFromSystemKey) {
    const systemId = effect.system || effect.systemId || null;
    const systemState = systemId ? tile?.systemState?.[systemId] : null;
    defId = systemState?.[effect.defIdFromSystemKey];
  }

  const defKey = defId != null ? String(defId) : null;
  const def = defKey ? registry[defKey] : null;
  return { registry, defId: defKey, def };
}
