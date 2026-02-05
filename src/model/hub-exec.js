// hub-exec.js
// Per-second hub structure execution (passives + intents).

import { hubTagDefs } from "../defs/gamesystems/hub-tag-defs.js";
import { getCurrentSeasonKey, ensurePawnSystems } from "./state.js";
import { runEffect } from "./effects.js";
import { resolveCosts, canAffordCosts, applyCosts } from "./costs.js";
import { applyGranaryDepositsForStructure } from "./prestige-system.js";
import { Inventory } from "./inventory-model.js";
import { bumpInvVersion } from "./effects/core/inventory-version.js";

function hasProcess(structure, systemId, type) {
  const sys = structure?.systemState?.[systemId];
  const processes = Array.isArray(sys?.processes) ? sys.processes : [];
  if (!type) return processes.length > 0;
  return processes.some((p) => p && p.type === type);
}

function requirementsPass(requires, seasonKey, structure, hasPawn) {
  if (!requires || typeof requires !== "object") return true;

  if (Array.isArray(requires.season) && requires.season.length > 0) {
    if (!seasonKey || !requires.season.includes(seasonKey)) return false;
  }

  if (typeof requires.hasPawn === "boolean") {
    if (requires.hasPawn !== hasPawn) return false;
  }

  if (typeof requires.hasSelectedCrop === "boolean") {
    const selectedCropId = structure?.systemState?.growth?.selectedCropId;
    const hasSelected =
      typeof selectedCropId === "string" && selectedCropId.length > 0;
    if (requires.hasSelectedCrop !== hasSelected) return false;
  }

  if (Array.isArray(requires.selectedCropIdIn)) {
    const selectedCropId = structure?.systemState?.growth?.selectedCropId;
    if (
      requires.selectedCropIdIn.length > 0 &&
      (typeof selectedCropId !== "string" ||
        !requires.selectedCropIdIn.includes(selectedCropId))
    ) {
      return false;
    }
  }

  if (Object.prototype.hasOwnProperty.call(requires, "hasEquipment")) {
    return false;
  }

  if (typeof requires.hasMaturedPool === "boolean") {
    const pool = structure?.systemState?.growth?.maturedPool;
    const hasPool =
      pool &&
      typeof pool === "object" &&
      ((pool.bronze ?? 0) > 0 ||
        (pool.silver ?? 0) > 0 ||
        (pool.gold ?? 0) > 0 ||
        (pool.diamond ?? 0) > 0);
    if (requires.hasMaturedPool !== hasPool) return false;
  }

  const tagReq = requires.hasTag;
  if (tagReq != null) {
    const structureTags = Array.isArray(structure?.tags) ? structure.tags : [];
    const requiredTags = Array.isArray(tagReq)
      ? tagReq
      : typeof tagReq === "string"
        ? [tagReq]
        : [];

    for (const tag of requiredTags) {
      if (!structureTags.includes(tag)) return false;
    }
  }

  const processSystem =
    typeof requires.processSystem === "string" ? requires.processSystem : null;
  if (processSystem) {
    if (requires.hasProcessType) {
      const types = Array.isArray(requires.hasProcessType)
        ? requires.hasProcessType
        : [requires.hasProcessType];
      for (const type of types) {
        if (!hasProcess(structure, processSystem, type)) return false;
      }
    }
    if (requires.noProcessType) {
      const types = Array.isArray(requires.noProcessType)
        ? requires.noProcessType
        : [requires.noProcessType];
      for (const type of types) {
        if (hasProcess(structure, processSystem, type)) return false;
      }
    }
  }

  return true;
}

function timingPass(timing, state, tSec) {
  if (!timing || typeof timing !== "object") return true;
  const cadenceSec = Number.isFinite(timing.cadenceSec)
    ? Math.max(1, Math.floor(timing.cadenceSec))
    : null;
  const onSeasonChange = timing.onSeasonChange === true;

  if (!cadenceSec && !onSeasonChange) return true;

  const cadenceMatch =
    cadenceSec != null && Number.isFinite(tSec)
      ? tSec % cadenceSec === 0
      : false;
  const seasonMatch = onSeasonChange && state?._seasonChanged === true;
  return cadenceMatch || seasonMatch;
}

function isTagDisabled(structure, tagId) {
  if (!structure || !tagId) return false;
  const entry = structure.tagStates?.[tagId];
  return entry?.disabled === true;
}

