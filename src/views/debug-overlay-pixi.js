// debug-overlay-pixi.js
// Debug UI overlay (Pixi).

import { ActionKinds } from "../model/actions.js";
import { envEventDefs } from "../defs/gamepieces/env-events-defs.js";

const DESIGN_WIDTH = 1920;
const PANEL_WIDTH = 200;
const PANEL_HEIGHT = 392;
const TOP_VIEW_UPDATES_COUNT = 5;
const PERF_REFRESH_MS = 250;
const SLOT_META_REFRESH_MS = 1000;

export function createDebugOverlay({
  layer,
  runner,
  onOpenSystemGraph,
  getPerfSnapshot,
}) {
  const root = new PIXI.Container();
  root.x = DESIGN_WIDTH - 220;
  root.y = 10;
  layer.addChild(root);

  const apText = new PIXI.Text("AP: -- / --", {
    fontFamily: "Arial",
    fontSize: 18,
    fill: 0xffd700,
    fontWeight: "bold",
  });
  apText.x = 10;
  apText.y = 10;
  root.addChild(apText);

  const dbgBtn = new PIXI.Graphics();
  dbgBtn.beginFill(0x444444);
  dbgBtn.drawRoundedRect(160, 5, 30, 30, 4);
  dbgBtn.endFill();
  dbgBtn.eventMode = "static";
  dbgBtn.cursor = "pointer";
  root.addChild(dbgBtn);

  const dbgIcon = new PIXI.Text("D", { fontSize: 20, fill: 0xffffff });
  dbgIcon.x = 166;
  dbgIcon.y = 8;
  dbgBtn.addChild(dbgIcon);

  const panel = new PIXI.Container();
  panel.y = 50;
  panel.visible = false;
  root.addChild(panel);

  const panelBg = new PIXI.Graphics();
  panelBg.beginFill(0x222222, 0.9);
  panelBg.drawRoundedRect(0, 0, PANEL_WIDTH, PANEL_HEIGHT, 8);
  panelBg.endFill();
  panel.addChild(panelBg);

  const cheatBtn = new PIXI.Container();
  cheatBtn.x = 10;
  cheatBtn.y = 10;
  panel.addChild(cheatBtn);

  const cheatBg = new PIXI.Graphics();
  cheatBg.beginFill(0x555555);
  cheatBg.drawRect(0, 0, 180, 30);
  cheatBg.endFill();
  cheatBtn.addChild(cheatBg);

  const cheatText = new PIXI.Text("Toggle Cheat AP", {
    fontSize: 14,
    fill: 0xffffff,
  });
  cheatText.x = 10;
  cheatText.y = 6;
  cheatBtn.addChild(cheatText);

  let cheatsEnabled = false;
  const slotRows = [];
  const slotCount = runner.getSaveSlotCount?.() ?? 3;
  const slotStartY = 50;
  const slotRowGap = 40;
  let lastPerfReadMs = 0;
  let lastSlotMetaReadMs = 0;
  const cachedSlotMetaByIndex = new Map();

  function buildSlotRow(slotIndex) {
    const row = new PIXI.Container();
    row.x = 10;
    row.y = slotStartY + (slotIndex - 1) * slotRowGap;
    panel.addChild(row);

    const label = new PIXI.Text(`Slot ${slotIndex}: empty`, {
      fontSize: 11,
      fill: 0xffffff,
    });
    label.x = 0;
    label.y = 4;
    row.addChild(label);

    const saveBtn = new PIXI.Container();
    saveBtn.x = 0;
    saveBtn.y = 18;
    saveBtn.eventMode = "static";
    saveBtn.cursor = "pointer";
    row.addChild(saveBtn);

    const saveBg = new PIXI.Graphics();
    saveBg.beginFill(0x555555);
    saveBg.drawRoundedRect(0, 0, 52, 20, 4);
    saveBg.endFill();
    saveBtn.addChild(saveBg);

    const saveText = new PIXI.Text("Save", {
      fontSize: 10,
      fill: 0xffffff,
    });
    saveText.x = 12;
    saveText.y = 3;
    saveBtn.addChild(saveText);

    const loadBtn = new PIXI.Container();
    loadBtn.x = 68;
    loadBtn.y = 18;
    loadBtn.eventMode = "static";
    loadBtn.cursor = "pointer";
    row.addChild(loadBtn);

    const loadBg = new PIXI.Graphics();
    loadBg.beginFill(0x555555);
    loadBg.drawRoundedRect(0, 0, 52, 20, 4);
    loadBg.endFill();
    loadBtn.addChild(loadBg);

    const loadText = new PIXI.Text("Load", {
      fontSize: 10,
      fill: 0xffffff,
    });
    loadText.x = 11;
    loadText.y = 3;
    loadBtn.addChild(loadText);

    saveBtn.on("pointerdown", () => {
      runner.saveToSlot?.(slotIndex);
    });

    loadBtn.on("pointerdown", () => {
      runner.loadFromSlot?.(slotIndex);
    });

    return { label, saveBtn, loadBtn, loadBg, slotIndex };
  }

  for (let i = 1; i <= slotCount; i++) {
    slotRows.push(buildSlotRow(i));
  }

  const eventIds = Object.keys(envEventDefs || {});
  eventIds.sort();
  let eventIndex = 0;

  const eventHeader = new PIXI.Text("Next Event", {
    fontSize: 11,
    fill: 0xffffff,
  });
  eventHeader.x = 10;
  eventHeader.y = slotStartY + slotCount * slotRowGap + 6;
  panel.addChild(eventHeader);

  const eventName = new PIXI.Text("", {
    fontSize: 10,
    fill: 0xc7d2ee,
    wordWrap: true,
    wordWrapWidth: 180,
  });
  eventName.x = 10;
  eventName.y = eventHeader.y + 16;
  panel.addChild(eventName);

  const prevEvent = new PIXI.Text("<", { fontSize: 14, fill: 0xffffff });
  prevEvent.x = 10;
  prevEvent.y = eventName.y + 22;
  prevEvent.eventMode = "static";
  prevEvent.cursor = "pointer";
  panel.addChild(prevEvent);

  const nextEvent = new PIXI.Text(">", { fontSize: 14, fill: 0xffffff });
  nextEvent.x = 30;
  nextEvent.y = eventName.y + 22;
  nextEvent.eventMode = "static";
  nextEvent.cursor = "pointer";
  panel.addChild(nextEvent);

  const spawnBtn = new PIXI.Container();
  spawnBtn.x = 60;
  spawnBtn.y = eventName.y + 18;
  spawnBtn.eventMode = "static";
  spawnBtn.cursor = "pointer";
  panel.addChild(spawnBtn);

  const spawnBg = new PIXI.Graphics();
  spawnBg.beginFill(0x555555);
  spawnBg.drawRoundedRect(0, 0, 120, 22, 4);
  spawnBg.endFill();
  spawnBtn.addChild(spawnBg);

  const spawnText = new PIXI.Text("Queue Event", {
    fontSize: 10,
    fill: 0xffffff,
  });
  spawnText.x = 18;
  spawnText.y = 4;
  spawnBtn.addChild(spawnText);

  dbgBtn.on("pointerdown", () => {
    panel.visible = !panel.visible;
  });
/*
  dbgIcon.on("pointerdown", () => {
    panel.visible = !panel.visible;
  });
*/
  cheatBtn.eventMode = "static";
  cheatBtn.cursor = "pointer";
  cheatBtn.on("pointerdown", () => {
    cheatsEnabled = !cheatsEnabled;
    const payload = cheatsEnabled
      ? { enabled: true, cap: 9999, points: 9999 }
      : { enabled: false };
    runner.dispatchAction(ActionKinds.DEBUG_SET_CAP, payload);
    cheatBg.clear();
    cheatBg.beginFill(cheatsEnabled ? 0x00aa00 : 0x555555);
    cheatBg.drawRect(0, 0, 180, 30);
    cheatBg.endFill();
  });

  function setEventIndex(nextIndex) {
    if (!eventIds.length) {
      eventIndex = 0;
      return;
    }
    const max = eventIds.length - 1;
    eventIndex = Math.max(0, Math.min(max, nextIndex));
  }

  prevEvent.on("pointerdown", () => {
    setEventIndex(eventIndex - 1);
  });

  nextEvent.on("pointerdown", () => {
    setEventIndex(eventIndex + 1);
  });

  spawnBtn.on("pointerdown", () => {
    const defId = eventIds[eventIndex] ?? null;
    if (!defId) return;
    runner.dispatchAction?.(ActionKinds.DEBUG_QUEUE_ENV_EVENT, { defId });
  });

  const graphBtn = new PIXI.Container();
  graphBtn.x = 10;
  graphBtn.y = spawnBtn.y + 32;
  graphBtn.eventMode = "static";
  graphBtn.cursor = "pointer";
  panel.addChild(graphBtn);

  const graphBg = new PIXI.Graphics();
  graphBg.beginFill(0x555555);
  graphBg.drawRoundedRect(0, 0, 180, 24, 4);
  graphBg.endFill();
  graphBtn.addChild(graphBg);

  const graphText = new PIXI.Text("Toggle System Graph", {
    fontSize: 11,
    fill: 0xffffff,
  });
  graphText.x = 24;
  graphText.y = 4;
  graphBtn.addChild(graphText);

  graphBtn.on("pointerdown", () => {
    onOpenSystemGraph?.();
  });

  const perfHeader = new PIXI.Text("Top View Updates", {
    fontSize: 10,
    fill: 0xffffff,
    fontWeight: "bold",
  });
  perfHeader.x = 10;
  perfHeader.y = graphBtn.y + 30;
  panel.addChild(perfHeader);

  const perfRows = [];
  for (let i = 0; i < TOP_VIEW_UPDATES_COUNT; i++) {
    const row = new PIXI.Text("--", {
      fontSize: 9,
      fill: 0xc7d2ee,
      wordWrap: true,
      wordWrapWidth: PANEL_WIDTH - 20,
    });
    row.x = 10;
    row.y = perfHeader.y + 14 + i * 14;
    panel.addChild(row);
    perfRows.push(row);
  }

  function updatePerfRows() {
    const now = performance.now();
    if (now - lastPerfReadMs < PERF_REFRESH_MS) return;
    lastPerfReadMs = now;

    const snapshot =
      typeof getPerfSnapshot === "function" ? getPerfSnapshot() : null;
    if (snapshot?.ok === false) {
      const reason = typeof snapshot.reason === "string" ? snapshot.reason : "unavailable";
      perfRows[0].text = `perf ${reason}`;
      for (let i = 1; i < perfRows.length; i++) perfRows[i].text = "";
      return;
    }
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

  return {
    update: () => {
      const state = runner.getState();
      if (state) {
        const preview = runner.getActionPlanner?.()?.getApPreview?.() ?? null;
        const cur =
          preview && Number.isFinite(preview.remaining)
            ? Math.floor(preview.remaining)
            : state.actionPoints ?? 0;
        const cap = state.actionPointCap ?? 100;
        apText.text = ``;
        apText.style.fill = cur < 20 ? 0xff5555 : 0xffd700;
      }
      if (!panel.visible) return;

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
          row.label.text = `Slot ${row.slotIndex}: T${tSec} ${season}`;
          row.loadBtn.alpha = 1;
          row.loadBtn.eventMode = "static";
          row.loadBtn.cursor = "pointer";
          row.loadBg.tint = 0xffffff;
        } else {
          row.label.text = `Slot ${row.slotIndex}: empty`;
          row.loadBtn.alpha = 0.4;
          row.loadBtn.eventMode = "none";
          row.loadBtn.cursor = "default";
          row.loadBg.tint = 0xffffff;
        }
      }

      if (!eventIds.length) {
        eventName.text = "No events";
        spawnBtn.alpha = 0.4;
        spawnBtn.eventMode = "none";
      } else {
        const defId = eventIds[eventIndex];
        const def = envEventDefs[defId];
        const label = def?.name || defId;
        eventName.text = label;
        spawnBtn.alpha = 1;
        spawnBtn.eventMode = "static";
      }

      if (panel.visible) {
        updatePerfRows();
      }
    },
  };
}
