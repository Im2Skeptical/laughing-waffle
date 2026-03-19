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
} from "./skill-tree/constants.js";
import { makeButton } from "./skill-tree/button.js";
import { clamp, floorInt, formatNodeEffects, sortedStrings } from "./skill-tree/formatters.js";
import {
  computeEdgeLaneData,
  makeDirectedEdgeKey,
  makeEdgeKey,
} from "./skill-tree/edge-routing.js";
import {
  VIEWPORT_DESIGN_HEIGHT,
  VIEWPORT_DESIGN_WIDTH,
  VIEW_LAYOUT,
} from "./layout-pixi.js";

export function createSkillTreeView({
  app,
  layer,
  runner,
  onOpenEditor,
  layout = null,
} = {}) {
  const skillTreeLayout =
    layout && typeof layout === "object" ? layout : VIEW_LAYOUT.skillTree;
  const viewportLayout = skillTreeLayout?.viewport ?? {};
  const panelLayout = skillTreeLayout?.panel ?? {};
  const buttonsLayout = skillTreeLayout?.buttons ?? {};
  const sideTextLayout = skillTreeLayout?.sideText ?? {};
  const graphBoundsLayout = skillTreeLayout?.layoutBounds ?? {};
  const SAVE_BUTTON_WIDTH = 110;
  const CANCEL_BUTTON_WIDTH = 110;
  const EXIT_BUTTON_WIDTH = 110;

  const VIEWPORT_X = Number.isFinite(viewportLayout?.x)
    ? Math.floor(viewportLayout.x)
    : 36;
  const VIEWPORT_Y = Number.isFinite(viewportLayout?.y)
    ? Math.floor(viewportLayout.y)
    : 24;
  const VIEWPORT_WIDTH = Number.isFinite(viewportLayout?.width)
    ? Math.floor(viewportLayout.width)
    : 1460;
  const VIEWPORT_HEIGHT = Number.isFinite(viewportLayout?.height)
    ? Math.floor(viewportLayout.height)
    : 1020;
  const RIGHT_PANEL_X = Number.isFinite(panelLayout?.x)
    ? Math.floor(panelLayout.x)
    : 1510;
  const SIDE_TEXT_WIDTH = Number.isFinite(sideTextLayout?.width)
    ? Math.floor(sideTextLayout.width)
    : 390;
  const SAVE_BUTTON_X = Number.isFinite(buttonsLayout?.saveX)
    ? Math.floor(buttonsLayout.saveX)
    : Number.isFinite(buttonsLayout?.saveExitX)
      ? Math.floor(buttonsLayout.saveExitX)
    : RIGHT_PANEL_X;
  const CANCEL_BUTTON_X = Number.isFinite(buttonsLayout?.cancelX)
    ? Math.floor(buttonsLayout.cancelX)
    : SAVE_BUTTON_X + SAVE_BUTTON_WIDTH + 12;
  const EXIT_BUTTON_X = Number.isFinite(buttonsLayout?.exitX)
    ? Math.floor(buttonsLayout.exitX)
    : CANCEL_BUTTON_X + CANCEL_BUTTON_WIDTH + 12;
  const EDITOR_BUTTON_X = Number.isFinite(buttonsLayout?.editorX)
    ? Math.floor(buttonsLayout.editorX)
    : 1800;
  const ZOOM_IN_BUTTON_X = Number.isFinite(buttonsLayout?.zoomInX)
    ? Math.floor(buttonsLayout.zoomInX)
    : RIGHT_PANEL_X;
  const ZOOM_OUT_BUTTON_X = Number.isFinite(buttonsLayout?.zoomOutX)
    ? Math.floor(buttonsLayout.zoomOutX)
    : 1610;
  const ZOOM_TEXT_X = Number.isFinite(buttonsLayout?.zoomTextX)
    ? Math.floor(buttonsLayout.zoomTextX)
    : 1710;
  const EDGE_MODE_BUTTON_X = Number.isFinite(buttonsLayout?.edgeModeX)
    ? Math.floor(buttonsLayout.edgeModeX)
    : RIGHT_PANEL_X;
  const TREE_LAYOUT_BOUNDS = {
    x: Number.isFinite(graphBoundsLayout?.x)
      ? Math.floor(graphBoundsLayout.x)
      : 90,
    y: Number.isFinite(graphBoundsLayout?.y)
      ? Math.floor(graphBoundsLayout.y)
      : 70,
    width: Number.isFinite(graphBoundsLayout?.width)
      ? Math.floor(graphBoundsLayout.width)
      : 1280,
    height: Number.isFinite(graphBoundsLayout?.height)
      ? Math.floor(graphBoundsLayout.height)
      : 900,
    columnSpacing: Number.isFinite(graphBoundsLayout?.columnSpacing)
      ? Math.floor(graphBoundsLayout.columnSpacing)
      : 220,
    rowSpacing: Number.isFinite(graphBoundsLayout?.rowSpacing)
      ? Math.floor(graphBoundsLayout.rowSpacing)
      : 110,
    leftPad: Number.isFinite(graphBoundsLayout?.leftPad)
      ? Math.floor(graphBoundsLayout.leftPad)
      : 120,
  };
  const EDGE_COLOR_LEARNED = 0x6bd37b;
  const EDGE_COLOR_QUEUED = 0x58c7ff;
  const EDGE_COLOR_PREVIEW = 0x2ec5ff;
  const EDGE_COLOR_NEXT_AVAILABLE = 0x7f6e29;
  const INVALID_NODE_FLASH_MS = 420;
  const INVALID_NODE_FILL = 0xd84b4b;
  const NODE_TAG_TINT_BY_TAG = Object.freeze({
    Blue: 0x68aefb,
    Green: 0x72cf82,
    Red: 0xd77575,
    Black: 0x8a93a3,
  });

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
    wordWrapWidth: SIDE_TEXT_WIDTH,
  });
  infoText.x = RIGHT_PANEL_X;
  infoText.y = 260;
  root.addChild(infoText);

  const errorText = new PIXI.Text("", {
    fill: 0xff9b9b,
    fontSize: 13,
    wordWrap: true,
    wordWrapWidth: SIDE_TEXT_WIDTH,
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

  // Keep panel text above the viewport even when viewport background is opaque.
  root.addChild(title);
  root.addChild(pointsText);
  root.addChild(errorText);
  root.addChild(infoText);

  const saveBtn = makeButton("Save", SAVE_BUTTON_WIDTH, () => saveChanges());
  saveBtn.root.x = SAVE_BUTTON_X;
  saveBtn.root.y = 104;
  root.addChild(saveBtn.root);

  const cancelBtn = makeButton("Cancel", CANCEL_BUTTON_WIDTH, () => cancelQueuedChanges());
  cancelBtn.root.x = CANCEL_BUTTON_X;
  cancelBtn.root.y = 104;
  root.addChild(cancelBtn.root);

  const exitBtn = makeButton("Exit", EXIT_BUTTON_WIDTH, () => exitSkillTree());
  exitBtn.root.x = EXIT_BUTTON_X;
  exitBtn.root.y = 104;
  root.addChild(exitBtn.root);

  const editorBtn = makeButton("Editor", 90, () => openEditor());
  editorBtn.root.x = EDITOR_BUTTON_X;
  editorBtn.root.y = 148;
  root.addChild(editorBtn.root);

  const zoomInBtn = makeButton("Zoom +", 90, () => zoomBy(1.12));
  zoomInBtn.root.x = ZOOM_IN_BUTTON_X;
  zoomInBtn.root.y = 148;
  root.addChild(zoomInBtn.root);

  const zoomOutBtn = makeButton("Zoom -", 90, () => zoomBy(1 / 1.12));
  zoomOutBtn.root.x = ZOOM_OUT_BUTTON_X;
  zoomOutBtn.root.y = 148;
  root.addChild(zoomOutBtn.root);

  const zoomText = new PIXI.Text("", {
    fill: 0xbfd2f0,
    fontSize: 13,
    fontWeight: "bold",
  });
  zoomText.x = ZOOM_TEXT_X;
  zoomText.y = 156;
  root.addChild(zoomText);

  const edgeModeBtn = makeButton("Edges: Focus", 160, () => cycleEdgeMode());
  edgeModeBtn.root.x = EDGE_MODE_BUTTON_X;
  edgeModeBtn.root.y = 192;
  root.addChild(edgeModeBtn.root);

  let activeLeaderPawnId = null;
  let activeTreeId = null;
  let activeDefs = null;
  let bufferUnlockIds = new Set();
  let saveButtonFlashTimeout = null;
  let saveButtonSavedFlashUntilMs = 0;
  let saveButtonErrorState = false;
  let selectedNodeId = null;
  let hoverNodeId = null;
  let invalidNodeFlashUntilById = new Map();
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
  const pinch = {
    active: false,
    startScale: 1,
    startDistance: 0,
    anchorWorldX: 0,
    anchorWorldY: 0,
    moved: false,
  };

  function clearSaveButtonFlashTimer() {
    if (!saveButtonFlashTimeout) return;
    clearTimeout(saveButtonFlashTimeout);
    saveButtonFlashTimeout = null;
  }

  function scheduleSaveButtonRefreshAfterFlash() {
    clearSaveButtonFlashTimer();
    const nowMs = performance.now();
    const remainingMs = Math.max(0, Math.floor(saveButtonSavedFlashUntilMs - nowMs));
    if (remainingMs <= 0) return;
    saveButtonFlashTimeout = setTimeout(() => {
      saveButtonFlashTimeout = null;
      if (!root.visible) return;
      updateSaveButtonVisual();
    }, remainingMs + 16);
  }

  function updateSaveButtonVisual() {
    const nowMs = performance.now();
    if (saveButtonErrorState) {
      saveBtn.setVariant?.("error");
      return;
    }
    if (nowMs < saveButtonSavedFlashUntilMs) {
      saveBtn.setVariant?.("saved");
      return;
    }
    if (bufferUnlockIds.size > 0) {
      saveBtn.setVariant?.("pending");
      return;
    }
    saveBtn.setVariant?.("idle");
  }

  function clearSaveButtonError() {
    if (!saveButtonErrorState) return;
    saveButtonErrorState = false;
    updateSaveButtonVisual();
  }

  function nowMs() {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
      return performance.now();
    }
    return Date.now();
  }

  function pruneInvalidNodeFlashes() {
    const now = nowMs();
    for (const [nodeId, untilMs] of invalidNodeFlashUntilById.entries()) {
      if (!Number.isFinite(untilMs) || untilMs <= now) {
        invalidNodeFlashUntilById.delete(nodeId);
      }
    }
  }

  function isNodeFlashingInvalid(nodeId) {
    pruneInvalidNodeFlashes();
    const untilMs = invalidNodeFlashUntilById.get(nodeId);
    return Number.isFinite(untilMs) && untilMs > nowMs();
  }

  function flashInvalidNode(nodeId, message) {
    if (typeof nodeId === "string" && nodeId.length > 0) {
      invalidNodeFlashUntilById.set(nodeId, nowMs() + INVALID_NODE_FLASH_MS);
    }
    if (typeof message === "string" && message.length > 0) {
      errorText.text = message;
    }
    renderTree();
  }

  function getState() {
    return runner?.getCursorState?.() ?? runner?.getState?.() ?? null;
  }

  function commitActivePreviewIfNeeded() {
    const preview = runner?.getPreviewStatus?.();
    if (!preview?.active) return { ok: true, committed: false };
    if (preview.isForecastPreview) {
      const res = runner?.commitPreviewToLive?.();
      return res?.ok === false ? res : { ok: true, committed: true };
    }
    const previewSec = Number.isFinite(preview.previewSec)
      ? Math.floor(preview.previewSec)
      : null;
    if (previewSec == null) {
      return { ok: false, reason: "badPreviewSec" };
    }
    const res = runner?.commitCursorSecond?.(previewSec);
    return res?.ok === false ? res : { ok: true, committed: true };
  }

  function getLeaderPawn(state) {
    const pawns = Array.isArray(state?.pawns) ? state.pawns : [];
    return (
      pawns.find(
        (pawn) => pawn && pawn.id === activeLeaderPawnId && pawn.role === "leader"
      ) || null
    );
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

  function blendColor(baseColor, tintColor, strength = 0.18) {
    const mix = clamp(strength, 0, 1);
    const inv = 1 - mix;
    const br = (baseColor >> 16) & 0xff;
    const bg = (baseColor >> 8) & 0xff;
    const bb = baseColor & 0xff;
    const tr = (tintColor >> 16) & 0xff;
    const tg = (tintColor >> 8) & 0xff;
    const tb = tintColor & 0xff;
    const nr = Math.round(br * inv + tr * mix);
    const ng = Math.round(bg * inv + tg * mix);
    const nb = Math.round(bb * inv + tb * mix);
    return (nr << 16) | (ng << 8) | nb;
  }

  function getNodeTagTint(nodeDef) {
    const tags = Array.isArray(nodeDef?.tags) ? nodeDef.tags : [];
    let totalR = 0;
    let totalG = 0;
    let totalB = 0;
    let count = 0;
    for (const tag of tags) {
      const tint = NODE_TAG_TINT_BY_TAG[tag];
      if (!Number.isFinite(tint)) continue;
      totalR += (tint >> 16) & 0xff;
      totalG += (tint >> 8) & 0xff;
      totalB += tint & 0xff;
      count += 1;
    }
    if (!count) return null;
    const avgR = Math.round(totalR / count);
    const avgG = Math.round(totalG / count);
    const avgB = Math.round(totalB / count);
    return (avgR << 16) | (avgG << 8) | avgB;
  }

  function getNodeFillColor(nodeDef, status) {
    const baseColor =
      status === "unlocked"
        ? 0x5dbb63
        : status === "pending"
          ? 0x4fa3ff
          : status === "unlockable"
            ? 0x736427
            : 0x3b4255;
    const tint = getNodeTagTint(nodeDef);
    if (!Number.isFinite(tint)) return baseColor;
    const strength = status === "locked" ? 0.22 : 0.16;
    return blendColor(baseColor, tint, strength);
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

  function isPointInsideViewport(stageX, stageY) {
    const local = viewport.toLocal({ x: stageX, y: stageY });
    return (
      local.x >= 0 &&
      local.y >= 0 &&
      local.x <= VIEWPORT_WIDTH &&
      local.y <= VIEWPORT_HEIGHT
    );
  }

  function resetPinchState() {
    pinch.active = false;
    pinch.startScale = camera.scale;
    pinch.startDistance = 0;
    pinch.anchorWorldX = 0;
    pinch.anchorWorldY = 0;
    if (pinch.moved) {
      pan.lastMoved = true;
    }
    pinch.moved = false;
  }

  function primePinchFromTouches(touchA, touchB) {
    const stageA = toStageCoordsFromClient(touchA?.clientX, touchA?.clientY);
    const stageB = toStageCoordsFromClient(touchB?.clientX, touchB?.clientY);
    if (!stageA || !stageB) return false;

    const centerX = (stageA.x + stageB.x) * 0.5;
    const centerY = (stageA.y + stageB.y) * 0.5;
    if (!isPointInsideViewport(centerX, centerY)) return false;

    const distance = Math.hypot(stageA.x - stageB.x, stageA.y - stageB.y);
    if (!Number.isFinite(distance) || distance < 8) return false;

    const localCenter = viewport.toLocal({ x: centerX, y: centerY });
    pinch.active = true;
    pinch.startScale = camera.scale;
    pinch.startDistance = distance;
    pinch.anchorWorldX = (localCenter.x - camera.x) / camera.scale;
    pinch.anchorWorldY = (localCenter.y - camera.y) / camera.scale;
    pinch.moved = false;
    pan.lastMoved = true;
    return true;
  }

  function updatePinchFromTouches(touchA, touchB) {
    if (!pinch.active) return;
    const stageA = toStageCoordsFromClient(touchA?.clientX, touchA?.clientY);
    const stageB = toStageCoordsFromClient(touchB?.clientX, touchB?.clientY);
    if (!stageA || !stageB) return;

    const centerX = (stageA.x + stageB.x) * 0.5;
    const centerY = (stageA.y + stageB.y) * 0.5;
    if (!isPointInsideViewport(centerX, centerY)) return;

    const distance = Math.hypot(stageA.x - stageB.x, stageA.y - stageB.y);
    if (!Number.isFinite(distance) || distance < 4) return;

    const factor = distance / Math.max(1, pinch.startDistance);
    const nextScale = clamp(pinch.startScale * factor, MIN_ZOOM, MAX_ZOOM);
    const localCenter = viewport.toLocal({ x: centerX, y: centerY });
    const nextX = localCenter.x - pinch.anchorWorldX * nextScale;
    const nextY = localCenter.y - pinch.anchorWorldY * nextScale;
    if (
      Math.abs(nextScale - camera.scale) > 0.0001 ||
      Math.abs(nextX - camera.x) > 0.5 ||
      Math.abs(nextY - camera.y) > 0.5
    ) {
      pinch.moved = true;
    }
    setCamera(nextScale, nextX, nextY);
  }

  function onTouchStart(ev) {
    if (!root.visible) return;
    const touches = ev?.touches;
    if (!touches || touches.length < 2) return;
    if (pan.active) endPan();
    if (!pinch.active && primePinchFromTouches(touches[0], touches[1])) {
      ev.preventDefault();
    }
  }

  function onTouchMove(ev) {
    if (!root.visible) return;
    const touches = ev?.touches;
    if (!touches) return;
    if (touches.length < 2) {
      if (pinch.active) resetPinchState();
      return;
    }
    if (!pinch.active) {
      if (pan.active) endPan();
      if (!primePinchFromTouches(touches[0], touches[1])) return;
    }
    updatePinchFromTouches(touches[0], touches[1]);
    ev.preventDefault();
  }

  function onTouchEnd(ev) {
    if (!pinch.active) return;
    const touches = ev?.touches;
    if (touches && touches.length >= 2) {
      if (!primePinchFromTouches(touches[0], touches[1])) {
        resetPinchState();
      }
      if (ev?.cancelable) ev.preventDefault();
      return;
    }
    resetPinchState();
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

  function fitCameraToNodeIds(positionsByNodeId, nodeIds) {
    const positions = positionsByNodeId || {};
    const allIds = sortedStrings(Object.keys(positions));
    if (!allIds.length) {
      setCamera(1, 0, 0);
      return;
    }
    let ids = allIds;
    if (Array.isArray(nodeIds)) {
      const filtered = sortedStrings(
        nodeIds.filter(
          (nodeId) =>
            typeof nodeId === "string" &&
            nodeId.length > 0 &&
            Object.prototype.hasOwnProperty.call(positions, nodeId)
        )
      );
      if (filtered.length > 0) ids = filtered;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const treeDef = getActiveTreeDef();
    for (const nodeId of ids) {
      const pos = positions[nodeId];
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

  function resolveInitialCameraNodeIds({ state, layout, treeDef }) {
    const positions = layout?.positionsByNodeId || {};
    const allNodeIds = sortedStrings(Object.keys(positions));
    if (!allNodeIds.length) return [];

    const unlockedInTree = [];
    const unlocked = getUnlockedSkillSet(state, activeLeaderPawnId);
    for (const nodeId of unlocked.values()) {
      if (Object.prototype.hasOwnProperty.call(positions, nodeId)) {
        unlockedInTree.push(nodeId);
      }
    }
    const unlockedIds = sortedStrings(unlockedInTree);
    if (unlockedIds.length > 0) {
      const unlockedSet = new Set(unlockedIds);
      const targetNodeIds = new Set(unlockedIds);
      for (const edge of layout?.edges || []) {
        const a = edge?.a;
        const b = edge?.b;
        if (
          typeof a !== "string" ||
          typeof b !== "string" ||
          !Object.prototype.hasOwnProperty.call(positions, a) ||
          !Object.prototype.hasOwnProperty.call(positions, b)
        ) {
          continue;
        }
        if (unlockedSet.has(a)) targetNodeIds.add(b);
        if (unlockedSet.has(b)) targetNodeIds.add(a);
      }
      return sortedStrings(Array.from(targetNodeIds.values()));
    }

    const startNodeId = treeDef?.startNodeId;
    if (
      typeof startNodeId === "string" &&
      Object.prototype.hasOwnProperty.call(positions, startNodeId)
    ) {
      return [startNodeId];
    }

    return allNodeIds;
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
    const unlocked = getUnlockedSkillSet(state, activeLeaderPawnId);
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

    const unlockedSet = getUnlockedSkillSet(state, activeLeaderPawnId);
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

  function getProjectedUnlockContext(state, leaderPawn) {
    const unlocked = getUnlockedSkillSet(state, activeLeaderPawnId);
    for (const nodeId of bufferUnlockIds.values()) {
      unlocked.add(nodeId);
    }
    const pointsNow = Number.isFinite(leaderPawn?.skillPoints)
      ? Math.max(0, floorInt(leaderPawn.skillPoints))
      : 0;
    const pointsAfterBuffer = Math.max(0, pointsNow - getBufferedCost());
    return { unlocked, points: pointsAfterBuffer };
  }

  function getNodeClickFailureMessage(nodeId, reason) {
    if (reason === "insufficientSkillPoints") {
      return `Not enough skill points for "${nodeId}".`;
    }
    if (reason === "requirementsNotMet") {
      return `Requirements not met for "${nodeId}".`;
    }
    if (reason === "adjacencyLocked") {
      return `No valid unlock path to "${nodeId}" from your current tree.`;
    }
    if (reason === "alreadyUnlocked") {
      return `"${nodeId}" is already unlocked.`;
    }
    return `Cannot queue "${nodeId}" right now.`;
  }

  function resolveQueuedCommitOrder(state, leaderPawn, queuedNodeIds, opts = {}) {
    const allowFallback = opts.allowFallback !== false;
    const queuedSet = queuedNodeIds instanceof Set ? queuedNodeIds : new Set(queuedNodeIds || []);
    if (!queuedSet.size) return { order: [], valid: true };
    const unlocked = getUnlockedSkillSet(state, activeLeaderPawnId);
    let pointsRemaining = Number.isFinite(leaderPawn?.skillPoints)
      ? Math.max(0, floorInt(leaderPawn.skillPoints))
      : 0;

    const grouped = new Map();
    for (const nodeId of queuedSet.values()) {
      const node = getSkillNodeDef(activeDefs, nodeId);
      if (!node?.treeId) continue;
      if (!grouped.has(node.treeId)) grouped.set(node.treeId, []);
      grouped.get(node.treeId).push(nodeId);
    }
    const ordered = [];
    let valid = true;
    const treeIds = sortedStrings(Array.from(grouped.keys()));
    for (const treeId of treeIds) {
      const remaining = new Set(grouped.get(treeId) || []);
      while (remaining.size > 0) {
        const pendingIds = sortedStrings(Array.from(remaining.values()));
        const unlockable = [];
        for (const nodeId of pendingIds) {
          const evalRes = evaluateSkillNodeUnlock(state, activeLeaderPawnId, nodeId, {
            unlockedSet: unlocked,
            skillPoints: pointsRemaining,
          });
          if (!evalRes?.ok) continue;
          unlockable.push({
            nodeId,
            cost: Number.isFinite(evalRes.cost) ? Math.max(0, floorInt(evalRes.cost)) : 0,
          });
        }

        if (!unlockable.length) {
          valid = false;
          if (allowFallback) {
            const fallback = getDeterministicSkillCommitOrder(
              treeId,
              pendingIds,
              activeDefs
            );
            for (const nodeId of fallback) ordered.push(nodeId);
          }
          break;
        }

        const preferred = getDeterministicSkillCommitOrder(
          treeId,
          unlockable.map((entry) => entry.nodeId),
          activeDefs
        );
        const pickedId = preferred[0] || unlockable[0].nodeId;
        const picked =
          unlockable.find((entry) => entry.nodeId === pickedId) || unlockable[0];
        ordered.push(picked.nodeId);
        unlocked.add(picked.nodeId);
        remaining.delete(picked.nodeId);
        pointsRemaining = Math.max(0, pointsRemaining - picked.cost);
      }
    }
    return { order: ordered, valid };
  }

  function normalizeBufferedUnlocks(state, leaderPawn) {
    const resolved = resolveQueuedCommitOrder(state, leaderPawn, bufferUnlockIds, {
      allowFallback: false,
    });
    const normalizedIds = new Set(resolved.order);
    if (normalizedIds.size === bufferUnlockIds.size) {
      let identical = true;
      for (const nodeId of bufferUnlockIds.values()) {
        if (!normalizedIds.has(nodeId)) {
          identical = false;
          break;
        }
      }
      if (identical) return resolved;
    }
    bufferUnlockIds = normalizedIds;
    return resolved;
  }

  function buildAdjacencyByNodeId(edges) {
    const adjacencyByNodeId = new Map();
    for (const edge of edges || []) {
      const a = edge?.a;
      const b = edge?.b;
      if (typeof a !== "string" || typeof b !== "string") continue;
      if (!adjacencyByNodeId.has(a)) adjacencyByNodeId.set(a, new Set());
      if (!adjacencyByNodeId.has(b)) adjacencyByNodeId.set(b, new Set());
      adjacencyByNodeId.get(a).add(b);
      adjacencyByNodeId.get(b).add(a);
    }
    return adjacencyByNodeId;
  }

  function getDeterministicAdjacentNodeIds(treeId, adjacencyByNodeId, nodeId) {
    return getDeterministicSkillCommitOrder(
      treeId,
      Array.from(adjacencyByNodeId.get(nodeId) || []),
      activeDefs
    );
  }

  function pickProjectedSourceNodeId(targetNodeId, targetNode, adjacencyByNodeId, unlockedSet) {
    if (!targetNode?.treeId || !(unlockedSet instanceof Set)) return null;
    const orderedNeighbors = getDeterministicAdjacentNodeIds(
      targetNode.treeId,
      adjacencyByNodeId,
      targetNodeId
    );
    for (const neighborId of orderedNeighbors) {
      if (unlockedSet.has(neighborId)) return neighborId;
    }
    return null;
  }

  function collectPathEdgeKeys(nodeIds) {
    const edgeKeys = new Set();
    if (!Array.isArray(nodeIds) || nodeIds.length < 2) return edgeKeys;
    for (let i = 1; i < nodeIds.length; i += 1) {
      const prevNodeId = nodeIds[i - 1];
      const nextNodeId = nodeIds[i];
      if (typeof prevNodeId !== "string" || typeof nextNodeId !== "string") continue;
      edgeKeys.add(makeEdgeKey(prevNodeId, nextNodeId));
    }
    return edgeKeys;
  }

  function collectNextAvailableEdgeKeys(edges, nodeStatusById, unlockedSet) {
    const edgeKeys = new Set();
    if (!(nodeStatusById instanceof Map) || !(unlockedSet instanceof Set)) {
      return edgeKeys;
    }
    for (const edge of edges || []) {
      const edgeKey = makeEdgeKey(edge.a, edge.b);
      const endAProjectedUnlocked = unlockedSet.has(edge.a);
      const endBProjectedUnlocked = unlockedSet.has(edge.b);
      const endAUnlockable = nodeStatusById.get(edge.a) === "unlockable";
      const endBUnlockable = nodeStatusById.get(edge.b) === "unlockable";
      if (
        (endAProjectedUnlocked && endBUnlockable) ||
        (endBProjectedUnlocked && endAUnlockable)
      ) {
        edgeKeys.add(edgeKey);
      }
    }
    return edgeKeys;
  }

  function findQueuedPathToNode(state, leaderPawn, layout, targetNodeId) {
    const targetNode = getSkillNodeDef(activeDefs, targetNodeId);
    if (!targetNode?.treeId) {
      return { ok: false, reason: "unknownNode" };
    }

    const adjacencyByNodeId = buildAdjacencyByNodeId(layout?.edges || []);
    const projected = getProjectedUnlockContext(state, leaderPawn);
    const directEval = evaluateSkillNodeUnlock(state, activeLeaderPawnId, targetNodeId, {
      unlockedSet: projected.unlocked,
      skillPoints: projected.points,
    });
    if (directEval?.ok) {
      const sourceNodeId = pickProjectedSourceNodeId(
        targetNodeId,
        targetNode,
        adjacencyByNodeId,
        projected.unlocked
      );
      return {
        ok: true,
        nodeIds: [targetNodeId],
        pathNodeIds: sourceNodeId ? [sourceNodeId, targetNodeId] : [targetNodeId],
      };
    }

    const sourceIds = sortedStrings(
      Array.from(projected.unlocked.values()).filter((nodeId) => {
        const node = getSkillNodeDef(activeDefs, nodeId);
        return node?.treeId === targetNode.treeId;
      })
    );
    if (!sourceIds.length) {
      return { ok: false, reason: directEval?.reason || "adjacencyLocked" };
    }

    const bestDistanceByNodeId = new Map();
    const queue = sourceIds.map((nodeId) => [nodeId]);
    for (const nodeId of sourceIds) {
      bestDistanceByNodeId.set(nodeId, 0);
    }
    const candidatePaths = [];
    let shortestPathLen = Number.POSITIVE_INFINITY;

    while (queue.length > 0) {
      const path = queue.shift();
      const currentNodeId = path[path.length - 1];
      const distance = path.length - 1;
      if (distance > shortestPathLen) continue;
      if (currentNodeId === targetNodeId) {
        shortestPathLen = distance;
        candidatePaths.push(path);
        continue;
      }

      const neighbors = getDeterministicAdjacentNodeIds(
        targetNode.treeId,
        adjacencyByNodeId,
        currentNodeId
      );
      for (const neighborId of neighbors) {
        if (projected.unlocked.has(neighborId) && neighborId !== targetNodeId) continue;
        if (path.includes(neighborId)) continue;
        const nextDistance = distance + 1;
        const bestDistance = bestDistanceByNodeId.get(neighborId);
        if (Number.isFinite(bestDistance) && bestDistance < nextDistance) continue;
        bestDistanceByNodeId.set(neighborId, nextDistance);
        queue.push(path.concat(neighborId));
      }
    }

    for (const path of candidatePaths) {
      const queuedPathNodeIds = path.filter((nodeId) => !projected.unlocked.has(nodeId));
      if (!queuedPathNodeIds.length) continue;
      const simulatedUnlocked = new Set(projected.unlocked);
      let simulatedPoints = projected.points;
      let valid = true;
      for (const nodeId of queuedPathNodeIds) {
        const evalRes = evaluateSkillNodeUnlock(state, activeLeaderPawnId, nodeId, {
          unlockedSet: simulatedUnlocked,
          skillPoints: simulatedPoints,
        });
        if (!evalRes?.ok) {
          valid = false;
          break;
        }
        simulatedUnlocked.add(nodeId);
        simulatedPoints = Math.max(
          0,
          simulatedPoints -
            (Number.isFinite(evalRes.cost) ? Math.max(0, floorInt(evalRes.cost)) : 0)
        );
      }
      if (valid) {
        return { ok: true, nodeIds: queuedPathNodeIds, pathNodeIds: path.slice() };
      }
    }

    return { ok: false, reason: directEval?.reason || "adjacencyLocked" };
  }

  function handleNodeTap(state, leaderPawn, layout, nodeId) {
    const baseUnlocked = getUnlockedSkillSet(state, activeLeaderPawnId);
    if (baseUnlocked.has(nodeId)) {
      errorText.text = "";
      clearSaveButtonError();
      return;
    }

    normalizeBufferedUnlocks(state, leaderPawn);

    if (bufferUnlockIds.has(nodeId)) {
      bufferUnlockIds.delete(nodeId);
      normalizeBufferedUnlocks(state, leaderPawn);
      errorText.text = "";
      clearSaveButtonError();
      return;
    }

    const projected = getProjectedUnlockContext(state, leaderPawn);
    const directEval = evaluateSkillNodeUnlock(state, activeLeaderPawnId, nodeId, {
      unlockedSet: projected.unlocked,
      skillPoints: projected.points,
    });
    if (directEval?.ok) {
      bufferUnlockIds.add(nodeId);
      errorText.text = "";
      clearSaveButtonError();
      return;
    }

    const queuedPath = findQueuedPathToNode(state, leaderPawn, layout, nodeId);
    if (queuedPath?.ok) {
      for (const queuedNodeId of queuedPath.nodeIds || []) {
        bufferUnlockIds.add(queuedNodeId);
      }
      normalizeBufferedUnlocks(state, leaderPawn);
      errorText.text = "";
      clearSaveButtonError();
      return;
    }

    flashInvalidNode(nodeId, getNodeClickFailureMessage(nodeId, queuedPath?.reason || directEval?.reason));
  }

  function getNodeVisualState(state, leaderPawn, nodeId) {
    const baseUnlocked = getUnlockedSkillSet(state, activeLeaderPawnId);
    if (baseUnlocked.has(nodeId)) return "unlocked";
    if (bufferUnlockIds.has(nodeId)) return "pending";

    const projected = getProjectedUnlockContext(state, leaderPawn);
    const evalRes = evaluateSkillNodeUnlock(state, activeLeaderPawnId, nodeId, {
      unlockedSet: projected.unlocked,
      skillPoints: projected.points,
    });
    return evalRes?.ok ? "unlockable" : "locked";
  }

  function renderTree() {
    const state = getState();
    const leaderPawn = getLeaderPawn(state);
    treeWorld.removeChildren();
    if (!state || !leaderPawn || !activeTreeId) {
      updateSaveButtonVisual();
      return;
    }

    const treeDef = getActiveTreeDef();
    const layout = getSkillTreeLayout(
      activeTreeId,
      {
        x: TREE_LAYOUT_BOUNDS.x,
        y: TREE_LAYOUT_BOUNDS.y,
        width: TREE_LAYOUT_BOUNDS.width,
        height: TREE_LAYOUT_BOUNDS.height,
        columnSpacing: TREE_LAYOUT_BOUNDS.columnSpacing,
        rowSpacing: TREE_LAYOUT_BOUNDS.rowSpacing,
        leftPad: TREE_LAYOUT_BOUNDS.leftPad,
      },
      activeDefs
    );
    const positions = layout.positionsByNodeId || {};
    const orderedNodes = sortedStrings(Object.keys(positions));
    const nodeStatusById = new Map();
    for (const nodeId of orderedNodes) {
      nodeStatusById.set(nodeId, getNodeVisualState(state, leaderPawn, nodeId));
    }

    const unlockedProjected = getBufferedUnlockedSet(state);
    const hoverPreviewPath =
      typeof hoverNodeId === "string" && nodeStatusById.has(hoverNodeId)
        ? findQueuedPathToNode(state, leaderPawn, layout, hoverNodeId)
        : null;
    const hoverPreviewEdgeKeys = hoverPreviewPath?.ok
      ? collectPathEdgeKeys(hoverPreviewPath.pathNodeIds)
      : new Set();
    const nextAvailableEdgeKeys = collectNextAvailableEdgeKeys(
      layout.edges || [],
      nodeStatusById,
      unlockedProjected
    );
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
      const previewEdge = hoverPreviewEdgeKeys.has(edgeKey);
      const nextAvailableEdge = nextAvailableEdgeKeys.has(edgeKey);

      if (
        edgeMode === EDGE_MODE_ALL &&
        camera.scale < 0.55 &&
        !previewEdge &&
        !nextAvailableEdge &&
        !(endAHot || endBHot)
      ) {
        continue;
      }

      const edgeQueued =
        (sa === "pending" && sb === "pending") ||
        (sa === "pending" && sb === "unlocked") ||
        (sa === "unlocked" && sb === "pending");
      const edgeLearned = sa === "unlocked" && sb === "unlocked";

      let color = EDGE_COLOR;
      let alpha = EDGE_ALPHA * 0.38;
      let width = 2;

      if (edgeMode === EDGE_MODE_FOCUS) {
        if (previewEdge) {
          color = EDGE_COLOR_PREVIEW;
          alpha = 0.98;
          width = 3.6;
        } else if (nextAvailableEdge) {
          color = EDGE_COLOR_NEXT_AVAILABLE;
          alpha = 0.72;
          width = 2.8;
        } else {
          alpha = hoverPreviewEdgeKeys.size > 0 ? 0.12 : EDGE_ALPHA * 0.24;
        }
      } else if (edgeMode === EDGE_MODE_PROGRESS) {
        if (nextAvailableEdge) {
          color = EDGE_COLOR_NEXT_AVAILABLE;
          alpha = 0.86;
          width = 2.8;
        } else if (endAHot && endBHot) {
          color = 0x84f5a4;
          alpha = 0.85;
          width = 2.6;
        } else if (endAHot || endBHot) {
          color = 0xe6c84f;
          alpha = 0.48;
          width = 2.2;
        } else {
          alpha = 0.16;
        }
      } else if (nextAvailableEdge) {
        alpha = 0.82;
        color = EDGE_COLOR_NEXT_AVAILABLE;
        width = 2.7;
      }

      if (
        edgeMode === EDGE_MODE_ALL &&
        camera.scale < 0.55 &&
        !previewEdge &&
        !nextAvailableEdge
      ) {
        alpha *= endAHot || endBHot ? 0.7 : 0.45;
      }

      if (edgeLearned) {
        color = EDGE_COLOR_LEARNED;
        alpha = Math.max(alpha, 0.88);
        width = Math.max(width, 2.8);
      }
      if (edgeQueued) {
        color = EDGE_COLOR_QUEUED;
        alpha = Math.max(alpha, 0.97);
        width = Math.max(width, 3.2);
      }
      if (nextAvailableEdge && !(edgeLearned || edgeQueued)) {
        color = EDGE_COLOR_NEXT_AVAILABLE;
        alpha = Math.max(alpha, 0.82);
        width = Math.max(width, 2.8);
      }
      if (previewEdge) {
        color = EDGE_COLOR_PREVIEW;
        alpha = 0.98;
        width = Math.max(width, 3.6);
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
      const isInvalidFlashing = isNodeFlashingInvalid(nodeId);

      const node = new PIXI.Container();
      node.x = pos.x;
      node.y = pos.y;
      node.eventMode = "static";
      node.cursor = "pointer";
      node.alpha = 1;

      const fillColor = isInvalidFlashing
        ? INVALID_NODE_FILL
        : getNodeFillColor(nodeDef, status);

      const circle = new PIXI.Graphics();
      circle
        .lineStyle(
          isHovered || isSelected ? 3 : 2,
          isInvalidFlashing ? 0xffc9c9 : isHovered ? 0xffffff : 0xcfe8ff,
          1
        )
        .beginFill(fillColor, 1)
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
        handleNodeTap(state, leaderPawn, layout, nodeId);
        updateInfoText(state);
        renderTree();
      });

      nodeLayer.addChild(node);
    }

    if (!cameraInitialized) {
      const initialNodeIds = resolveInitialCameraNodeIds({
        state,
        layout,
        treeDef,
      });
      fitCameraToNodeIds(positions, initialNodeIds);
      cameraInitialized = true;
    } else {
      applyCamera();
    }

    const skillPoints = Number.isFinite(leaderPawn.skillPoints)
      ? Math.max(0, floorInt(leaderPawn.skillPoints))
      : 0;
    const totalCost = getBufferedCost();
    const remaining = Math.max(0, skillPoints - totalCost);
    pointsText.text = `Skill Points: ${remaining}/${skillPoints}  |  Queued Cost: ${totalCost}`;
    updateInfoText(state);
    updateSaveButtonVisual();
  }

  function onPanMove(ev) {
    if (!pan.active || pinch.active) return;
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
    if (!root.visible || pinch.active) return;
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
  app?.view?.addEventListener?.("touchstart", onTouchStart, { passive: false });
  app?.view?.addEventListener?.("touchmove", onTouchMove, { passive: false });
  app?.view?.addEventListener?.("touchend", onTouchEnd, { passive: false });
  app?.view?.addEventListener?.("touchcancel", onTouchEnd, { passive: false });

  function resolveCommitOrder(state, leaderPawn) {
    return resolveQueuedCommitOrder(state, leaderPawn, bufferUnlockIds).order;
  }

  function commitQueuedUnlocks() {
    const previewCommitRes = commitActivePreviewIfNeeded();
    if (previewCommitRes?.ok === false) {
      errorText.text = `Failed to commit preview: ${previewCommitRes.reason || "unknown"}`;
      saveButtonErrorState = true;
      updateSaveButtonVisual();
      return {
        ok: false,
        reason: previewCommitRes.reason || "previewCommitFailed",
        unlocked: [],
      };
    }

    const state = getState();
    if (!state?.paused) {
      errorText.text = "Skill changes can only be saved while paused.";
      saveButtonErrorState = true;
      updateSaveButtonVisual();
      return { ok: false, reason: "notPaused", unlocked: [] };
    }
    const leaderPawn = getLeaderPawn(state);
    if (!leaderPawn) {
      errorText.text = "No active leader pawn.";
      saveButtonErrorState = true;
      updateSaveButtonVisual();
      return { ok: false, reason: "noLeaderPawn", unlocked: [] };
    }

    normalizeBufferedUnlocks(state, leaderPawn);
    const order = resolveCommitOrder(state, leaderPawn);
    const unlocked = [];
    for (const nodeId of order) {
      const res = runner?.dispatchAction?.(
        ActionKinds.UNLOCK_SKILL_NODE,
        { leaderPawnId: activeLeaderPawnId, pawnId: activeLeaderPawnId, nodeId },
        { apCost: 0 }
      );
      if (!res?.ok) {
        errorText.text = `Failed to unlock "${nodeId}": ${res?.reason || "unknown"}`;
        bufferUnlockIds.clear();
        saveButtonErrorState = true;
        saveButtonSavedFlashUntilMs = 0;
        renderTree();
        return { ok: false, reason: res?.reason || "unlockFailed", unlocked };
      }
      unlocked.push(nodeId);
    }
    bufferUnlockIds.clear();
    clearSaveButtonError();
    return { ok: true, unlocked };
  }

  function saveChanges() {
    const commit = commitQueuedUnlocks();
    if (!commit?.ok) return;
    saveButtonErrorState = false;
    saveButtonSavedFlashUntilMs = performance.now() + 700;
    scheduleSaveButtonRefreshAfterFlash();
    const count = commit.unlocked.length;
    errorText.text =
      count > 0
        ? `Saved ${count} queued ${count === 1 ? "skill" : "skills"}.`
        : "No queued skill changes to save.";
    renderTree();
  }

  function cancelQueuedChanges() {
    const count = bufferUnlockIds.size;
    bufferUnlockIds.clear();
    clearSaveButtonError();
    errorText.text =
      count > 0
        ? `Canceled ${count} queued ${count === 1 ? "skill" : "skills"}.`
        : "No queued skill changes to cancel.";
    renderTree();
  }

  function exitSkillTree() {

    const exitCb = onExit;
    const leaderPawnId = activeLeaderPawnId;
    close();
    exitCb?.({
      saved: false,
      leaderPawnId,
      pawnId: leaderPawnId,
    });
  }

  function openEditor() {
    if (typeof onOpenEditor !== "function") {
      errorText.text = "Editor opener not configured.";
      return;
    }
    if (!activeTreeId) {
      errorText.text = "No active skill tree.";
      return;
    }
    const res = onOpenEditor({
      treeId: activeTreeId,
      leaderPawnId: activeLeaderPawnId,
      pawnId: activeLeaderPawnId,
      defsInput: activeDefs,
    });
    if (!res?.ok) {
      errorText.text = `Failed to open editor: ${res?.reason || "unknown"}`;
      return;
    }
    const exitCb = onExit;
    const leaderPawnId = activeLeaderPawnId;
    const treeId = activeTreeId;
    close();
    exitCb?.({
      saved: false,
      leaderPawnId,
      pawnId: leaderPawnId,
      openEditor: true,
      treeId,
    });
  }

  function open({ leaderPawnId, pawnId, defs = null, onExit: onExitCb } = {}) {
    const state = getState();
    if (!state) return { ok: false, reason: "noState" };
    const resolvedLeaderPawnId =
      Number.isFinite(leaderPawnId)
        ? Math.floor(leaderPawnId)
        : Number.isFinite(pawnId)
          ? Math.floor(pawnId)
          : null;
    if (resolvedLeaderPawnId == null) {
      return { ok: false, reason: "badLeaderPawnId" };
    }
    const leader = (Array.isArray(state?.pawns) ? state.pawns : []).find(
      (pawn) => pawn && pawn.id === resolvedLeaderPawnId
    );
    if (!leader) return { ok: false, reason: "noPawn" };
    if (leader.role !== "leader") return { ok: false, reason: "notLeaderPawn" };

    const trees = getSkillTreeDefs(defs);
    const treeIds = sortedStrings(Object.keys(trees || {}));
    if (!treeIds.length) return { ok: false, reason: "noSkillTrees" };

    activeLeaderPawnId = resolvedLeaderPawnId;
    activeTreeId = treeIds[0];
    activeDefs = defs;
    bufferUnlockIds = new Set();
    clearSaveButtonFlashTimer();
    saveButtonSavedFlashUntilMs = 0;
    saveButtonErrorState = false;
    invalidNodeFlashUntilById = new Map();
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
    resetPinchState();
    treeWorld.removeChildren();
    activeLeaderPawnId = null;
    activeTreeId = null;
    activeDefs = null;
    bufferUnlockIds.clear();
    clearSaveButtonFlashTimer();
    saveButtonSavedFlashUntilMs = 0;
    saveButtonErrorState = false;
    invalidNodeFlashUntilById = new Map();
    selectedNodeId = null;
    hoverNodeId = null;
    cameraInitialized = false;
    setCamera(1, 0, 0);
    errorText.text = "";
    pointsText.text = "";
    zoomText.text = "";
    infoText.text = "";
    onExit = null;
    updateSaveButtonVisual();
  }

  function resize() {
    const width = Number.isFinite(app?.screen?.width)
      ? app.screen.width
      : VIEWPORT_DESIGN_WIDTH;
    const height = Number.isFinite(app?.screen?.height)
      ? app.screen.height
      : VIEWPORT_DESIGN_HEIGHT;
    bg.clear();
    bg.beginFill(0x0a1020, 1);
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
    viewportBg.beginFill(0x111827, 1);
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
    getScreenRect: () =>
      !root.visible
        ? null
        : {
            x: 0,
            y: 0,
            width: Number.isFinite(app?.screen?.width)
              ? app.screen.width
              : VIEWPORT_DESIGN_WIDTH,
            height: Number.isFinite(app?.screen?.height)
              ? app.screen.height
              : VIEWPORT_DESIGN_HEIGHT,
          },
  };
}