function getPawnsOnHubAnchor(state, anchor) {
  const out = [];
  if (!anchor) return out;
  const col = Number.isFinite(anchor.col) ? Math.floor(anchor.col) : null;
  const span =
    Number.isFinite(anchor.span) && anchor.span > 0
      ? Math.floor(anchor.span)
      : 1;
  if (col == null) return out;
  const chars = Array.isArray(state?.characters) ? state.characters : [];
  const maxCol = col + span - 1;
  for (const ch of chars) {
    if (!ch) continue;
    if (Number.isFinite(ch.envCol)) continue;
    const pawnCol = Number.isFinite(ch.hubCol) ? Math.floor(ch.hubCol) : null;
    if (pawnCol == null) continue;
    if (pawnCol < col || pawnCol > maxCol) continue;
    out.push(ch);
  }
  return out;
}

function itemHasTag(item, tag) {
  if (!item || !tag) return false;
  const tags = Array.isArray(item.tags) ? item.tags : [];
  return tags.includes(tag);
}

function getItemIdsInGridOrder(inv) {
  if (!inv) return [];
  const grid = Array.isArray(inv.grid) ? inv.grid : null;
  if (!grid) {
    return Array.isArray(inv.items) ? inv.items.map((it) => it?.id) : [];
  }
  const seen = new Set();
  const order = [];
  for (let idx = 0; idx < grid.length; idx++) {
    const id = grid[idx];
    if (id == null || seen.has(id)) continue;
    seen.add(id);
    order.push(id);
  }
  return order;
}

function getItemsInGridOrder(inv) {
  const ids = getItemIdsInGridOrder(inv);
  if (!inv || !ids.length) return [];
  const out = [];
  for (const id of ids) {
    const item = inv.itemsById?.[id] ?? inv.items?.find((it) => it.id === id);
    if (item) out.push(item);
  }
  return out;
}

function consumeForRequirement(inv, requirement, amount) {
  if (!inv || !requirement || amount <= 0) return 0;
  const items = getItemsInGridOrder(inv);
  let remaining = Math.max(0, Math.floor(amount));
  let consumed = 0;

  for (const item of items) {
    if (remaining <= 0) break;
    if (!item) continue;
    if (requirement.kind === "item") {
      if (item.kind !== requirement.itemId) continue;
    } else if (requirement.kind === "tag") {
      if (!itemHasTag(item, requirement.tag)) continue;
    } else {
      continue;
    }

    const qty = Math.max(0, Math.floor(item.quantity ?? 0));
    if (qty <= 0) continue;
    const take = Math.min(qty, remaining);
    item.quantity = qty - take;
    consumed += take;
    remaining -= take;
    if (item.quantity <= 0) {
      Inventory.removeItem(inv, item.id);
    }
  }

  return consumed;
}

function getContributingPawns(state, structure) {
  const pawns = getPawnsOnHubAnchor(state, structure);
  const contributors = [];
  for (const pawn of pawns) {
    if (!pawn) continue;
    ensurePawnSystems(pawn);
    const stamina = pawn.systemState?.stamina;
    const cur = Number.isFinite(stamina?.cur) ? Math.floor(stamina.cur) : 0;
    if (cur <= 0) continue;
    contributors.push(pawn);
  }
  return contributors;
}

