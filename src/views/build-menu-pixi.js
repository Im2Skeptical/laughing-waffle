// build-menu-pixi.js
// Build menu + placement helper for hub construction.

import { hubStructureDefs } from "../defs/gamepieces/hub-structure-defs.js";
import { INTENT_AP_COSTS } from "../defs/gamesettings/action-costs-defs.js";
import { ActionKinds } from "../model/actions.js";
import { computeAvailableRecipesAndBuildings } from "../model/skills.js";
import {
  HUB_COLS,
  HUB_STRUCTURE_HEIGHT,
  HUB_STRUCTURE_ROW_Y,
  CHARACTER_ROW_OFFSET_Y,
  TILE_HEIGHT,
  TILE_ROW_Y,
  getHubColumnCenterX,
  getBoardColumnCenterX,
  layoutBoardColPos,
  layoutHubStructurePos,
} from "./layout-pixi.js";

const PANEL_WIDTH = 240;
const PANEL_PAD = 12;
const ROW_HEIGHT = 34;
const ROW_GAP = 6;
const PANEL_MARGIN = 16;
const PANEL_OFFSET_X = 48;

function countStructuresByDefId(state) {
  const counts = new Map();
  const slots = Array.isArray(state?.hub?.slots) ? state.hub.slots : [];
  for (const slot of slots) {
    const structure = slot?.structure;
    if (!structure) continue;
    const id = structure.defId;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return counts;
}

function resolveHubColFromPos(state, globalPos, screenWidth) {
  if (!state || !globalPos) return null;
  const hubTop = HUB_STRUCTURE_ROW_Y;
  const hubBottom = HUB_STRUCTURE_ROW_Y + HUB_STRUCTURE_HEIGHT;
  if (globalPos.y < hubTop || globalPos.y > hubBottom) return null;

  const hubCols = Array.isArray(state?.hub?.slots)
    ? state.hub.slots.length
    : HUB_COLS;

  let bestCol = null;
  let bestDist2 = Infinity;
  for (let col = 0; col < hubCols; col++) {
    const cx = getHubColumnCenterX(screenWidth, col);
    const dx = globalPos.x - cx;
    const d2 = dx * dx;
    if (d2 < bestDist2) {
      bestDist2 = d2;
      bestCol = col;
    }
  }
  return bestCol;
}

export function createBuildMenuView(opts) {
  const {
    app,
    layer,
    getGameState,
    getSelectedLeaderId,
    actionPlanner,
    queueActionWhenPaused,
    requestPauseForAction,
    dispatchPlayerEditBatch,
    scheduleActionsAtNextSecond,
    flashActionGhost,
  } = opts;

  const root = new PIXI.Container();
  root.visible = false;
  layer.addChild(root);

  const bg = new PIXI.Graphics();
  root.addChild(bg);

  const titleText = new PIXI.Text("Build", {
    fill: 0xffffff,
    fontSize: 14,
    fontWeight: "bold",
  });
  titleText.x = PANEL_PAD;
  titleText.y = PANEL_PAD;
  root.addChild(titleText);

  const listContainer = new PIXI.Container();
  listContainer.x = PANEL_PAD;
  listContainer.y = PANEL_PAD + 24;
  root.addChild(listContainer);

  const hintText = new PIXI.Text("", {
    fill: 0xc7d2ee,
    fontSize: 11,
    wordWrap: true,
    wordWrapWidth: PANEL_WIDTH - PANEL_PAD * 2,
  });
  hintText.x = PANEL_PAD;
  root.addChild(hintText);

  let activeBuildDefId = null;
  let lastSignature = null;
  let lastLeaderId = null;
  let lastPanelHeight = 0;

  function getStateSafe() {
    return typeof getGameState === "function" ? getGameState() : null;
  }

  function getSelectedLeader(state) {
    const leaderId =
      typeof getSelectedLeaderId === "function"
        ? getSelectedLeaderId()
        : null;
    if (leaderId == null) return null;
    const pawns = Array.isArray(state?.pawns) ? state.pawns : [];
    const leader = pawns.find((candidatePawn) => candidatePawn?.id === leaderId) || null;
    if (!leader || leader.role !== "leader") return null;
    return leader;
  }

  function computeOptions(state) {
    const availability = computeAvailableRecipesAndBuildings(state);
    const unlocked = availability?.hubStructureIds ?? new Set();

    const counts = countStructuresByDefId(state);
    const options = [];

    for (const id of unlocked.values()) {
      const def = hubStructureDefs[id];
      if (!def) continue;
      const maxInstances = Number.isFinite(def.maxInstances)
        ? Math.max(0, Math.floor(def.maxInstances))
        : 1;
      const existing = counts.get(id) || 0;
      const available = maxInstances === 0 ? false : existing < maxInstances;
      options.push({
        def,
        id,
        name: def.name || id,
        available,
        existing,
        maxInstances,
      });
    }

    options.sort((a, b) => a.name.localeCompare(b.name));
    return options;
  }

  function rebuild(options, leader) {
    listContainer.removeChildren();

    let y = 0;
    for (const entry of options) {
      const row = new PIXI.Container();
      row.y = y;
      row.eventMode = "static";
      row.cursor = entry.available ? "pointer" : "default";

      const isActive = activeBuildDefId === entry.id;
      const fill = isActive ? 0x303a55 : 0x1f263d;
      const alpha = entry.available ? 0.95 : 0.5;

      const rowBg = new PIXI.Graphics()
        .beginFill(fill, alpha)
        .drawRoundedRect(0, 0, PANEL_WIDTH - PANEL_PAD * 2, ROW_HEIGHT, 6)
        .endFill();
      row.addChild(rowBg);

      const label = new PIXI.Text(entry.name, {
        fill: 0xffffff,
        fontSize: 12,
        fontWeight: "bold",
      });
      label.x = 8;
      label.y = 8;
      row.addChild(label);

      const cost = INTENT_AP_COSTS?.buildDesignate ?? 0;
      const costText = new PIXI.Text(String(cost), {
        fill: 0x7fd0ff,
        fontSize: 12,
      });
      costText.x = PANEL_WIDTH - PANEL_PAD * 2 - 24;
      costText.y = 8;
      row.addChild(costText);

      if (!entry.available) {
        const note = new PIXI.Text("Limit", {
          fill: 0xffc2c2,
          fontSize: 10,
        });
        note.x = PANEL_WIDTH - PANEL_PAD * 2 - 60;
        note.y = 9;
        row.addChild(note);
      }

      row.on("pointertap", (ev) => {
        ev?.stopPropagation?.();
        if (!entry.available) return;
        if (activeBuildDefId === entry.id) {
          activeBuildDefId = null;
        } else {
          requestPauseForAction?.();
          activeBuildDefId = entry.id;
        }
        rebuild(options, leader);
      });

      listContainer.addChild(row);
      y += ROW_HEIGHT + ROW_GAP;
    }

    const hint =
      activeBuildDefId != null
        ? "Click a hub slot to place."
        : "Select a building to place.";
    hintText.text = hint;
    hintText.y = listContainer.y + y + 6;

    const height = hintText.y + hintText.height + PANEL_PAD;
    if (height !== lastPanelHeight) {
      bg.clear();
      bg.beginFill(0x141b2b, 0.9);
      bg.drawRoundedRect(0, 0, PANEL_WIDTH, height, 10);
      bg.endFill();
      lastPanelHeight = height;
    }
  }

  function flashBuildGhost(defId) {
    if (typeof flashActionGhost !== "function") return;
    const def = hubStructureDefs[defId];
    const name = def?.name || defId || "Build";
    flashActionGhost(
      {
        description: `Build ${name}`,
        cost: INTENT_AP_COSTS?.buildDesignate ?? 0,
      },
      "fail"
    );
  }

  function placeBuildAt(col) {
    const state = getStateSafe();
    const leader = getSelectedLeader(state);
    if (!state || !leader || !actionPlanner) return { ok: false, reason: "noLeader" };
    if (!Number.isFinite(col)) return { ok: false, reason: "badHubCol" };

    const defId = activeBuildDefId;
    if (!defId) return { ok: false, reason: "noBuildSelected" };

    const previewPlacement =
      typeof actionPlanner.getPawnOverridePlacement === "function"
        ? actionPlanner.getPawnOverridePlacement(leader.id)
        : null;
    const currentHubCol = Number.isFinite(previewPlacement?.hubCol)
      ? Math.floor(previewPlacement.hubCol)
      : Number.isFinite(leader.hubCol)
      ? Math.floor(leader.hubCol)
      : null;
    const currentEnvCol = Number.isFinite(previewPlacement?.envCol)
      ? Math.floor(previewPlacement.envCol)
      : Number.isFinite(leader.envCol)
      ? Math.floor(leader.envCol)
      : null;
    const alreadyThere = currentHubCol === col && currentEnvCol == null;

    const buildKey = `hub:${col}`;
    const target = { hubCol: col };

    const runWhenPaused = () => {
      let moveSet = false;
      let moveRes = { ok: true };
      if (!alreadyThere) {
        moveRes = actionPlanner.setPawnMoveIntent({
          pawnId: leader.id,
          toHubCol: col,
        });
        if (!moveRes?.ok) {
          if (moveRes?.reason === "insufficientAP") {
            flashBuildGhost(defId);
          }
          return moveRes;
        }
        moveSet = true;
      }

      const buildRes = actionPlanner.setBuildDesignationIntent({
        buildKey,
        defId,
        target,
      });

      if (!buildRes?.ok) {
        if (buildRes?.reason === "insufficientAP") {
          flashBuildGhost(defId);
        }
        if (moveSet && !previewPlacement) {
          actionPlanner.removeIntent?.(`pawn:${leader.id}`);
        }
        return buildRes;
      }

      activeBuildDefId = null;
      return buildRes;
    };
    const runWhenLive = () => {
      const dispatchBatch =
        typeof dispatchPlayerEditBatch === "function"
          ? dispatchPlayerEditBatch
          : scheduleActionsAtNextSecond;
      if (typeof dispatchBatch !== "function") {
        return { ok: false, reason: "noScheduleActions" };
      }
      const actions = [];
      if (!alreadyThere) {
        actions.push({
          kind: ActionKinds.PLACE_PAWN,
          payload: {
            pawnId: leader.id,
            toHubCol: col,
          },
          apCost: INTENT_AP_COSTS?.pawnMove ?? 0,
        });
      }
      actions.push({
        kind: ActionKinds.BUILD_DESIGNATE,
        payload: {
          buildKey,
          defId,
          target,
        },
        apCost: INTENT_AP_COSTS?.buildDesignate ?? 0,
      });
      const res = dispatchBatch(actions, {
        reason: "buildMenuLive",
      });
      if (res?.ok) {
        activeBuildDefId = null;
      }
      return res;
    };

    if (typeof queueActionWhenPaused === "function") {
      return queueActionWhenPaused({ runWhenPaused, runWhenLive });
    }
    return runWhenPaused();
  }

  function onStagePointerDown(ev) {
    if (!activeBuildDefId || !root.visible) return;
    const p = ev?.data?.global;
    if (!p) return;
    const bounds = root.getBounds();
    if (
      p.x >= bounds.x &&
      p.x <= bounds.x + bounds.width &&
      p.y >= bounds.y &&
      p.y <= bounds.y + bounds.height
    ) {
      return;
    }
    const state = getStateSafe();
    const col = resolveHubColFromPos(state, p, app.screen.width);
    if (col == null) return;
    ev?.stopPropagation?.();
    placeBuildAt(col);
  }

  function update() {
    const state = getStateSafe();
    const leader = getSelectedLeader(state);

    if (!state || !leader) {
      root.visible = false;
      activeBuildDefId = null;
      lastSignature = null;
      lastLeaderId = null;
      return;
    }

    root.visible = true;

    if (lastLeaderId !== leader.id) {
      activeBuildDefId = null;
      lastLeaderId = leader.id;
    }

    const options = computeOptions(state);
    const signature = `${options
      .map((o) => `${o.id}:${o.available ? "1" : "0"}`)
      .join("|")}|active:${activeBuildDefId ?? ""}`;
    if (signature !== lastSignature) {
      lastSignature = signature;
      rebuild(options, leader);
    } else {
      titleText.text = `Build (${leader.name || "Leader"})`;
      hintText.text =
        activeBuildDefId != null
          ? "Click a hub slot to place."
          : "Select a building to place.";
    }

    titleText.text = `Build (${leader.name || "Leader"})`;

    const screenWidth = app.screen.width;
    const screenHeight = app.screen.height;
    const panelHeight = lastPanelHeight > 0 ? lastPanelHeight : 160;

    let centerX = screenWidth / 2;
    let centerY = screenHeight / 2;
    const envCol = Number.isFinite(leader.envCol) ? Math.floor(leader.envCol) : null;
    const hubCol = Number.isFinite(leader.hubCol) ? Math.floor(leader.hubCol) : null;

    if (envCol != null) {
      const pos = layoutBoardColPos(screenWidth, envCol, 0, TILE_ROW_Y);
      centerX = getBoardColumnCenterX(screenWidth, envCol);
      centerY = pos.y - CHARACTER_ROW_OFFSET_Y;
    } else if (hubCol != null) {
      const pos = layoutHubStructurePos(screenWidth, hubCol);
      centerX = getHubColumnCenterX(screenWidth, hubCol);
      centerY = pos.y - CHARACTER_ROW_OFFSET_Y;
    }

    let desiredX = centerX + PANEL_OFFSET_X;
    if (desiredX + PANEL_WIDTH > screenWidth - PANEL_MARGIN) {
      desiredX = centerX - PANEL_OFFSET_X - PANEL_WIDTH;
    }
    let desiredY = centerY - panelHeight / 2;

    root.x = Math.max(
      PANEL_MARGIN,
      Math.min(screenWidth - PANEL_WIDTH - PANEL_MARGIN, desiredX)
    );
    root.y = Math.max(
      PANEL_MARGIN,
      Math.min(screenHeight - panelHeight - PANEL_MARGIN, desiredY)
    );
  }

  function init() {
    app.stage.on("pointerdown", onStagePointerDown);
  }

  return { init, update };
}
