// validate-skill-defs.js
// Dev-only integrity checks for skill tree defs.

function addIssue(list, message) {
  list.push(message);
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return value && typeof value === "object";
}

function normalizeNodeCost(node) {
  if (!Number.isFinite(node?.cost)) return 1;
  return Math.max(0, Math.floor(node.cost));
}

function validateEffects(node, knownRecipeIds, knownHubIds, errors) {
  const effects = isObject(node?.effects) ? node.effects : null;
  if (!effects) return;

  if (effects.characterMods != null && !isObject(effects.characterMods)) {
    addIssue(errors, `skillNodes: "${node.id}" effects.characterMods must be an object.`);
  }
  if (effects.globalMods != null && !isObject(effects.globalMods)) {
    addIssue(errors, `skillNodes: "${node.id}" effects.globalMods must be an object.`);
  }

  const unlocks = effects.unlocks;
  if (unlocks == null) return;
  if (!isObject(unlocks)) {
    addIssue(errors, `skillNodes: "${node.id}" effects.unlocks must be an object.`);
    return;
  }

  for (const recipeId of toArray(unlocks.recipes)) {
    if (typeof recipeId !== "string" || !recipeId.length) {
      addIssue(errors, `skillNodes: "${node.id}" unlock recipe ids must be non-empty strings.`);
      continue;
    }
    if (!knownRecipeIds.has(recipeId)) {
      addIssue(errors, `skillNodes: "${node.id}" unlock recipe "${recipeId}" not found.`);
    }
  }

  for (const hubId of toArray(unlocks.hubStructures)) {
    if (typeof hubId !== "string" || !hubId.length) {
      addIssue(errors, `skillNodes: "${node.id}" unlock hub ids must be non-empty strings.`);
      continue;
    }
    if (!knownHubIds.has(hubId)) {
      addIssue(errors, `skillNodes: "${node.id}" unlock hub structure "${hubId}" not found.`);
    }
  }
}

function validateRequirements(node, allNodeIds, errors) {
  const requirements = node?.requirements;
  if (requirements == null) return;
  if (!isObject(requirements)) {
    addIssue(errors, `skillNodes: "${node.id}" requirements must be an object.`);
    return;
  }

  const requiredNodeIds = toArray(requirements.requiredNodeIds);
  for (const reqId of requiredNodeIds) {
    if (typeof reqId !== "string" || !reqId.length) {
      addIssue(errors, `skillNodes: "${node.id}" requiredNodeIds must contain non-empty strings.`);
      continue;
    }
    if (!allNodeIds.has(reqId)) {
      addIssue(errors, `skillNodes: "${node.id}" requirement node "${reqId}" not found.`);
    }
  }
}