function stepConstructionForStructure(state, structure, tSec) {
  const build = structure?.build;
  if (!build || build.status !== "underConstruction") return false;
  if (build.blocked === true || build.blockedByEvent === true) return false;

  const contributors = getContributingPawns(state, structure);
  if (!contributors.length) return false;

  const laborRequired = Math.max(0, Math.floor(build.laborRequiredSec ?? 0));
  const laborProgress = Math.max(0, Math.floor(build.laborProgress ?? 0));
  const laborRemaining = Math.max(0, laborRequired - laborProgress);

  const inv = state?.ownerInventories?.[structure.instanceId] ?? null;
  if (inv) {
    Inventory.rebuildDerived(inv);
  }

  let didConsume = false;
  let resourceBudget = contributors.length;
  const reqs = Array.isArray(build.requirements) ? build.requirements : [];

  for (const req of reqs) {
    if (resourceBudget <= 0) break;
    if (!req || typeof req !== "object") continue;
    const required = Math.max(0, Math.floor(req.amount ?? 0));
    const progress = Math.max(0, Math.floor(req.progress ?? 0));
    const remaining = required - progress;
    if (remaining <= 0) continue;

    if (req.kind === "resource") {
      const key = req.resource;
      const available = Number.isFinite(state?.resources?.[key])
        ? Math.max(0, Math.floor(state.resources[key]))
        : 0;
      if (available <= 0) continue;
      const take = Math.min(remaining, resourceBudget, available);
      if (take <= 0) continue;
      state.resources[key] = available - take;
      req.progress = progress + take;
      resourceBudget -= take;
      didConsume = true;
      continue;
    }

    if (!inv) continue;
    const take = consumeForRequirement(inv, req, Math.min(remaining, resourceBudget));
    if (take <= 0) continue;
    req.progress = progress + take;
    resourceBudget -= take;
    didConsume = true;
  }

  let reqsDone = true;
  for (const req of reqs) {
    if (!req || typeof req !== "object") continue;
    const required = Math.max(0, Math.floor(req.amount ?? 0));
    const progress = Math.max(0, Math.floor(req.progress ?? 0));
    if (progress < required) {
      reqsDone = false;
      break;
    }
  }

  if (reqsDone) {
    const laborDelta = Math.min(laborRemaining, contributors.length);
    if (laborDelta > 0) {
      build.laborProgress = laborProgress + laborDelta;
      for (const pawn of contributors) {
        const stamina = pawn.systemState?.stamina;
        if (!stamina || typeof stamina !== "object") continue;
        const cur = Number.isFinite(stamina.cur) ? Math.floor(stamina.cur) : 0;
        stamina.cur = Math.max(0, cur - 1);
      }
    }
  }

  if (inv && didConsume) {
    Inventory.rebuildDerived(inv);
    bumpInvVersion(inv);
  }

  const laborDone =
    Math.max(0, Math.floor(build.laborProgress ?? 0)) >= laborRequired;

  if (laborDone && reqsDone) {
    delete structure.build;
  }

  return true;
}

export function stepHubSecond(state, tSec) {
  if (!state || !state.hub) return;

  const anchors = Array.isArray(state.hub.anchors) ? state.hub.anchors : [];
  if (!anchors.length) return;

  const seasonKey = getCurrentSeasonKey(state);

  for (const structure of anchors) {
    if (!structure) continue;
    if (structure?.build?.status === "underConstruction") {
      stepConstructionForStructure(state, structure, tSec);
      continue;
    }
    const hubCol = Number.isFinite(structure.col)
      ? Math.floor(structure.col)
      : 0;

    const tags = Array.isArray(structure.tags) ? structure.tags : [];
    if (!tags.length) continue;

    const pawns = getPawnsOnHubAnchor(state, structure);
    const hasPawn = pawns.length > 0;

    if (hasPawn && tags.includes("deposit") && !isTagDisabled(structure, "deposit")) {
      applyGranaryDepositsForStructure(state, structure, pawns);
    }

    const baseContext = {
      kind: "game",
      state,
      source: structure,
      tSec,
      hubCol,
      ownerId: structure.instanceId,
    };

    for (const tagId of tags) {
      if (isTagDisabled(structure, tagId)) continue;
      const tagDef = hubTagDefs[tagId];
      if (!tagDef) continue;
      const passives = Array.isArray(tagDef.passives) ? tagDef.passives : [];
      for (const passive of passives) {
        if (!passive || typeof passive !== "object") continue;
        if (!timingPass(passive.timing, state, tSec)) continue;
        if (
          passive.requires &&
          !requirementsPass(passive.requires, seasonKey, structure, hasPawn)
        ) {
          continue;
        }
        if (passive.effect) {
          runEffect(state, passive.effect, { ...baseContext });
        }
      }
    }

    if (!hasPawn) continue;

    for (const pawn of pawns) {
      if (!pawn) continue;
      ensurePawnSystems(pawn);
      const pawnInv = state?.ownerInventories?.[pawn.id] ?? null;

      const pawnContext = {
        ...baseContext,
        pawnId: pawn.id,
        ownerId: pawn.id,
        pawn,
        pawnInv,
      };

      let executed = false;
      for (const tagId of tags) {
        if (isTagDisabled(structure, tagId)) continue;
        const tagDef = hubTagDefs[tagId];
        if (!tagDef) continue;
        const intents = Array.isArray(tagDef.intents) ? tagDef.intents : [];
        for (const intent of intents) {
          if (!intent || typeof intent !== "object") continue;
          if (
            intent.requires &&
            !requirementsPass(intent.requires, seasonKey, structure, true)
          ) {
            continue;
          }
          if (intent.cost) {
            const resolved = resolveCosts(intent.cost, pawnContext);
            if (!resolved) continue;
            if (!canAffordCosts(resolved, pawnContext)) continue;
            applyCosts(resolved, pawnContext);
          }
          if (intent.effect) {
            runEffect(state, intent.effect, { ...pawnContext });
          }
          executed = true;
          break;
        }
        if (executed) break;
      }
    }
  }
}
