// skill-tree-pixi.js
// Full-screen skill tree overlay with deterministic buffered unlock commits.

import { ActionKinds } from "../model/actions.js";
import {
  evaluateSkillNodeUnlock,
  getDeterministicSkillCommitOrder,
  getSkillNodeDef,
  getSkillTreeDefs,
  getSkillTreeLayout,
  getUnlockedSkillSet,
} from "../model/skills.js";

const NODE_RADIUS = 26;
const EDGE_COLOR = 0x4b5875;
const EDGE_ALPHA = 0.8;

function floorInt(value, fallback = 0) {
  return Number.isFinite(value) ? Math.floor(value) : fallback;
}

function sortedStrings(values) {
  return values.slice().sort((a, b) => String(a).localeCompare(String(b)));
}

function formatNodeEffects(nodeDef) {
  const lines = [];
  const effects = nodeDef?.effects || null;
  if (!effects) return lines;

  const charMods = effects.characterMods || null;
  if (charMods) {
    if (Number.isFinite(charMods.forageTierBonus)) {
      lines.push(`Forage tier +${floorInt(charMods.forageTierBonus)}`);
    }
    if (Number.isFinite(charMods.forageStaminaCostDelta)) {
      lines.push(`Forage stamina ${floorInt(charMods.forageStaminaCostDelta)}`);
    }
    if (Number.isFinite(charMods.farmingStaminaCostDelta)) {
      lines.push(`Farming stamina ${floorInt(charMods.farmingStaminaCostDelta)}`);
    }
    if (Number.isFinite(charMods.restStaminaBonusFlat)) {
      lines.push(`Rest stamina +${floorInt(charMods.restStaminaBonusFlat)}`);
    }
    if (Number.isFinite(charMods.restStaminaBonusMult)) {
      const pct = Math.round((charMods.restStaminaBonusMult - 1) * 100);
      lines.push(`Rest stamina +${pct}%`);
    }
  }

  const globalMods = effects.globalMods || null;
  if (globalMods) {
    if (Number.isFinite(globalMods.apCapBonus)) {
      lines.push(`AP cap +${floorInt(globalMods.apCapBonus)}`);
    }
    if (Number.isFinite(globalMods.projectionHorizonBonusSec)) {
      lines.push(`Projection horizon +${floorInt(globalMods.projectionHorizonBonusSec)}s`);
    }
    if (Number.isFinite(globalMods.populationFoodMult)) {
      const pct = Math.round((1 - globalMods.populationFoodMult) * 100);
      lines.push(`Population food -${pct}%`);
    }
  }

  const unlocks = effects.unlocks || null;
  if (unlocks) {
    const recipes = Array.isArray(unlocks.recipes) ? unlocks.recipes : [];
    const structures = Array.isArray(unlocks.hubStructures)
      ? unlocks.hubStructures
      : [];
    if (recipes.length) lines.push(`Unlock recipes: ${recipes.join(", ")}`);
    if (structures.length) lines.push(`Unlock buildings: ${structures.join(", ")}`);
  }

  return lines;
}

function makeButton(label, width, onTap) {
  const root = new PIXI.Container();
  root.eventMode = "static";
  root.cursor = "pointer";

  const bg = new PIXI.Graphics();
  bg.beginFill(0x2a3350, 0.96);
  bg.drawRoundedRect(0, 0, width, 34, 8);
  bg.endFill();
  root.addChild(bg);

  const text = new PIXI.Text(label, {
    fill: 0xffffff,
    fontSize: 13,
    fontWeight: "bold",
  });
  text.x = Math.floor((width - text.width) / 2);
  text.y = 8;
  root.addChild(text);

  root.on("pointertap", (ev) => {
    ev?.stopPropagation?.();
    onTap?.();
  });

  return { root, bg, text };
}

