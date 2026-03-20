// debug-overlay-pixi.js
// Debug UI overlay (Pixi).

import { ActionKinds } from "../model/actions.js";
import { envEventDefs } from "../defs/gamepieces/env-events-defs.js";
import { setupDefs } from "../defs/gamesettings/scenarios-defs.js";
import {
  VIEWPORT_DESIGN_HEIGHT,
  VIEWPORT_DESIGN_WIDTH,
  VIEW_LAYOUT,
  resolveAnchoredRect,
} from "./layout-pixi.js";
import { installSolidUiHitArea } from "./ui-helpers/solid-ui-hit-area.js";

const PANEL_WIDTH = 280;
const PANEL_MIN_HEIGHT = 540;
const TOP_VIEW_UPDATES_COUNT = 5;
const PERF_REFRESH_MS = 250;
const SLOT_META_REFRESH_MS = 1000;
const PARITY_REFRESH_MS = 500;
const DEBUG_TOGGLE_SIZE = 38;
const TOP_BUTTON_GAP = 6;
const TOP_BUTTON_WIDTH = DEBUG_TOGGLE_SIZE * 3;

function clampInt(value, fallback = 0) {
  const n = Math.floor(value);
  return Number.isFinite(n) ? n : fallback;
}

function setButtonEnabled(button, enabled) {
  if (!button) return;
  button.container.alpha = enabled ? 1 : 0.45;
  button.container.eventMode = enabled ? "static" : "none";
  button.container.cursor = enabled ? "pointer" : "default";
  button.bg.tint = 0xffffff;
}