export function validateSkillDefs({
  skillTrees,
  skillNodes,
  recipeDefs,
  hubStructureDefs,
} = {}) {
  const errors = [];
  const warnings = [];

  if (!isObject(skillTrees)) {
    addIssue(errors, "skillTrees registry missing or invalid.");
    return { ok: false, errors, warnings };
  }
  if (!isObject(skillNodes)) {
    addIssue(errors, "skillNodes registry missing or invalid.");
    return { ok: false, errors, warnings };
  }

  const treeById = new Map();
  for (const [key, tree] of Object.entries(skillTrees)) {
    if (!isObject(tree)) {
      addIssue(errors, `skillTrees: entry "${key}" must be an object.`);
      continue;
    }
    if (typeof tree.id !== "string" || !tree.id.length) {
      addIssue(errors, `skillTrees: entry "${key}" missing string id.`);
      continue;
    }
    if (treeById.has(tree.id)) {
      addIssue(errors, `skillTrees: duplicate id "${tree.id}".`);
      continue;
    }
    if (tree.id !== key) {
      warnings.push(`skillTrees: key "${key}" differs from id "${tree.id}".`);
    }
    if (typeof tree.startNodeId !== "string" || !tree.startNodeId.length) {
      addIssue(errors, `skillTrees: "${tree.id}" missing startNodeId.`);
      continue;
    }
    treeById.set(tree.id, tree);
  }

  const nodeById = new Map();
  for (const [key, node] of Object.entries(skillNodes)) {
    if (!isObject(node)) {
      addIssue(errors, `skillNodes: entry "${key}" must be an object.`);
      continue;
    }
    if (typeof node.id !== "string" || !node.id.length) {
      addIssue(errors, `skillNodes: entry "${key}" missing string id.`);
      continue;
    }
    if (nodeById.has(node.id)) {
      addIssue(errors, `skillNodes: duplicate id "${node.id}".`);
      continue;
    }
    if (node.id !== key) {
      warnings.push(`skillNodes: key "${key}" differs from id "${node.id}".`);
    }
    if (typeof node.treeId !== "string" || !node.treeId.length) {
      addIssue(errors, `skillNodes: "${node.id}" missing treeId.`);
    } else if (!treeById.has(node.treeId)) {
      addIssue(errors, `skillNodes: "${node.id}" references unknown tree "${node.treeId}".`);
    }
    if (typeof node.name !== "string" || !node.name.length) {
      addIssue(errors, `skillNodes: "${node.id}" missing name.`);
    }
    if (node.desc != null && typeof node.desc !== "string") {
      addIssue(errors, `skillNodes: "${node.id}" desc must be a string when provided.`);
    }
    const cost = normalizeNodeCost(node);
    if (!Number.isFinite(cost) || cost < 0) {
      addIssue(errors, `skillNodes: "${node.id}" cost must be >= 0.`);
    }

    if (node.uiPos != null) {
      if (!isObject(node.uiPos)) {
        addIssue(errors, `skillNodes: "${node.id}" uiPos must be an object.`);
      } else if (!Number.isFinite(node.uiPos.x) || !Number.isFinite(node.uiPos.y)) {
        addIssue(errors, `skillNodes: "${node.id}" uiPos requires numeric x and y.`);
      }
    }

    nodeById.set(node.id, node);
  }

  const allNodeIds = new Set(nodeById.keys());
  const knownRecipeIds = new Set(Object.keys(recipeDefs || {}));
  const knownHubIds = new Set(Object.keys(hubStructureDefs || {}));

  const treeNodeIds = new Map();
  for (const [nodeId, node] of nodeById.entries()) {
    const treeId = node.treeId;
    if (!treeNodeIds.has(treeId)) treeNodeIds.set(treeId, new Set());
    treeNodeIds.get(treeId).add(nodeId);
  }

  for (const [treeId, tree] of treeById.entries()) {
    const nodesInTree = treeNodeIds.get(treeId) || new Set();
    if (!nodesInTree.size) {
      addIssue(errors, `skillTrees: "${treeId}" has no nodes.`);
      continue;
    }
    if (!nodesInTree.has(tree.startNodeId)) {
      addIssue(errors, `skillTrees: "${treeId}" startNodeId "${tree.startNodeId}" is not in the tree.`);
    }
  }

  for (const [nodeId, node] of nodeById.entries()) {
    const adjacent = toArray(node.adjacent);
    for (const adjId of adjacent) {
      if (typeof adjId !== "string" || !adjId.length) {
        addIssue(errors, `skillNodes: "${nodeId}" adjacent must contain non-empty strings.`);
        continue;
      }
      const adj = nodeById.get(adjId);
      if (!adj) {
        addIssue(errors, `skillNodes: "${nodeId}" adjacent node "${adjId}" not found.`);
        continue;
      }
      if (adj.treeId !== node.treeId) {
        addIssue(errors, `skillNodes: "${nodeId}" adjacent node "${adjId}" is in another tree.`);
        continue;
      }
      const reverse = toArray(adj.adjacent);
      if (!reverse.includes(nodeId)) {
        addIssue(errors, `skillNodes: adjacency must be symmetric ("${nodeId}" <-> "${adjId}").`);
      }
    }

    validateEffects(node, knownRecipeIds, knownHubIds, errors);
    validateRequirements(node, allNodeIds, errors);
  }

  return { ok: errors.length === 0, errors, warnings };
}
