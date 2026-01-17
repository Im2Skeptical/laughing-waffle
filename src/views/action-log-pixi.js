// src/views/action-log-pixi.js
// Minimal current-second action log UI (planner intents only).

import { itemDefs, permanentDefs } from "../defs/gamepieces-defs.js";

const PANEL_WIDTH = 300;
const PANEL_HEIGHT = 720;
const HEADER_HEIGHT = 64;
const ROW_HEIGHT = 54;
const ROW_GAP = 8;
const PADDING = 16;

export function createActionLogView({
  app,
  layer,
  getPlanner,
  getTimeline,
  getCursorState,
  isPreviewing,
  onJumpToSecond,
  getOwnerLabel,
  getState,
  position = { x: 1600, y: 180 },
}) {
  const container = new PIXI.Container();
  container.x = position.x;
  container.y = position.y;
  container.zIndex = 100;
  layer.addChild(container);

  const bg = new PIXI.Graphics();
  bg.beginFill(0x151a2a, 0.95);
  bg.drawRoundedRect(0, 0, PANEL_WIDTH, PANEL_HEIGHT, 16);
  bg.endFill();
  container.addChild(bg);

  const header = new PIXI.Container();
  header.x = 0;
  header.y = 0;
  container.addChild(header);

  const title = new PIXI.Text("Action Log", {
    fill: 0xffffff,
    fontSize: 28,
    fontWeight: "bold",
  });
  title.x = PADDING + 80;
  title.y = 16;
  header.addChild(title);

  const prevBtn = new PIXI.Text("<", {
    fill: 0x9aa0b5,
    fontSize: 20,
    fontWeight: "bold",
  });
  prevBtn.x = PANEL_WIDTH - 48;
  prevBtn.y = 20;
  prevBtn.eventMode = "static";
  prevBtn.cursor = "pointer";
  header.addChild(prevBtn);

  const nextBtn = new PIXI.Text(">", {
    fill: 0x9aa0b5,
    fontSize: 20,
    fontWeight: "bold",
  });
  nextBtn.x = PANEL_WIDTH - 22;
  nextBtn.y = 20;
  nextBtn.eventMode = "static";
  nextBtn.cursor = "pointer";
  header.addChild(nextBtn);

  const apPanel = new PIXI.Graphics();
  apPanel.beginFill(0x1f263d, 1);
  apPanel.drawRoundedRect(PADDING, 12, 64, 44, 12);
  apPanel.endFill();
  header.addChild(apPanel);

  const apLabel = new PIXI.Text("AP", {
    fill: 0xffffff,
    fontSize: 12,
    fontWeight: "bold",
  });
  apLabel.x = PADDING + 18;
  apLabel.y = 16;
  header.addChild(apLabel);

  const apValue = new PIXI.Text("--/--", {
    fill: 0x7fd0ff,
    fontSize: 14,
    fontWeight: "bold",
  });
  apValue.x = PADDING + 10;
  apValue.y = 32;
  header.addChild(apValue);

  const rows = new PIXI.Container();
  rows.x = PADDING;
  rows.y = HEADER_HEIGHT;
  container.addChild(rows);

  let lastVersion = -1;
  let lastTimelineRevision = null;
  let actionSecs = [];
  let lastPreviewing = null;
  let lastPreviewSec = null;

  function isLogAction(action) {
    if (!action || typeof action !== "object") return false;
    const kind = action.kind;
    if (kind === "inventoryMove") {
      const payload = action.payload || {};
      const fromOwner = payload.fromOwnerId;
      const toOwner = payload.toOwnerId;
      return fromOwner != null && toOwner != null && fromOwner !== toOwner;
    }
    if (kind === "placeCharacter") return true;
    if (kind === "buildDesignate") return true;
    return false;
  }

  function rebuildActionSecs() {
    const tl = typeof getTimeline === "function" ? getTimeline() : null;
    const rev = Math.floor(tl?.revision ?? -1);
    if (rev === lastTimelineRevision) return;
    lastTimelineRevision = rev;

    const set = new Set();
    for (const action of tl?.actions || []) {
      if (!isLogAction(action)) continue;
      set.add(Math.max(0, Math.floor(action.tSec ?? 0)));
    }
    actionSecs = Array.from(set.values()).sort((a, b) => a - b);
  }

  function getPrevNextSecs(currentSec) {
    let prev = null;
    let next = null;
    for (const sec of actionSecs) {
      if (sec < currentSec) prev = sec;
      if (sec > currentSec) {
        next = sec;
        break;
      }
    }
    return { prev, next };
  }

  function formatItemName(intent) {
    const kind = intent?.item?.kind ?? null;
    return formatItemNameFromKind(kind) || `Item ${intent?.itemId ?? ""}`.trim();
  }

  function formatItemNameFromKind(kind) {
    if (kind && itemDefs[kind]) return itemDefs[kind].name || kind;
    return kind || "";
  }

  function isCurrencyKind(kind) {
    const tags = itemDefs[kind]?.tags || [];
    return Array.isArray(tags) && tags.includes("currency");
  }

  function getItemQuantity(item) {
    return Math.max(1, Math.floor(item?.quantity ?? 1));
  }

  function compareOwnerIds(a, b) {
    const aNum = Number(a);
    const bNum = Number(b);
    const aIsNum = Number.isFinite(aNum);
    const bIsNum = Number.isFinite(bNum);
    if (aIsNum && bIsNum) return aNum - bNum;
    const aStr = String(a);
    const bStr = String(b);
    if (aStr < bStr) return -1;
    if (aStr > bStr) return 1;
    return 0;
  }

  function getCurrencyGroupInfo(kind, fromOwnerId, toOwnerId) {
    if (kind == null) return null;
    if (fromOwnerId == null || toOwnerId == null) return null;
    if (fromOwnerId === toOwnerId) return null;
    const cmp = compareOwnerIds(fromOwnerId, toOwnerId);
    const minId = cmp <= 0 ? fromOwnerId : toOwnerId;
    const maxId = cmp <= 0 ? toOwnerId : fromOwnerId;
    const dir = cmp <= 0 ? 1 : -1;
    const key = `${kind}|${String(minId)}|${String(maxId)}`;
    return { key, dir, minId, maxId };
  }

  function formatOwnerName(ownerId) {
    if (typeof getOwnerLabel === "function") return getOwnerLabel(ownerId);
    return `Owner ${ownerId}`;
  }

  function formatPawnName(charId, state) {
    const ch = state?.characters?.find((c) => c.id === charId);
    return ch?.name || `Char ${charId}`;
  }

  function formatSlotName(slotIndex, state) {
    const slots = state?.permanentSlots || [];
    const slot = slots[slotIndex];
    const perm = slot?.permanent;
    if (perm) {
      const def = permanentDefs[perm.defId];
      return def?.name || def?.id || `Slot ${slotIndex}`;
    }
    return `Slot ${slotIndex}`;
  }

  function describeIntent(intent, state) {
    if (!intent) return "";
    switch (intent.kind) {
      case "itemTransfer": {
        const itemName = formatItemName(intent);
        const dest = formatOwnerName(intent.toOwnerId);
        return `${itemName} > ${dest}`;
      }
      case "pawnMove": {
        const pawnName = formatPawnName(intent.charId, state);
        const dest = formatSlotName(intent.toPlacement?.slotIndex, state);
        return `${pawnName} > ${dest}`;
      }
      case "buildDesignate": {
        return `Build ${intent.defId || intent.buildKey || "Plan"}`;
      }
      default:
        return intent.kind || "Action";
    }
  }

  function buildIntentRowSpecs(intents, planner, state, focus) {
    const groupByKey = new Map();
    const groupKeyByIntentId = new Map();

    for (let i = 0; i < intents.length; i++) {
      const intent = intents[i];
      if (intent?.kind !== "itemTransfer") continue;
      const kind = intent.item?.kind ?? null;
      if (!isCurrencyKind(kind)) continue;
      const info = getCurrencyGroupInfo(
        kind,
        intent.fromOwnerId,
        intent.toOwnerId
      );
      if (!info) continue;
      const qty = getItemQuantity(intent.item);
      let group = groupByKey.get(info.key);
      if (!group) {
        group = {
          kind,
          minId: info.minId,
          maxId: info.maxId,
          net: 0,
          intentIds: [],
          cost: 0,
        };
        groupByKey.set(info.key, group);
      }
      group.net += info.dir * qty;
      group.intentIds.push(intent.id);
      group.cost += planner.getIntentCost?.(intent.id) ?? 0;
      groupKeyByIntentId.set(intent.id, info.key);
    }

    const rowsOut = [];
    const emittedGroups = new Set();

    for (let i = 0; i < intents.length; i++) {
      const intent = intents[i];
      const groupKey = groupKeyByIntentId.get(intent.id);
      if (groupKey) {
        if (emittedGroups.has(groupKey)) continue;
        emittedGroups.add(groupKey);
        const group = groupByKey.get(groupKey);
        if (!group || !group.net) continue;
        const qty = Math.abs(group.net);
        const toOwnerId = group.net > 0 ? group.maxId : group.minId;
        const itemName = formatItemNameFromKind(group.kind);
        const isFocused =
          focus && group.intentIds.some((intentId) => intentId === focus.id);
        rowsOut.push({
          id: groupKey,
          description: `${qty} ${itemName} > ${formatOwnerName(toOwnerId)}`,
          cost: group.cost,
          intentIds: group.intentIds.slice(),
          focusIntentId: isFocused ? focus.id : group.intentIds[0] ?? null,
          isFocused,
        });
        continue;
      }

      rowsOut.push({
        id: intent.id,
        description: describeIntent(intent, state),
        cost: planner.getIntentCost?.(intent.id) ?? 0,
        intentIds: [intent.id],
        focusIntentId: intent.id,
        isFocused: focus && focus.id === intent.id,
      });
    }

    return rowsOut;
  }

  function rebuildFromIntents() {
    rows.removeChildren();
    const planner = typeof getPlanner === "function" ? getPlanner() : null;
    if (!planner) return;

    const state = typeof getState === "function" ? getState() : null;
    const intents = planner.getOrderedIntents?.() || [];
    const focus = planner.getFocusIntent?.();
    const rowSpecs = buildIntentRowSpecs(intents, planner, state, focus);

    let y = 0;
    for (const spec of rowSpecs) {
      const row = new PIXI.Container();
      row.x = 0;
      row.y = y;

      const rowBg = new PIXI.Graphics();
      rowBg.beginFill(spec.isFocused ? 0x2b3350 : 0x2a2f42, 1);
      rowBg.drawRoundedRect(0, 0, PANEL_WIDTH - PADDING * 2, ROW_HEIGHT, 12);
      rowBg.endFill();
      row.addChild(rowBg);

      const costText = new PIXI.Text(String(spec.cost ?? 0), {
        fill: 0x7fd0ff,
        fontSize: 16,
        fontWeight: "bold",
      });
      costText.x = 16;
      costText.y = 16;
      row.addChild(costText);

      const descText = new PIXI.Text(spec.description || "", {
        fill: 0xffffff,
        fontSize: 16,
      });
      descText.x = 72;
      descText.y = 16;
      row.addChild(descText);

      const undoText = new PIXI.Text("x", {
        fill: 0x9aa0b5,
        fontSize: 16,
      });
      undoText.x = PANEL_WIDTH - PADDING * 2 - 24;
      undoText.y = 16;
      undoText.eventMode = "static";
      undoText.cursor = "pointer";
      undoText.on("pointertap", () => {
        for (const intentId of spec.intentIds || []) {
          planner.removeIntent?.(intentId);
        }
      });
      row.addChild(undoText);

      if (spec.focusIntentId) {
        row.eventMode = "static";
        row.cursor = "pointer";
        row.on("pointertap", () => {
          planner.toggleFocus?.(spec.focusIntentId);
        });
      }

      rows.addChild(row);
      y += ROW_HEIGHT + ROW_GAP;
    }
  }

  function buildActionRowSpecs(actions, state) {
    const groupByKey = new Map();
    const groupKeyByAction = new Map();

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      if (action.kind !== "inventoryMove") continue;
      const payload = action.payload || {};
      const kind = payload.item?.kind ?? null;
      if (!isCurrencyKind(kind)) continue;
      const info = getCurrencyGroupInfo(
        kind,
        payload.fromOwnerId,
        payload.toOwnerId
      );
      if (!info) continue;
      const qty = getItemQuantity(payload.item);
      let group = groupByKey.get(info.key);
      if (!group) {
        group = {
          kind,
          minId: info.minId,
          maxId: info.maxId,
          net: 0,
          cost: 0,
        };
        groupByKey.set(info.key, group);
      }
      group.net += info.dir * qty;
      group.cost += Number.isFinite(action.apCost)
        ? Math.floor(action.apCost)
        : Number.isFinite(payload.apCost)
        ? Math.floor(payload.apCost)
        : 0;
      groupKeyByAction.set(action, info.key);
    }

    const rowsOut = [];
    const emittedGroups = new Set();

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      const payload = action.payload || {};
      const groupKey = groupKeyByAction.get(action);
      if (groupKey) {
        if (emittedGroups.has(groupKey)) continue;
        emittedGroups.add(groupKey);
        const group = groupByKey.get(groupKey);
        if (!group || !group.net) continue;
        const qty = Math.abs(group.net);
        const toOwnerId = group.net > 0 ? group.maxId : group.minId;
        const itemName = formatItemNameFromKind(group.kind);
        rowsOut.push({
          id: groupKey,
          description: `${qty} ${itemName} > ${formatOwnerName(toOwnerId)}`,
          cost: group.cost,
        });
        continue;
      }

      const kind = action.kind;
      const apCost =
        Number.isFinite(action.apCost) || Number.isFinite(payload.apCost)
          ? Math.floor(action.apCost ?? payload.apCost ?? 0)
          : 0;

      let desc = "Action";
      if (kind === "inventoryMove") {
        const itemName = payload.item?.kind
          ? formatItemNameFromKind(payload.item.kind)
          : `Item ${payload.itemId ?? ""}`.trim();
        const dest = formatOwnerName(payload.toOwnerId);
        desc = `${itemName} > ${dest}`;
      } else if (kind === "placeCharacter") {
        const pawnName = formatPawnName(payload.charId, state);
        const dest = formatSlotName(payload.slotIndex, state);
        desc = `${pawnName} > ${dest}`;
      } else if (kind === "buildDesignate") {
        desc = `Build ${payload.defId || payload.buildKey || "Plan"}`;
      }

      rowsOut.push({ id: `${kind}:${i}`, description: desc, cost: apCost });
    }

    return rowsOut;
  }

  function buildActionRows(actions, state) {
    rows.removeChildren();
    const rowSpecs = buildActionRowSpecs(actions, state);
    let y = 0;
    for (const spec of rowSpecs) {
      const row = new PIXI.Container();
      row.x = 0;
      row.y = y;

      const rowBg = new PIXI.Graphics();
      rowBg.beginFill(0x2a2f42, 1);
      rowBg.drawRoundedRect(0, 0, PANEL_WIDTH - PADDING * 2, ROW_HEIGHT, 12);
      rowBg.endFill();
      row.addChild(rowBg);

      const costText = new PIXI.Text(String(spec.cost ?? 0), {
        fill: 0x7fd0ff,
        fontSize: 16,
        fontWeight: "bold",
      });
      costText.x = 16;
      costText.y = 16;
      row.addChild(costText);

      const descText = new PIXI.Text(spec.description || "", {
        fill: 0xffffff,
        fontSize: 16,
      });
      descText.x = 72;
      descText.y = 16;
      row.addChild(descText);

      const undoText = new PIXI.Text("x", {
        fill: 0x9aa0b5,
        fontSize: 16,
      });
      undoText.x = PANEL_WIDTH - PADDING * 2 - 24;
      undoText.y = 16;
      undoText.alpha = 0.3;
      row.addChild(undoText);

      rows.addChild(row);
      y += ROW_HEIGHT + ROW_GAP;
    }
  }

  function rebuildFromTimeline(state) {
    const tl = typeof getTimeline === "function" ? getTimeline() : null;
    const tSec = Math.floor(state?.tSec ?? 0);
    const actions = [];
    if (tl?.actionsBySec) {
      actions.push(...(tl.actionsBySec.get(tSec) || []));
    } else {
      for (const action of tl?.actions || []) {
        if (Math.floor(action.tSec ?? 0) === tSec) actions.push(action);
      }
    }
    const logActions = actions.filter(isLogAction);
    buildActionRows(logActions, state);
  }

  function update() {
    const planner = typeof getPlanner === "function" ? getPlanner() : null;
    if (!planner) return;

    const previewing =
      typeof isPreviewing === "function" ? isPreviewing() : false;
    const state = typeof getState === "function" ? getState() : null;
    const previewSec = Math.floor(state?.tSec ?? 0);

    if (previewing !== lastPreviewing || previewSec !== lastPreviewSec) {
      lastPreviewing = previewing;
      lastPreviewSec = previewSec;
      if (previewing) {
        rebuildFromTimeline(state);
      } else {
        lastVersion = -1;
      }
    }

    const version = planner.getVersion?.() ?? 0;
    if (!previewing && version !== lastVersion) {
      lastVersion = version;
      rebuildFromIntents();
    }

    rebuildActionSecs();
    const cursorState =
      typeof getCursorState === "function" ? getCursorState() : null;
    const currentSec = Math.floor(cursorState?.tSec ?? 0);
    const { prev, next } = getPrevNextSecs(currentSec);

    prevBtn.alpha = prev == null ? 0.3 : 1;
    prevBtn.cursor = prev == null ? "default" : "pointer";
    nextBtn.alpha = next == null ? 0.3 : 1;
    nextBtn.cursor = next == null ? "default" : "pointer";

    if (previewing && state) {
      const cur = Math.floor(state.actionPoints ?? 0);
      const cap = Math.floor(state.actionPointCap ?? 0);
      apValue.text = `${cur}/${cap}`;
    } else {
      const ap = planner.getApPreview?.();
      if (ap) {
        apValue.text = `${Math.floor(ap.remaining)}/${Math.floor(ap.base)}`;
      }
    }
  }

  function init() {}

  prevBtn.on("pointertap", () => {
    rebuildActionSecs();
    const cursorState =
      typeof getCursorState === "function" ? getCursorState() : null;
    const currentSec = Math.floor(cursorState?.tSec ?? 0);
    const { prev } = getPrevNextSecs(currentSec);
    if (prev == null) return;
    onJumpToSecond?.(prev);
  });

  nextBtn.on("pointertap", () => {
    rebuildActionSecs();
    const cursorState =
      typeof getCursorState === "function" ? getCursorState() : null;
    const currentSec = Math.floor(cursorState?.tSec ?? 0);
    const { next } = getPrevNextSecs(currentSec);
    if (next == null) return;
    onJumpToSecond?.(next);
  });

  return { init, update, container };
}