export function createDebugOverlay({
  app,
  layout = null,
  layer,
  runner,
  onLoadScenario,
  onOpenSystemGraph,
  onToggleApGraph,
  onToggleAutoPauseOnPlayerAction,
  getAutoPauseOnPlayerActionEnabled,
  onToggleFullscreen,
  isFullscreenAvailable,
  getIsFullscreen,
  onClearTimeline,
  getPerfSnapshot,
  getProjectionParity,
  onToggleRawInspector,
  getRawInspectorEnabled,
  getHoverDiagnostics,
}) {
  const rootLayout =
    layout && typeof layout === "object" ? layout : VIEW_LAYOUT.debugOverlay;

  function getScreenSize() {
    return {
      width: Number.isFinite(app?.screen?.width)
        ? Math.max(1, Math.floor(app.screen.width))
        : VIEWPORT_DESIGN_WIDTH,
      height: Number.isFinite(app?.screen?.height)
        ? Math.max(1, Math.floor(app.screen.height))
        : VIEWPORT_DESIGN_HEIGHT,
    };
  }

  let solidHitArea = null;

  function applyRootLayout(root) {
    if (!root) return;
    const { width, height } = getScreenSize();
    const rect = resolveAnchoredRect({
      screenWidth: width,
      screenHeight: height,
      width: PANEL_WIDTH,
      height: 0,
      anchorX: rootLayout?.anchorX ?? "right",
      anchorY: rootLayout?.anchorY ?? "top",
      offsetX: Number(rootLayout?.offsetX ?? -24),
      offsetY: Number(rootLayout?.offsetY ?? 10),
    });
    root.x = Math.floor(rect.x);
    root.y = Math.floor(rect.y);
    solidHitArea?.refresh?.();
  }

  const root = new PIXI.Container();
  applyRootLayout(root);
  layer.addChild(root);
  solidHitArea = installSolidUiHitArea(root, () => {
    const bounds = root.getLocalBounds?.() ?? null;
    return {
      x: 0,
      y: 0,
      width: bounds?.width ?? 0,
      height: bounds?.height ?? 0,
    };
  });

  const apText = new PIXI.Text("AP: -- / --", {
    fontFamily: "Arial",
    fontSize: 14,
    fill: 0xffd700,
    fontWeight: "bold",
  });
  apText.x = 4;
  apText.y = 8;
  apText.eventMode = "none";
  root.addChild(apText);

  const dbgBtn = new PIXI.Container();
  dbgBtn.x = PANEL_WIDTH - TOP_BUTTON_WIDTH * 2 - TOP_BUTTON_GAP;
  dbgBtn.y = 2;
  dbgBtn.eventMode = "static";
  dbgBtn.cursor = "pointer";
  const dbgBtnBg = new PIXI.Graphics();
  dbgBtnBg.beginFill(0x444444);
  dbgBtnBg.drawRoundedRect(0, 0, TOP_BUTTON_WIDTH, DEBUG_TOGGLE_SIZE, 6);
  dbgBtnBg.endFill();
  dbgBtn.addChild(dbgBtnBg);
  root.addChild(dbgBtn);

  const dbgIcon = new PIXI.Text("D", { fontSize: 20, fill: 0xffffff });
  dbgIcon.anchor.set(0.5, 0.5);
  dbgIcon.x = Math.floor(TOP_BUTTON_WIDTH * 0.5);
  dbgIcon.y = Math.floor(DEBUG_TOGGLE_SIZE * 0.5);
  dbgIcon.eventMode = "none";
  dbgBtn.addChild(dbgIcon);

  const fullscreenBtn = new PIXI.Container();
  fullscreenBtn.x = PANEL_WIDTH - TOP_BUTTON_WIDTH;
  fullscreenBtn.y = 2;
  fullscreenBtn.eventMode = "static";
  fullscreenBtn.cursor = "pointer";
  const fullscreenBtnBg = new PIXI.Graphics();
  fullscreenBtnBg.beginFill(0x444444);
  fullscreenBtnBg.drawRoundedRect(0, 0, TOP_BUTTON_WIDTH, DEBUG_TOGGLE_SIZE, 6);
  fullscreenBtnBg.endFill();
  fullscreenBtn.addChild(fullscreenBtnBg);
  root.addChild(fullscreenBtn);

  const fullscreenIcon = new PIXI.Text("F", {
    fontSize: 16,
    fill: 0xffffff,
    fontWeight: "bold",
  });
  fullscreenIcon.anchor.set(0.5, 0.5);
  fullscreenIcon.x = Math.floor(TOP_BUTTON_WIDTH * 0.5);
  fullscreenIcon.y = Math.floor(DEBUG_TOGGLE_SIZE * 0.5);
  fullscreenIcon.eventMode = "none";
  fullscreenBtn.addChild(fullscreenIcon);
  fullscreenBtn.on("pointerdown", () => onToggleFullscreen?.());

  const panel = new PIXI.Container();
  panel.y = 42;
  panel.visible = false;
  root.addChild(panel);

  const panelBg = new PIXI.Graphics();
  panel.addChild(panelBg);

  function drawPanelBg(height) {
    panelBg.clear();
    panelBg.beginFill(0x1e1f23, 0.93);
    panelBg.lineStyle(1, 0x4b4e57, 0.9);
    panelBg.drawRoundedRect(0, 0, PANEL_WIDTH, Math.max(PANEL_MIN_HEIGHT, height), 10);
    panelBg.endFill();
  }

  const CONTENT_X = 12;
  const CONTENT_W = PANEL_WIDTH - CONTENT_X * 2;
  const BUTTON_H = 24;
  const SECTION_GAP = 10;
  let cursorY = 10;

  function addSectionTitle(text) {
    const header = new PIXI.Text(text, {
      fontSize: 11,
      fill: 0xe4e9f5,
      fontWeight: "bold",
    });
    header.x = CONTENT_X;
    header.y = cursorY;
    panel.addChild(header);
    cursorY += header.height + 6;
    return header;
  }

  function createButton({
    x,
    y,
    width,
    height = BUTTON_H,
    label,
    fontSize = 11,
    align = "center",
  }) {
    const container = new PIXI.Container();
    container.x = x;
    container.y = y;
    container.eventMode = "static";
    container.cursor = "pointer";

    const bg = new PIXI.Graphics();
    bg.beginFill(0x575a63);
    bg.drawRoundedRect(0, 0, width, height, 4);
    bg.endFill();
    container.addChild(bg);

    const text = new PIXI.Text(label, {
      fontSize,
      fill: 0xffffff,
      fontWeight: "bold",
    });
    if (align === "left") {
      text.x = 8;
    } else {
      text.x = Math.round((width - text.width) * 0.5);
    }
    text.y = Math.round((height - text.height) * 0.5);
    container.addChild(text);

    panel.addChild(container);
    return { container, bg, text, width, height };
  }

  let cheatsEnabled = false;
  let lastPerfReadMs = 0;
  let lastSlotMetaReadMs = 0;
  let lastParityReadMs = 0;
  const cachedSlotMetaByIndex = new Map();

  const cheatBtn = createButton({
    x: CONTENT_X,
    y: cursorY,
    width: CONTENT_W,
    height: 28,
    label: "Toggle Cheat AP",
    fontSize: 12,
  });
  cursorY += 36;

  cheatBtn.container.on("pointerdown", () => {
    cheatsEnabled = !cheatsEnabled;
    const payload = cheatsEnabled
      ? { enabled: true, cap: 9999, points: 9999 }
      : { enabled: false };
    runner.dispatchAction(ActionKinds.DEBUG_SET_CAP, payload);
    cheatBtn.bg.tint = cheatsEnabled ? 0x2f9b4c : 0xffffff;
  });

  addSectionTitle("Scenario");
  const scenarioIds = Object.keys(setupDefs || {}).sort();
  let scenarioIndex = Math.max(
    0,
    scenarioIds.indexOf(runner.getSetupId?.() ?? scenarioIds[0] ?? "")
  );

  const scenarioName = new PIXI.Text("No scenarios", {
    fontSize: 10,
    fill: 0xc7d2ee,
    wordWrap: true,
    wordWrapWidth: CONTENT_W,
  });
  scenarioName.x = CONTENT_X;
  scenarioName.y = cursorY;
  panel.addChild(scenarioName);
  cursorY += 26;

  const scenarioPrevBtn = createButton({
    x: CONTENT_X,
    y: cursorY,
    width: 26,
    label: "<",
    fontSize: 13,
  });
  const scenarioNextBtn = createButton({
    x: CONTENT_X + 32,
    y: cursorY,
    width: 26,
    label: ">",
    fontSize: 13,
  });
  const loadScenarioBtn = createButton({
    x: CONTENT_X + 64,
    y: cursorY,
    width: CONTENT_W - 64,
    label: "Load Selected Scenario",
    fontSize: 10,
  });
  cursorY += 30;

  const scenarioStatus = new PIXI.Text("", {
    fontSize: 9,
    fill: 0xb8c2dd,
    wordWrap: true,
    wordWrapWidth: CONTENT_W,
  });
  scenarioStatus.x = CONTENT_X;
  scenarioStatus.y = cursorY;
  panel.addChild(scenarioStatus);
  cursorY += 18 + SECTION_GAP;

  function setScenarioIndex(nextIndex) {
    if (!scenarioIds.length) {
      scenarioIndex = 0;
      return;
    }
    scenarioIndex = Math.max(0, Math.min(scenarioIds.length - 1, nextIndex));
  }

  scenarioPrevBtn.container.on("pointerdown", () => {
    setScenarioIndex(scenarioIndex - 1);
  });
  scenarioNextBtn.container.on("pointerdown", () => {
    setScenarioIndex(scenarioIndex + 1);
  });
  loadScenarioBtn.container.on("pointerdown", () => {
    const selectedSetupId = scenarioIds[scenarioIndex] ?? null;
    if (!selectedSetupId) return;
    const res =
      typeof onLoadScenario === "function"
        ? onLoadScenario(selectedSetupId)
        : runner.resetToSetup?.(selectedSetupId);
    if (res?.ok) {
      scenarioStatus.text = `Loaded: ${selectedSetupId}`;
      scenarioStatus.style.fill = 0x7ddc93;
      setScenarioIndex(scenarioIds.indexOf(selectedSetupId));
      lastSlotMetaReadMs = 0;
      cachedSlotMetaByIndex.clear();
    } else {
      const reason = typeof res?.reason === "string" ? res.reason : "failed";
      scenarioStatus.text = `Load failed: ${reason}`;
      scenarioStatus.style.fill = 0xff7c7c;
    }
  });

  addSectionTitle("Saves");
  const slotRows = [];
  const slotCount = runner.getSaveSlotCount?.() ?? 3;

  function buildSlotRow(slotIndex, y) {
    const row = new PIXI.Container();
    row.x = CONTENT_X;
    row.y = y;
    panel.addChild(row);

    const label = new PIXI.Text(`Slot ${slotIndex}: empty`, {
      fontSize: 10,
      fill: 0xffffff,
    });
    label.x = 0;
    label.y = 4;
    row.addChild(label);

    const saveBtn = createButton({
      x: CONTENT_X + CONTENT_W - 110,
      y,
      width: 52,
      height: 22,
      label: "Save",
      fontSize: 10,
    });
    const loadBtn = createButton({
      x: CONTENT_X + CONTENT_W - 54,
      y,
      width: 52,
      height: 22,
      label: "Load",
      fontSize: 10,
    });

    saveBtn.container.on("pointerdown", () => {
      runner.saveToSlot?.(slotIndex);
      cachedSlotMetaByIndex.set(
        slotIndex,
        runner.getSaveSlotMeta?.(slotIndex) ?? null
      );
    });
    loadBtn.container.on("pointerdown", () => {
      runner.loadFromSlot?.(slotIndex);
      setScenarioIndex(
        Math.max(0, scenarioIds.indexOf(runner.getSetupId?.() ?? scenarioIds[0] ?? ""))
      );
    });

    return { label, saveBtn, loadBtn, slotIndex };
  }

  for (let i = 1; i <= slotCount; i++) {
    const rowY = cursorY + (i - 1) * 26;
    slotRows.push(buildSlotRow(i, rowY));
  }
  cursorY += slotCount * 26 + SECTION_GAP;

  addSectionTitle("Queue Env Event");
  const eventIds = Object.keys(envEventDefs || {}).sort();
  let eventIndex = 0;

  const eventName = new PIXI.Text("", {
    fontSize: 10,
    fill: 0xc7d2ee,
    wordWrap: true,
    wordWrapWidth: CONTENT_W,
  });
  eventName.x = CONTENT_X;
  eventName.y = cursorY;
  panel.addChild(eventName);
  cursorY += 24;

  const prevEventBtn = createButton({
    x: CONTENT_X,
    y: cursorY,
    width: 26,
    label: "<",
    fontSize: 13,
  });
  const nextEventBtn = createButton({
    x: CONTENT_X + 32,
    y: cursorY,
    width: 26,
    label: ">",
    fontSize: 13,
  });
  const queueEventBtn = createButton({
    x: CONTENT_X + 64,
    y: cursorY,
    width: CONTENT_W - 64,
    label: "Queue Event",
    fontSize: 10,
  });
  cursorY += 30 + SECTION_GAP;

  function setEventIndex(nextIndex) {
    if (!eventIds.length) {
      eventIndex = 0;
      return;
    }
    eventIndex = Math.max(0, Math.min(eventIds.length - 1, nextIndex));
  }
  prevEventBtn.container.on("pointerdown", () => setEventIndex(eventIndex - 1));
  nextEventBtn.container.on("pointerdown", () => setEventIndex(eventIndex + 1));
  queueEventBtn.container.on("pointerdown", () => {
    const defId = eventIds[eventIndex] ?? null;
    if (!defId) return;
    runner.dispatchAction?.(ActionKinds.DEBUG_QUEUE_ENV_EVENT, { defId });
  });

  addSectionTitle("Tools");
  const autoPauseBtn = createButton({
    x: CONTENT_X,
    y: cursorY,
    width: CONTENT_W,
    label: "Autopause On Action: OFF",
  });
  cursorY += 28;
  const graphBtn = createButton({
    x: CONTENT_X,
    y: cursorY,
    width: CONTENT_W,
    label: "Toggle System Graph",
  });
  cursorY += 28;
  const apGraphBtn = createButton({
    x: CONTENT_X,
    y: cursorY,
    width: CONTENT_W,
    label: "Toggle AP Graph",
  });
  cursorY += 28;
  const clearTimelineBtn = createButton({
    x: CONTENT_X,
    y: cursorY,
    width: CONTENT_W,
    label: "Clear Timeline Future",
  });
  cursorY += 32;

  const rawInspectorBtn = createButton({
    x: CONTENT_X,
    y: cursorY,
    width: CONTENT_W,
    label: "Raw Inspector: OFF",
  });
  cursorY += 32;

  autoPauseBtn.container.on("pointerdown", () =>
    onToggleAutoPauseOnPlayerAction?.()
  );
  graphBtn.container.on("pointerdown", () => onOpenSystemGraph?.());
  apGraphBtn.container.on("pointerdown", () => onToggleApGraph?.());
  clearTimelineBtn.container.on("pointerdown", () => onClearTimeline?.());
  rawInspectorBtn.container.on("pointerdown", () => onToggleRawInspector?.());

  addSectionTitle("Performance");
  const perfMeta = new PIXI.Text("act --/--  plan --/--  scrub --", {
    fontSize: 9,
    fill: 0xb8c2dd,
    wordWrap: true,
    wordWrapWidth: CONTENT_W,
  });
  perfMeta.x = CONTENT_X;
  perfMeta.y = cursorY;
  panel.addChild(perfMeta);
  cursorY += 20;

  const perfRows = [];
  for (let i = 0; i < TOP_VIEW_UPDATES_COUNT; i++) {
    const row = new PIXI.Text("--", {
      fontSize: 9,
      fill: 0xc7d2ee,
      wordWrap: true,
      wordWrapWidth: CONTENT_W,
    });
    row.x = CONTENT_X;
    row.y = cursorY + i * 14;
    panel.addChild(row);
    perfRows.push(row);
  }
  cursorY += TOP_VIEW_UPDATES_COUNT * 14 + 4;

  const parityRow = new PIXI.Text("projection parity: --", {
    fontSize: 9,
    fill: 0xb8c2dd,
    wordWrap: true,
    wordWrapWidth: CONTENT_W,
  });
  parityRow.x = CONTENT_X;
  parityRow.y = cursorY;
  panel.addChild(parityRow);
  cursorY += 14;

  const commitErrorRow = new PIXI.Text("planner commit: ok", {
    fontSize: 9,
    fill: 0xb8c2dd,
    wordWrap: true,
    wordWrapWidth: CONTENT_W,
  });
  commitErrorRow.x = CONTENT_X;
  commitErrorRow.y = cursorY;
  panel.addChild(commitErrorRow);
  cursorY += 24;

  addSectionTitle("Hover Diagnostics");
  const hoverRows = [];
  for (let i = 0; i < 8; i++) {
    const row = new PIXI.Text("--", {
      fontSize: 9,
      fill: 0xc7d2ee,
      wordWrap: true,
      wordWrapWidth: CONTENT_W,
    });
    row.x = CONTENT_X;
    row.y = cursorY + i * 13;
    panel.addChild(row);
    hoverRows.push(row);
  }
  cursorY += hoverRows.length * 13 + SECTION_GAP;

  function formatAnchor(anchor) {
    if (!anchor) return "none";
    const x = Math.round(Number(anchor.x) || 0);
    const y = Math.round(Number(anchor.y) || 0);
    const space = anchor.coordinateSpace === "screen" ? "screen" : "parent";
    return `${space}@${x},${y}`;
  }

  function updateHoverRows() {
    const diagnostics =
      typeof getHoverDiagnostics === "function" ? getHoverDiagnostics() : null;
    const tooltip = diagnostics?.tooltip ?? null;
    const inventory = diagnostics?.inventory ?? null;
    const pawns = diagnostics?.pawns ?? null;
    const firstWindow = inventory?.visibleWindows?.[0] ?? null;
    const firstPawn = pawns?.hoveredPawns?.[0] ?? null;
    const rows = [
      `tooltip vis=${tooltip?.visible === true ? "1" : "0"} scale=${Number.isFinite(tooltip?.scale) ? tooltip.scale.toFixed(2) : "--"} layer=${Number.isFinite(tooltip?.layerScale) ? tooltip.layerScale.toFixed(2) : "--"}`,
      `tooltip pos=${Math.round(Number(tooltip?.x) || 0)},${Math.round(Number(tooltip?.y) || 0)} size=${Math.round(Number(tooltip?.width) || 0)}x${Math.round(Number(tooltip?.height) || 0)}`,
      `tooltip anchor=${formatAnchor(tooltip?.anchor)} title=${tooltip?.title || "--"}`,
      `inv win=${firstWindow ? String(firstWindow.ownerId) : "--"} hover=${firstWindow?.hovered === true ? "1" : "0"} pin=${firstWindow?.pinned === true ? "1" : "0"}`,
      `inv pos=${Math.round(Number(firstWindow?.x) || 0)},${Math.round(Number(firstWindow?.y) || 0)} uiScale=${Number.isFinite(firstWindow?.uiScale) ? firstWindow.uiScale.toFixed(2) : "--"}`,
      `inv anchor=${formatAnchor(firstWindow?.hoverAnchor)}`,
      `pawn=${firstPawn ? String(firstPawn.pawnId) : "--"} pos=${Math.round(Number(firstPawn?.x) || 0)},${Math.round(Number(firstPawn?.y) || 0)} attached=${Number.isFinite(firstPawn?.attachedScale) ? firstPawn.attachedScale.toFixed(2) : "--"} self=${Number.isFinite(firstPawn?.selfHoverScaleApplied) ? firstPawn.selfHoverScaleApplied.toFixed(2) : "--"}`,
      `pawn tip=${formatAnchor(firstPawn?.tooltipAnchor)} inv=${formatAnchor(firstPawn?.inventoryAnchor)}`,
    ];
    for (let i = 0; i < hoverRows.length; i++) {
      hoverRows[i].text = rows[i] ?? "";
    }
  }

  function refreshScenarioUi() {
    if (!scenarioIds.length) {
      scenarioName.text = "No setupDefs found";
      scenarioStatus.text = "";
      setButtonEnabled(scenarioPrevBtn, false);
      setButtonEnabled(scenarioNextBtn, false);
      setButtonEnabled(loadScenarioBtn, false);
      return;
    }
    const selectedSetupId = scenarioIds[scenarioIndex] ?? scenarioIds[0];
    const activeSetupId = runner.getSetupId?.() ?? null;
    const isActive = activeSetupId === selectedSetupId;
    scenarioName.text = isActive
      ? `${selectedSetupId} (active)`
      : selectedSetupId;
    scenarioName.style.fill = isActive ? 0x7ddc93 : 0xc7d2ee;
    setButtonEnabled(scenarioPrevBtn, scenarioIndex > 0);
    setButtonEnabled(scenarioNextBtn, scenarioIndex < scenarioIds.length - 1);
    setButtonEnabled(loadScenarioBtn, !isActive);
  }

  function updatePerfRows() {
    const now = performance.now();
    if (now - lastPerfReadMs < PERF_REFRESH_MS) return;
    lastPerfReadMs = now;

    const snapshot =
      typeof getPerfSnapshot === "function" ? getPerfSnapshot() : null;
    if (snapshot?.ok === false) {
      const reason = typeof snapshot.reason === "string" ? snapshot.reason : "unavailable";
      perfMeta.text = "act --/--  plan --/--  scrub --";
      perfRows[0].text = `perf ${reason}`;
      for (let i = 1; i < perfRows.length; i++) perfRows[i].text = "";
      return;
    }
    const runtime = snapshot?.runtime ?? null;
    const actionLast = Number.isFinite(runtime?.actionDispatchLastMs)
      ? runtime.actionDispatchLastMs.toFixed(1)
      : "--";
    const actionMax = Number.isFinite(runtime?.actionDispatchMaxMs)
      ? runtime.actionDispatchMaxMs.toFixed(1)
      : "--";
    const plannerLast = Number.isFinite(runtime?.plannerCommitLastMs)
      ? runtime.plannerCommitLastMs.toFixed(1)
      : "--";
    const plannerMax = Number.isFinite(runtime?.plannerCommitMaxMs)
      ? runtime.plannerCommitMaxMs.toFixed(1)
      : "--";
    const scrubLast = Number.isFinite(runtime?.scrubCommitLastMs)
      ? runtime.scrubCommitLastMs.toFixed(1)
      : "--";
    const timeline = snapshot?.timeline ?? null;
    const actionsCount = Number.isFinite(timeline?.actions)
      ? Math.floor(timeline.actions)
      : 0;
    const checkpointsCount = Number.isFinite(timeline?.checkpoints)
      ? Math.floor(timeline.checkpoints)
      : 0;
    const memoSize = Number.isFinite(timeline?.memoSize)
      ? Math.floor(timeline.memoSize)
      : 0;
    perfMeta.text =
      `act ${actionLast}/${actionMax}  ` +
      `plan ${plannerLast}/${plannerMax}  ` +
      `scrub ${scrubLast}  ` +
      `A ${actionsCount} CP ${checkpointsCount} M ${memoSize}`;

    const viewUpdates = snapshot?.runtime?.viewUpdates;
    if (!viewUpdates || typeof viewUpdates !== "object") {
      perfRows[0].text = "perf runtime unavailable";
      for (let i = 1; i < perfRows.length; i++) perfRows[i].text = "";
      return;
    }

    const top = Object.entries(viewUpdates)
      .filter((entry) => entry && entry[1] && Number.isFinite(entry[1].avgMs))
      .sort((a, b) => (b[1].avgMs ?? 0) - (a[1].avgMs ?? 0))
      .slice(0, TOP_VIEW_UPDATES_COUNT);

    if (!top.length) {
      perfRows[0].text = "no samples yet";
      for (let i = 1; i < perfRows.length; i++) perfRows[i].text = "";
      return;
    }

    for (let i = 0; i < perfRows.length; i++) {
      const item = top[i];
      if (!item) {
        perfRows[i].text = "";
        continue;
      }
      const id = item[0];
      const stat = item[1] || {};
      const avgMs = Number.isFinite(stat.avgMs) ? stat.avgMs.toFixed(2) : "0.00";
      const maxMs = Number.isFinite(stat.maxMs) ? stat.maxMs.toFixed(2) : "0.00";
      perfRows[i].text = `${i + 1}. ${id} ${avgMs}ms (${maxMs})`;
    }
  }

  function updateParityRow() {
    const now = performance.now();
    if (now - lastParityReadMs < PARITY_REFRESH_MS) return;
    lastParityReadMs = now;

    const parity =
      typeof getProjectionParity === "function" ? getProjectionParity() : null;
    if (!parity || parity.ok === false) {
      const reason =
        typeof parity?.reason === "string" ? parity.reason : "unavailable";
      parityRow.text = `projection parity: ${reason}`;
      parityRow.style.fill = 0xb8c2dd;
    } else if (parity.mismatch) {
      const sec = Number.isFinite(parity.sec) ? Math.floor(parity.sec) : 0;
      const detail = typeof parity.detail === "string" ? parity.detail : "mismatch";
      parityRow.text = `projection parity: MISMATCH @${sec}s (${detail})`;
      parityRow.style.fill = 0xff7777;
    } else {
      const sec = Number.isFinite(parity.sec) ? Math.floor(parity.sec) : 0;
      parityRow.text = `projection parity: ok @${sec}s`;
      parityRow.style.fill = 0x7ddc93;
    }

    const commitError = runner.getLastPlannerCommitError?.() ?? null;
    if (!commitError) {
      commitErrorRow.text = "planner commit: ok";
      commitErrorRow.style.fill = 0x7ddc93;
      return;
    }

    const reason =
      typeof commitError.reason === "string" ? commitError.reason : "failed";
    const tSec = Number.isFinite(commitError.tSec)
      ? Math.floor(commitError.tSec)
      : 0;
    commitErrorRow.text = `planner commit: ${reason} @${tSec}s`;
    commitErrorRow.style.fill = 0xff7777;
  }

  dbgBtn.on("pointerdown", () => {
    panel.visible = !panel.visible;
  });

  drawPanelBg(cursorY + 8);

  return {
    update: () => {
      applyRootLayout(root);
      const state = runner.getState();
      if (state) {
        const apCostsEnabled =
          state?.variantFlags?.actionPointCostsEnabled !== false;
        apText.visible = apCostsEnabled;
        const preview = runner.getActionPlanner?.()?.getApPreview?.() ?? null;
        const cur =
          preview && Number.isFinite(preview.remaining)
            ? Math.floor(preview.remaining)
            : clampInt(state.actionPoints, 0);
        const cap = clampInt(state.actionPointCap, 0);
        if (apCostsEnabled) {
          apText.text = `AP: ${cur}/${cap}`;
          apText.style.fill = cur < 20 ? 0xff5555 : 0xffd700;
        }
      }
      if (!panel.visible) return;

      refreshScenarioUi();

      const now = performance.now();
      if (now - lastSlotMetaReadMs >= SLOT_META_REFRESH_MS) {
        lastSlotMetaReadMs = now;
        for (const row of slotRows) {
          cachedSlotMetaByIndex.set(
            row.slotIndex,
            runner.getSaveSlotMeta?.(row.slotIndex) ?? null
          );
        }
      }

      for (const row of slotRows) {
        const meta = cachedSlotMetaByIndex.get(row.slotIndex) ?? null;
        if (meta) {
          const tSec = Number.isFinite(meta.tSec) ? meta.tSec : 0;
          const season = meta.seasonKey || "?";
          const year = Number.isFinite(meta.year) ? Math.floor(meta.year) : 1;
          row.label.text = `Slot ${row.slotIndex}: Y${year} T${tSec} ${season}`;
          setButtonEnabled(row.loadBtn, true);
        } else {
          row.label.text = `Slot ${row.slotIndex}: empty`;
          setButtonEnabled(row.loadBtn, false);
        }
      }

      if (!eventIds.length) {
        eventName.text = "No events";
        setButtonEnabled(prevEventBtn, false);
        setButtonEnabled(nextEventBtn, false);
        setButtonEnabled(queueEventBtn, false);
      } else {
        const defId = eventIds[eventIndex];
        const def = envEventDefs[defId];
        const label = def?.name || defId;
        eventName.text = label;
        setButtonEnabled(prevEventBtn, eventIndex > 0);
        setButtonEnabled(nextEventBtn, eventIndex < eventIds.length - 1);
        setButtonEnabled(queueEventBtn, true);
      }

      const fullscreenSupported =
        typeof isFullscreenAvailable === "function"
          ? isFullscreenAvailable()
          : typeof onToggleFullscreen === "function";
      fullscreenBtn.alpha = fullscreenSupported ? 1 : 0.45;
      fullscreenBtn.eventMode = fullscreenSupported ? "static" : "none";
      fullscreenBtn.cursor = fullscreenSupported ? "pointer" : "default";
      fullscreenBtnBg.tint = 0xffffff;
      if (!fullscreenSupported) {
        fullscreenIcon.text = "N/A";
        fullscreenIcon.style.fontSize = 10;
      } else {
        const isFullscreen =
          typeof getIsFullscreen === "function" ? !!getIsFullscreen() : false;
        fullscreenIcon.text = isFullscreen ? "X" : "F";
        fullscreenIcon.style.fontSize = 16;
      }
      fullscreenIcon.x = Math.floor(TOP_BUTTON_WIDTH * 0.5);
      fullscreenIcon.y = Math.floor(DEBUG_TOGGLE_SIZE * 0.5);

      updatePerfRows();
      updateParityRow();
      updateHoverRows();

      const autoPauseEnabled =
        typeof getAutoPauseOnPlayerActionEnabled === "function"
          ? getAutoPauseOnPlayerActionEnabled() === true
          : false;
      autoPauseBtn.text.text = `Autopause On Action: ${
        autoPauseEnabled ? "ON" : "OFF"
      }`;
      autoPauseBtn.text.x = Math.round((autoPauseBtn.width - autoPauseBtn.text.width) * 0.5);
      autoPauseBtn.bg.tint = autoPauseEnabled ? 0x2f9b4c : 0xffffff;

      const rawInspectorEnabled =
        typeof getRawInspectorEnabled === "function"
          ? getRawInspectorEnabled() === true
          : false;
      rawInspectorBtn.text.text = `Raw Inspector: ${
        rawInspectorEnabled ? "ON" : "OFF"
      }`;
      rawInspectorBtn.text.x = Math.round(
        (rawInspectorBtn.width - rawInspectorBtn.text.width) * 0.5
      );
      rawInspectorBtn.bg.tint = rawInspectorEnabled ? 0x2f9b4c : 0xffffff;
    },
    getScreenRect: () => {
      if (!root.visible) return null;
      const bounds = root.getBounds?.();
      if (!bounds) return null;
      return {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      };
    },
  };
}