export function createSkillTreeView({ app, layer, runner } = {}) {
  const root = new PIXI.Container();
  root.visible = false;
  root.eventMode = "static";
  layer.addChild(root);

  const bg = new PIXI.Graphics();
  root.addChild(bg);

  const title = new PIXI.Text("Skill Tree", {
    fill: 0xffffff,
    fontSize: 26,
    fontWeight: "bold",
  });
  title.x = 36;
  title.y = 22;
  root.addChild(title);

  const pointsText = new PIXI.Text("", {
    fill: 0xadd8ff,
    fontSize: 14,
    fontWeight: "bold",
  });
  pointsText.x = 36;
  pointsText.y = 60;
  root.addChild(pointsText);

  const infoText = new PIXI.Text("", {
    fill: 0xe3e9f7,
    fontSize: 12,
    wordWrap: true,
    wordWrapWidth: 360,
  });
  infoText.x = 1510;
  infoText.y = 180;
  root.addChild(infoText);

  const errorText = new PIXI.Text("", {
    fill: 0xff9b9b,
    fontSize: 12,
    wordWrap: true,
    wordWrapWidth: 600,
  });
  errorText.x = 36;
  errorText.y = 96;
  root.addChild(errorText);

  const treeLayer = new PIXI.Container();
  treeLayer.x = 0;
  treeLayer.y = 0;
  root.addChild(treeLayer);

  const saveBtn = makeButton("Save/Exit", 160, () => saveAndExit());
  saveBtn.root.x = 1510;
  saveBtn.root.y = 34;
  root.addChild(saveBtn.root);

  const cancelBtn = makeButton("Cancel/Back", 160, () => cancelAndExit());
  cancelBtn.root.x = 1690;
  cancelBtn.root.y = 34;
  root.addChild(cancelBtn.root);

  let activeCharacterId = null;
  let activeTreeId = null;
  let activeDefs = null;
  let bufferUnlockIds = new Set();
  let selectedNodeId = null;
  let onExit = null;

  function getState() {
    return runner?.getCursorState?.() ?? runner?.getState?.() ?? null;
  }

  function getCharacter(state) {
    const chars = Array.isArray(state?.characters) ? state.characters : [];
    return chars.find((ch) => ch && ch.id === activeCharacterId) || null;
  }

  function getBufferedCost() {
    if (!activeTreeId || !bufferUnlockIds.size) return 0;
    let total = 0;
    for (const nodeId of bufferUnlockIds.values()) {
      const node = getSkillNodeDef(activeDefs, nodeId);
      total += Number.isFinite(node?.cost) ? Math.max(0, floorInt(node.cost)) : 1;
    }
    return total;
  }

  function updateInfoText(state) {
    const hoverNodeId = selectedNodeId;
    const nodeDef = hoverNodeId ? getSkillNodeDef(activeDefs, hoverNodeId) : null;
    if (!nodeDef) {
      infoText.text = "Select a node to view details.";
      return;
    }

    const unlockedSet = getUnlockedSkillSet(state, activeCharacterId);
    const isUnlocked = unlockedSet.has(nodeDef.id);
    const isPending = bufferUnlockIds.has(nodeDef.id);
    const status = isUnlocked ? "Unlocked" : isPending ? "Queued" : "Locked";
    const cost = Number.isFinite(nodeDef.cost) ? Math.max(0, floorInt(nodeDef.cost)) : 1;
    const reqs = Array.isArray(nodeDef?.requirements?.requiredNodeIds)
      ? nodeDef.requirements.requiredNodeIds
      : [];

    const lines = [
      nodeDef.name || nodeDef.id,
      "",
      nodeDef.desc || "",
      "",
      `Status: ${status}`,
      `Cost: ${cost}`,
    ];
    if (reqs.length) {
      lines.push(`Requires: ${reqs.join(", ")}`);
    }
    const effectLines = formatNodeEffects(nodeDef);
    if (effectLines.length) {
      lines.push("", "Effects:");
      for (const line of effectLines) lines.push(`- ${line}`);
    }
    infoText.text = lines.join("\n");
  }

  function getProjectedUnlockContext(state, character) {
    const unlocked = getUnlockedSkillSet(state, activeCharacterId);
    for (const nodeId of bufferUnlockIds.values()) {
      unlocked.add(nodeId);
    }
    const pointsNow = Number.isFinite(character?.skillPoints)
      ? Math.max(0, floorInt(character.skillPoints))
      : 0;
    const pointsAfterBuffer = Math.max(0, pointsNow - getBufferedCost());
    return { unlocked, points: pointsAfterBuffer };
  }

  function getNodeVisualState(state, character, nodeId) {
    const baseUnlocked = getUnlockedSkillSet(state, activeCharacterId);
    if (baseUnlocked.has(nodeId)) return "unlocked";
    if (bufferUnlockIds.has(nodeId)) return "pending";

    const projected = getProjectedUnlockContext(state, character);
    const evalRes = evaluateSkillNodeUnlock(state, activeCharacterId, nodeId, {
      unlockedSet: projected.unlocked,
      skillPoints: projected.points,
    });
    return evalRes?.ok ? "unlockable" : "locked";
  }

  function renderTree() {
    const state = getState();
    const character = getCharacter(state);
    treeLayer.removeChildren();
    if (!state || !character || !activeTreeId) return;

    const layout = getSkillTreeLayout(
      activeTreeId,
      {
        x: 60,
        y: 130,
        width: 1380,
        height: 820,
        columnSpacing: 220,
        rowSpacing: 110,
        leftPad: 80,
      },
      activeDefs
    );
    const positions = layout.positionsByNodeId || {};

    const edgeGraphics = new PIXI.Graphics();
    edgeGraphics.lineStyle(2, EDGE_COLOR, EDGE_ALPHA);
    for (const edge of layout.edges || []) {
      const pa = positions[edge.a];
      const pb = positions[edge.b];
      if (!pa || !pb) continue;
      edgeGraphics.moveTo(pa.x, pa.y);
      edgeGraphics.lineTo(pb.x, pb.y);
    }
    treeLayer.addChild(edgeGraphics);

    const orderedNodes = sortedStrings(Object.keys(positions));
    for (const nodeId of orderedNodes) {
      const pos = positions[nodeId];
      const status = getNodeVisualState(state, character, nodeId);

      const node = new PIXI.Container();
      node.x = pos.x;
      node.y = pos.y;
      node.eventMode = "static";
      node.cursor = status === "unlockable" ? "pointer" : "default";

      const fillColor =
        status === "unlocked"
          ? 0x5dbb63
          : status === "pending"
          ? 0x4fa3ff
          : status === "unlockable"
          ? 0xe6c84f
          : 0x3b4255;

      const circle = new PIXI.Graphics();
      circle
        .lineStyle(selectedNodeId === nodeId ? 3 : 2, 0xcfe8ff, 1)
        .beginFill(fillColor, status === "locked" ? 0.65 : 0.95)
        .drawCircle(0, 0, NODE_RADIUS)
        .endFill();
      node.addChild(circle);

      const label = new PIXI.Text(nodeId.replace(/^skill_/, ""), {
        fill: 0xffffff,
        fontSize: 9,
        align: "center",
      });
      label.anchor.set(0.5, 0.5);
      node.addChild(label);

      node.on("pointertap", (ev) => {
        ev?.stopPropagation?.();
        selectedNodeId = nodeId;
        if (status === "unlockable") {
          bufferUnlockIds.add(nodeId);
          errorText.text = "";
        }
        updateInfoText(state);
        renderTree();
      });

      treeLayer.addChild(node);
    }

    const skillPoints = Number.isFinite(character.skillPoints)
      ? Math.max(0, floorInt(character.skillPoints))
      : 0;
    const totalCost = getBufferedCost();
    const remaining = Math.max(0, skillPoints - totalCost);
    pointsText.text = `Skill Points: ${remaining}/${skillPoints}  |  Queued Cost: ${totalCost}`;
    updateInfoText(state);
  }

  function resolveCommitOrder() {
    if (!bufferUnlockIds.size) return [];
    const grouped = new Map();
    for (const nodeId of bufferUnlockIds.values()) {
      const node = getSkillNodeDef(activeDefs, nodeId);
      if (!node?.treeId) continue;
      if (!grouped.has(node.treeId)) grouped.set(node.treeId, []);
      grouped.get(node.treeId).push(nodeId);
    }
    const ordered = [];
    const treeIds = sortedStrings(Array.from(grouped.keys()));
    for (const treeId of treeIds) {
      const nodeIds = grouped.get(treeId) || [];
      const sorted = getDeterministicSkillCommitOrder(treeId, nodeIds, activeDefs);
      for (const nodeId of sorted) ordered.push(nodeId);
    }
    return ordered;
  }

  function saveAndExit() {
    const state = getState();
    if (!state?.paused) {
      errorText.text = "Skill changes can only be saved while paused.";
      return;
    }

    const order = resolveCommitOrder();
    for (const nodeId of order) {
      const res = runner?.dispatchAction?.(
        ActionKinds.UNLOCK_SKILL_NODE,
        { characterId: activeCharacterId, nodeId },
        { apCost: 0 }
      );
      if (!res?.ok) {
        errorText.text = `Failed to unlock "${nodeId}": ${res?.reason || "unknown"}`;
        bufferUnlockIds.clear();
        renderTree();
        return;
      }
    }

    const exitCb = onExit;
    const characterId = activeCharacterId;
    close();
    exitCb?.({ saved: true, characterId, unlocked: order });
  }

  function cancelAndExit() {
    const exitCb = onExit;
    const characterId = activeCharacterId;
    close();
    exitCb?.({ saved: false, characterId });
  }

  function open({ characterId, defs = null, onExit: onExitCb } = {}) {
    const state = getState();
    if (!state) return { ok: false, reason: "noState" };
    if (!Number.isFinite(characterId)) return { ok: false, reason: "badCharacterId" };

    const trees = getSkillTreeDefs(defs);
    const treeIds = sortedStrings(Object.keys(trees || {}));
    if (!treeIds.length) return { ok: false, reason: "noSkillTrees" };

    activeCharacterId = Math.floor(characterId);
    activeTreeId = treeIds[0];
    activeDefs = defs;
    bufferUnlockIds = new Set();
    selectedNodeId = null;
    onExit = typeof onExitCb === "function" ? onExitCb : null;
    errorText.text = "";
    root.visible = true;
    renderTree();
    return { ok: true };
  }

  function close() {
    root.visible = false;
    treeLayer.removeChildren();
    activeCharacterId = null;
    activeTreeId = null;
    activeDefs = null;
    bufferUnlockIds.clear();
    selectedNodeId = null;
    errorText.text = "";
    pointsText.text = "";
    infoText.text = "";
    onExit = null;
  }

  function resize() {
    const width = Number.isFinite(app?.screen?.width) ? app.screen.width : 1920;
    const height = Number.isFinite(app?.screen?.height) ? app.screen.height : 1080;
    bg.clear();
    bg.beginFill(0x0a1020, 0.98);
    bg.drawRect(0, 0, width, height);
    bg.endFill();
  }

  resize();

  return {
    open,
    close,
    isOpen: () => root.visible,
    update: () => {},
    resize,
  };
}
