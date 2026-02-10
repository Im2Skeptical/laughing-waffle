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
import {
  DEFAULT_NODE_RADIUS,
  DEFAULT_NOTABLE_RADIUS,
  EDGE_ALPHA,
  EDGE_COLOR,
  EDGE_CURVE_MAX_OFFSET,
  EDGE_ENDPOINT_LANE_SCALE,
  EDGE_MODE_ALL,
  EDGE_MODE_FOCUS,
  EDGE_MODE_ORDER,
  EDGE_MODE_PROGRESS,
  MAX_NODE_RADIUS,
  MAX_ZOOM,
  MIN_NODE_RADIUS,
  MIN_ZOOM,
  RIGHT_PANEL_X,
  VIEWPORT_HEIGHT,
  VIEWPORT_WIDTH,
  VIEWPORT_X,
  VIEWPORT_Y,
} from "./skill-tree/constants.js";
import { makeButton } from "./skill-tree/button.js";
import { clamp, floorInt, formatNodeEffects, sortedStrings } from "./skill-tree/formatters.js";
import {
  computeEdgeLaneData,
  getFocusSets,
  makeDirectedEdgeKey,
  makeEdgeKey,
} from "./skill-tree/edge-routing.js";

export function createSkillTreeView({ app, layer, runner } = {}) {
  const root = new PIXI.Container();
  root.visible = false;
  root.eventMode = "static";
  layer.addChild(root);

  const bg = new PIXI.Graphics();
  root.addChild(bg);

  const title = new PIXI.Text("Skill Tree", {
    fill: 0xffffff,
    fontSize: 30,
    fontWeight: "bold",
  });
  title.x = RIGHT_PANEL_X;
  title.y = 22;
  root.addChild(title);

  const pointsText = new PIXI.Text("", {
    fill: 0xadd8ff,
    fontSize: 16,
    fontWeight: "bold",
  });
  pointsText.x = RIGHT_PANEL_X;
  pointsText.y = 62;
  root.addChild(pointsText);

  const infoText = new PIXI.Text("", {
    fill: 0xe3e9f7,
    fontSize: 16,
    lineHeight: 24,
    wordWrap: true,
    wordWrapWidth: 390,
  });
  infoText.x = RIGHT_PANEL_X;
  infoText.y = 260;
  root.addChild(infoText);

  const errorText = new PIXI.Text("", {
    fill: 0xff9b9b,
    fontSize: 13,
    wordWrap: true,
    wordWrapWidth: 390,
  });
  errorText.x = RIGHT_PANEL_X;
  errorText.y = 232;
  root.addChild(errorText);

  const viewport = new PIXI.Container();
  viewport.x = VIEWPORT_X;
  viewport.y = VIEWPORT_Y;
  root.addChild(viewport);

  const viewportBg = new PIXI.Graphics();
  viewportBg.eventMode = "static";
  viewportBg.cursor = "grab";
  viewport.addChild(viewportBg);

  const treeWorld = new PIXI.Container();
  viewport.addChild(treeWorld);

  const viewportMask = new PIXI.Graphics();
  root.addChild(viewportMask);
  viewport.mask = viewportMask;

  const saveBtn = makeButton("Save/Exit", 160, () => saveAndExit());
  saveBtn.root.x = RIGHT_PANEL_X;
  saveBtn.root.y = 104;
  root.addChild(saveBtn.root);

  const cancelBtn = makeButton("Cancel/Back", 160, () => cancelAndExit());
  cancelBtn.root.x = 1690;
  cancelBtn.root.y = 104;
  root.addChild(cancelBtn.root);

  const zoomInBtn = makeButton("Zoom +", 90, () => zoomBy(1.12));
  zoomInBtn.root.x = RIGHT_PANEL_X;
  zoomInBtn.root.y = 148;
  root.addChild(zoomInBtn.root);

  const zoomOutBtn = makeButton("Zoom -", 90, () => zoomBy(1 / 1.12));
  zoomOutBtn.root.x = 1610;
  zoomOutBtn.root.y = 148;
  root.addChild(zoomOutBtn.root);

  const zoomText = new PIXI.Text("", {
    fill: 0xbfd2f0,
    fontSize: 13,
    fontWeight: "bold",
  });
  zoomText.x = 1710;
  zoomText.y = 156;
  root.addChild(zoomText);

  const edgeModeBtn = makeButton("Edges: Focus", 160, () => cycleEdgeMode());
  edgeModeBtn.root.x = RIGHT_PANEL_X;
  edgeModeBtn.root.y = 192;
  root.addChild(edgeModeBtn.root);

  let activeCharacterId = null;
  let activeTreeId = null;
  let activeDefs = null;
  let bufferUnlockIds = new Set();
  let selectedNodeId = null;
  let hoverNodeId = null;
  let edgeMode = EDGE_MODE_FOCUS;
  let onExit = null;
  let cameraInitialized = false;
  const camera = {
    scale: 1,
    x: 0,
    y: 0,
  };
  const pan = {
    active: false,
    startGlobalX: 0,
    startGlobalY: 0,
    startX: 0,
    startY: 0,
    moved: false,
    lastMoved: false,
  };

  function getState() {
    return runner?.getCursorState?.() ?? runner?.getState?.() ?? null;
  }

  function getCharacter(state) {
    const chars = Array.isArray(state?.characters) ? state.characters : [];
    return chars.find((ch) => ch && ch.id === activeCharacterId) || null;
  }

  function getActiveTreeDef() {
    if (!activeTreeId) return null;
    const trees = getSkillTreeDefs(activeDefs) || {};
    return trees[activeTreeId] || null;
  }

  function getNodeRadius(nodeDef, treeDef = null) {
    const tree = treeDef || getActiveTreeDef();
    const tags = Array.isArray(nodeDef?.tags) ? nodeDef.tags : [];
    const nodeSizes =
      tree?.ui && typeof tree.ui === "object" && tree.ui.nodeSizes
        ? tree.ui.nodeSizes
        : null;
    const defaultRadius = Number.isFinite(nodeSizes?.defaultRadius)
      ? nodeSizes.defaultRadius
      : DEFAULT_NODE_RADIUS;
    const notableRadius = Number.isFinite(nodeSizes?.notableRadius)
      ? nodeSizes.notableRadius
      : DEFAULT_NOTABLE_RADIUS;
    const fallback = tags.includes("Notable") ? notableRadius : defaultRadius;
    const override = Number.isFinite(nodeDef?.uiNodeRadius)
      ? nodeDef.uiNodeRadius
      : null;
    return clamp(
      Number.isFinite(override) ? override : fallback,
      MIN_NODE_RADIUS,
      MAX_NODE_RADIUS
    );
  }

  function applyCamera() {
    treeWorld.scale.set(camera.scale);
    treeWorld.position.set(Math.floor(camera.x), Math.floor(camera.y));
    zoomText.text = `${Math.round(camera.scale * 100)}%`;
  }

  function setCamera(scale, x, y) {
    camera.scale = clamp(scale, MIN_ZOOM, MAX_ZOOM);
    camera.x = x;
    camera.y = y;
    applyCamera();
  }

  function toStageCoordsFromClient(clientX, clientY) {
    const view = app?.view;
    const screen = app?.screen;
    if (!view || !screen) return null;
    const rect = view.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    const x = ((clientX - rect.left) * screen.width) / rect.width;
    const y = ((clientY - rect.top) * screen.height) / rect.height;
    return { x, y };
  }

  function zoomAtGlobal(globalX, globalY, factor) {
    const local = viewport.toLocal({ x: globalX, y: globalY });
    if (
      local.x < 0 ||
      local.y < 0 ||
      local.x > VIEWPORT_WIDTH ||
      local.y > VIEWPORT_HEIGHT
    ) {
      return;
    }

    const prevScale = camera.scale;
    const nextScale = clamp(prevScale * factor, MIN_ZOOM, MAX_ZOOM);
    if (Math.abs(nextScale - prevScale) < 0.0001) return;

    const worldX = (local.x - camera.x) / prevScale;
    const worldY = (local.y - camera.y) / prevScale;
    const nextX = local.x - worldX * nextScale;
    const nextY = local.y - worldY * nextScale;
    setCamera(nextScale, nextX, nextY);
  }

  function zoomBy(factor) {
    const centerGX = VIEWPORT_X + VIEWPORT_WIDTH / 2;
    const centerGY = VIEWPORT_Y + VIEWPORT_HEIGHT / 2;
    zoomAtGlobal(centerGX, centerGY, factor);
  }

  function fitCameraToLayout(positionsByNodeId) {
    const ids = sortedStrings(Object.keys(positionsByNodeId || {}));
    if (!ids.length) {
      setCamera(1, 0, 0);
      return;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const treeDef = getActiveTreeDef();
    for (const nodeId of ids) {
      const pos = positionsByNodeId[nodeId];
      const nodeDef = getSkillNodeDef(activeDefs, nodeId);
      const radius = getNodeRadius(nodeDef, treeDef);
      minX = Math.min(minX, pos.x - radius);
      minY = Math.min(minY, pos.y - radius);
      maxX = Math.max(maxX, pos.x + radius);
      maxY = Math.max(maxY, pos.y + radius);
    }

    const padding = 72;
    minX -= padding;
    minY -= padding;
    maxX += padding;
    maxY += padding;
    const spanX = Math.max(1, maxX - minX);
    const spanY = Math.max(1, maxY - minY);
    const scaleX = VIEWPORT_WIDTH / spanX;
    const scaleY = VIEWPORT_HEIGHT / spanY;
    const targetScale = clamp(Math.min(scaleX, scaleY), MIN_ZOOM, Math.min(MAX_ZOOM, 1.2));
    const x = (VIEWPORT_WIDTH - spanX * targetScale) / 2 - minX * targetScale;
    const y = (VIEWPORT_HEIGHT - spanY * targetScale) / 2 - minY * targetScale;
    setCamera(targetScale, x, y);
  }

  function getInfoNodeId() {
    return hoverNodeId || selectedNodeId || null;
  }

  function updateEdgeModeButton() {
    const label =
      edgeMode === EDGE_MODE_ALL
        ? "Edges: All"
        : edgeMode === EDGE_MODE_PROGRESS
          ? "Edges: Progress"
          : "Edges: Focus";
    edgeModeBtn.text.text = label;
    edgeModeBtn.text.x = Math.floor((160 - edgeModeBtn.text.width) / 2);
  }

  function cycleEdgeMode() {
    const idx = EDGE_MODE_ORDER.indexOf(edgeMode);
    edgeMode = EDGE_MODE_ORDER[(idx + 1) % EDGE_MODE_ORDER.length];
    updateEdgeModeButton();
    renderTree();
  }

  function getBufferedUnlockedSet(state) {
    const unlocked = getUnlockedSkillSet(state, activeCharacterId);
    for (const nodeId of bufferUnlockIds.values()) unlocked.add(nodeId);
    return unlocked;
  }

  function shouldShowNodeLabel(nodeDef, status, nodeId) {
    const isFocused = nodeId === getInfoNodeId();
    const tags = Array.isArray(nodeDef?.tags) ? nodeDef.tags : [];
    const isNotable = tags.includes("Notable");
    if (camera.scale >= 0.95) return true;
    if (camera.scale >= 0.65) {
      return isFocused || isNotable || status === "unlockable" || status === "pending";
    }
    return isFocused || isNotable || status === "pending";
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
    const infoNodeId = getInfoNodeId();
    const nodeDef = infoNodeId ? getSkillNodeDef(activeDefs, infoNodeId) : null;
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
    treeWorld.removeChildren();
    if (!state || !character || !activeTreeId) return;

    const treeDef = getActiveTreeDef();
    const layout = getSkillTreeLayout(
      activeTreeId,
      {
        x: 90,
        y: 70,
        width: 1280,
        height: 900,
        columnSpacing: 220,
        rowSpacing: 110,
        leftPad: 120,
      },
      activeDefs
    );
    const positions = layout.positionsByNodeId || {};
    const orderedNodes = sortedStrings(Object.keys(positions));
    const nodeStatusById = new Map();
    for (const nodeId of orderedNodes) {
      nodeStatusById.set(nodeId, getNodeVisualState(state, character, nodeId));
    }

    const focusNodeId = getInfoNodeId();
    const { focusNodes, focusEdges } = getFocusSets(layout.edges || [], focusNodeId);
    const unlockedProjected = getBufferedUnlockedSet(state);
    const edgeLaneData = computeEdgeLaneData(layout.edges || [], positions);

    const edgeLayer = new PIXI.Container();
    treeWorld.addChild(edgeLayer);

    const nodeLayer = new PIXI.Container();
    treeWorld.addChild(nodeLayer);

    const edgeGraphics = new PIXI.Graphics();
    for (const edge of layout.edges || []) {
      const edgeKey = makeEdgeKey(edge.a, edge.b);
      const pa = positions[edge.a];
      const pb = positions[edge.b];
      if (!pa || !pb) continue;
      const sa = nodeStatusById.get(edge.a);
      const sb = nodeStatusById.get(edge.b);
      const endAHot =
        unlockedProjected.has(edge.a) || sa === "pending" || sa === "unlockable";
      const endBHot =
        unlockedProjected.has(edge.b) || sb === "pending" || sb === "unlockable";

      if (
        edgeMode === EDGE_MODE_ALL &&
        camera.scale < 0.55 &&
        !focusEdges.has(edgeKey) &&
        !(endAHot || endBHot)
      ) {
        continue;
      }

      let color = EDGE_COLOR;
      let alpha = EDGE_ALPHA * 0.26;
      let width = 2;

      if (edgeMode === EDGE_MODE_FOCUS) {
        if (focusEdges.has(edgeKey)) {
          color = 0xa5d4ff;
          alpha = 0.98;
          width = 3;
        } else if (focusNodeId) {
          alpha = 0.07;
        } else {
          alpha = EDGE_ALPHA * 0.24;
        }
      } else if (edgeMode === EDGE_MODE_PROGRESS) {
        if (endAHot && endBHot) {
          color = 0x84f5a4;
          alpha = 0.85;
          width = 2.6;
        } else if (endAHot || endBHot) {
          color = 0xe6c84f;
          alpha = 0.48;
          width = 2.2;
        } else {
          alpha = 0.06;
        }
        if (focusEdges.has(edgeKey)) {
          alpha = Math.max(alpha, 0.85);
          color = 0xa5d4ff;
          width = Math.max(width, 2.8);
        }
      } else if (focusEdges.has(edgeKey)) {
        alpha = 0.7;
        color = 0xa5d4ff;
        width = 2.6;
      }

      if (edgeMode === EDGE_MODE_ALL && camera.scale < 0.55 && !focusEdges.has(edgeKey)) {
        alpha *= endAHot || endBHot ? 0.7 : 0.45;
      }

      edgeGraphics.lineStyle(width, color, alpha);
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const startLaneOffset =
        edgeLaneData.endpointOffsetByEdgeKey.get(makeDirectedEdgeKey(edge.a, edge.b)) || 0;
      const endLaneOffset =
        edgeLaneData.endpointOffsetByEdgeKey.get(makeDirectedEdgeKey(edge.b, edge.a)) || 0;
      const startX = pa.x + nx * startLaneOffset * EDGE_ENDPOINT_LANE_SCALE;
      const startY = pa.y + ny * startLaneOffset * EDGE_ENDPOINT_LANE_SCALE;
      const endX = pb.x + nx * endLaneOffset * EDGE_ENDPOINT_LANE_SCALE;
      const endY = pb.y + ny * endLaneOffset * EDGE_ENDPOINT_LANE_SCALE;
      const offset = edgeLaneData.edgeOffsetByKey.get(edgeKey) || 0;
      if (Math.abs(offset) > 0.5) {
        const curvedOffset = clamp(
          offset,
          -EDGE_CURVE_MAX_OFFSET,
          EDGE_CURVE_MAX_OFFSET
        );
        const cx = (startX + endX) / 2 + nx * curvedOffset;
        const cy = (startY + endY) / 2 + ny * curvedOffset;
        edgeGraphics.moveTo(startX, startY);
        edgeGraphics.quadraticCurveTo(cx, cy, endX, endY);
      } else {
        edgeGraphics.moveTo(startX, startY);
        edgeGraphics.lineTo(endX, endY);
      }
    }
    edgeLayer.addChild(edgeGraphics);

    for (const nodeId of orderedNodes) {
      const pos = positions[nodeId];
      const status = nodeStatusById.get(nodeId) || "locked";
      const nodeDef = getSkillNodeDef(activeDefs, nodeId);
      const nodeRadius = getNodeRadius(nodeDef, treeDef);
      const isHovered = hoverNodeId === nodeId;
      const isSelected = selectedNodeId === nodeId;
      const inFocusNeighborhood = !focusNodeId || focusNodes.has(nodeId);

      const node = new PIXI.Container();
      node.x = pos.x;
      node.y = pos.y;
      node.eventMode = "static";
      node.cursor = status === "unlockable" ? "pointer" : "default";
      node.alpha = inFocusNeighborhood ? 1 : 0.36;

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
        .lineStyle(
          isHovered || isSelected ? 3 : 2,
          isHovered ? 0xffffff : 0xcfe8ff,
          1
        )
        .beginFill(fillColor, status === "locked" ? 0.65 : 0.95)
        .drawCircle(0, 0, nodeRadius)
        .endFill();
      node.addChild(circle);

      const label = new PIXI.Text(nodeId.replace(/^skill_/, ""), {
        fill: 0xffffff,
        fontSize: Math.max(9, Math.floor(nodeRadius * 0.34)),
        align: "center",
      });
      label.anchor.set(0.5, 0.5);
      label.visible = shouldShowNodeLabel(nodeDef, status, nodeId);
      node.addChild(label);

      node.on("pointerdown", (ev) => {
        ev?.stopPropagation?.();
      });
      node.on("pointerover", (ev) => {
        ev?.stopPropagation?.();
        if (hoverNodeId === nodeId) return;
        hoverNodeId = nodeId;
        updateInfoText(state);
        renderTree();
      });
      node.on("pointerout", (ev) => {
        ev?.stopPropagation?.();
        if (hoverNodeId !== nodeId) return;
        hoverNodeId = null;
        updateInfoText(state);
        renderTree();
      });
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

      nodeLayer.addChild(node);
    }

    if (!cameraInitialized) {
      fitCameraToLayout(positions);
      cameraInitialized = true;
    } else {
      applyCamera();
    }

    const skillPoints = Number.isFinite(character.skillPoints)
      ? Math.max(0, floorInt(character.skillPoints))
      : 0;
    const totalCost = getBufferedCost();
    const remaining = Math.max(0, skillPoints - totalCost);
    pointsText.text = `Skill Points: ${remaining}/${skillPoints}  |  Queued Cost: ${totalCost}`;
    updateInfoText(state);
  }

  function onPanMove(ev) {
    if (!pan.active) return;
    const global = ev?.data?.global;
    if (!global) return;
    const dx = global.x - pan.startGlobalX;
    const dy = global.y - pan.startGlobalY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) pan.moved = true;
    setCamera(camera.scale, pan.startX + dx, pan.startY + dy);
  }

  function endPan() {
    if (!pan.active) return;
    pan.lastMoved = pan.moved;
    pan.active = false;
    pan.moved = false;
    viewportBg.cursor = "grab";
    app?.stage?.off?.("pointermove", onPanMove);
    app?.stage?.off?.("pointerup", endPan);
    app?.stage?.off?.("pointerupoutside", endPan);
  }

  function startPan(ev) {
    if (!root.visible) return;
    const global = ev?.data?.global;
    if (!global) return;
    pan.active = true;
    pan.startGlobalX = global.x;
    pan.startGlobalY = global.y;
    pan.startX = camera.x;
    pan.startY = camera.y;
    pan.moved = false;
    pan.lastMoved = false;
    viewportBg.cursor = "grabbing";
    app?.stage?.on?.("pointermove", onPanMove);
    app?.stage?.on?.("pointerup", endPan);
    app?.stage?.on?.("pointerupoutside", endPan);
    ev?.stopPropagation?.();
  }

  function onWheel(ev) {
    if (!root.visible) return;
    const stagePoint = toStageCoordsFromClient(ev.clientX, ev.clientY);
    if (!stagePoint) return;
    const local = viewport.toLocal(stagePoint);
    if (
      local.x < 0 ||
      local.y < 0 ||
      local.x > VIEWPORT_WIDTH ||
      local.y > VIEWPORT_HEIGHT
    ) {
      return;
    }
    ev.preventDefault();
    const zoomFactor = ev.deltaY < 0 ? 1.1 : 1 / 1.1;
    zoomAtGlobal(stagePoint.x, stagePoint.y, zoomFactor);
  }

  viewportBg.on("pointerdown", startPan);
  viewportBg.on("pointertap", (ev) => {
    if (pan.active || pan.lastMoved) {
      pan.lastMoved = false;
      return;
    }
    selectedNodeId = null;
    updateInfoText(getState());
    ev?.stopPropagation?.();
    renderTree();
  });
  app?.view?.addEventListener?.("wheel", onWheel, { passive: false });

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
    hoverNodeId = null;
    cameraInitialized = false;
    setCamera(1, 0, 0);
    onExit = typeof onExitCb === "function" ? onExitCb : null;
    errorText.text = "";
    root.visible = true;
    renderTree();
    return { ok: true };
  }

  function close() {
    root.visible = false;
    endPan();
    treeWorld.removeChildren();
    activeCharacterId = null;
    activeTreeId = null;
    activeDefs = null;
    bufferUnlockIds.clear();
    selectedNodeId = null;
    hoverNodeId = null;
    cameraInitialized = false;
    setCamera(1, 0, 0);
    errorText.text = "";
    pointsText.text = "";
    zoomText.text = "";
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

    viewportMask.clear();
    viewportMask.beginFill(0xffffff, 1);
    viewportMask.drawRoundedRect(
      VIEWPORT_X,
      VIEWPORT_Y,
      VIEWPORT_WIDTH,
      VIEWPORT_HEIGHT,
      12
    );
    viewportMask.endFill();

    viewportBg.clear();
    viewportBg.beginFill(0x111827, 0.24);
    viewportBg.lineStyle(2, 0x2a3350, 0.9);
    viewportBg.drawRoundedRect(0, 0, VIEWPORT_WIDTH, VIEWPORT_HEIGHT, 12);
    viewportBg.endFill();
    viewportBg.hitArea = new PIXI.Rectangle(0, 0, VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
  }

  updateEdgeModeButton();
  resize();

  return {
    open,
    close,
    isOpen: () => root.visible,
    update: () => {},
    resize,
  };
}
