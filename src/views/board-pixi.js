// board-pixi.js
// Renders environment cards (row 1) + permanent slots (row 2)
// Uses a fixed 1920x1080 design resolution and centres rows horizontally.
// VIEW-ONLY: does NOT write layout data into the model.

import { permanentDefs, envCardDefs } from "../defs/gamepieces/gamepieces-defs.js";
import {
  PERM_WIDTH,
  PERM_HEIGHT,
  PERM_GAP,
  PERM_ROW_Y,
  layoutPermPos as layoutPermPosShared,
} from "./layout-pixi.js";

/**
 * opts:
 *  - app: PIXI.Application
 *  - envLayer: PIXI.Container
 *  - permanentsLayer: PIXI.Container
 *  - getGameState: () => gameState
 *  - interaction: interactionController (for canShowHoverUI)
 *  - tooltipView
 *  - inventoryView
 */
export function createBoardView(opts) {
  const {
    app,
    envLayer,
    permanentsLayer,
    getGameState,
    tooltipView,
    inventoryView,
  } = opts;

  /** @type {(BoardEnvView | undefined)[]} */
  const envViews = [];
  /** @type {Map<number, BoardPermView>} */
  const permViews = new Map();

  // --------------------------------------------------------
  // Layout helpers (VIEW-ONLY)
  // --------------------------------------------------------

  function layoutEnvPos(i, count) {
    const totalWidth = count * ENV_WIDTH + (count - 1) * ENV_GAP;
    const startX = (app.screen.width - totalWidth) / 2;
    return {
      x: startX + i * (ENV_WIDTH + ENV_GAP),
      y: 140,
    };
  }

  // --------------------------------------------------------
  // UI helpers
  // --------------------------------------------------------

  function getEnvUi(envInst) {
    const def = envCardDefs[envInst.defId];
    const ui = def.ui || {};
    const title =
      (typeof ui.title === "function" ? ui.title(envInst, def) : ui.title) ||
      def.name ||
      envInst.defId;
    const lines = (ui.lines || [])
      .map((line) => (typeof line === "function" ? line(envInst, def) : line))
      .filter(Boolean);
    const meters = Array.isArray(ui.meters) ? ui.meters : [];
    return { def, title, lines, color: def.color ?? 0x66aa66, meters };
  }

  function getPermUi(permInst) {
    const def = permanentDefs[permInst.defId];
    const ui = def.ui || {};
    const title =
      (typeof ui.title === "function" ? ui.title(permInst, def) : ui.title) ||
      def.name ||
      permInst.defId;
    const lines = (ui.lines || [])
      .map((line) => (typeof line === "function" ? line(permInst, def) : line))
      .filter(Boolean);
    const meters = Array.isArray(ui.meters) ? ui.meters : [];
    return { def, title, lines, color: def.color ?? 0x336699, meters };
  }

  // --------------------------------------------------------
  // Meter helpers
  // --------------------------------------------------------

  function createMeters(container, meters, inst, startY, maxWidth) {
    const meterHeight = 8;
    const meterWidth = maxWidth ?? 120;
    let y = startY;
    const meterViews = [];

    for (const meter of meters) {
      const labelText = new PIXI.Text("", {
        fill: 0x000000,
        fontSize: 14,
      });
      labelText.x = 12;
      labelText.y = y;
      container.addChild(labelText);

      const barBg = new PIXI.Graphics()
        .beginFill(0x555555)
        .drawRoundedRect(12, y + 16, meterWidth, meterHeight, 4)
        .endFill();
      container.addChild(barBg);

      const barFill = new PIXI.Graphics();
      container.addChild(barFill);

      meterViews.push({
        meter,
        labelText,
        barFill,
        width: meterWidth,
      });

      y += 32;
    }

    updateMeters(meterViews, inst);
    return { meterViews, nextY: y };
  }

  function updateMeters(meterViews, inst) {
    for (const mv of meterViews) {
      const { meter, labelText, barFill, width } = mv;
      let ratio = 0;
      let label = "";

      if (meter.kind === "timerProgress") {
        const timerKey = meter.timerKey || "timer";
        const periodKey = meter.periodKey || "timerPeriod";
        const timer = inst.props?.[timerKey] ?? 0;
        const period = inst.props?.[periodKey] ?? 1;
        const elapsed = period - timer;
        ratio = Math.max(0, Math.min(1, elapsed / Math.max(1, period)));
        label = `${meter.label}: ${elapsed.toFixed(1)}/${period.toFixed(1)}s`;
      } else {
        const prop = meter.prop;
        const value = inst.props?.[prop] ?? 0;
        const max = inst.props?.[`_${prop}Max`] ?? Math.max(1, value);
        ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
        label = `${meter.label}: ${value}/${max}`;
      }

      labelText.text = label;
      barFill.clear();
      barFill.beginFill(0x00ff00);
      barFill.drawRoundedRect(12, labelText.y + 16, width * ratio, 8, 4);
      barFill.endFill();
    }
  }

  // --------------------------------------------------------
  // Build env view
  // --------------------------------------------------------

  function buildEnvView(envInst) {
    const { title, lines, color, meters } = getEnvUi(envInst);

    const cont = new PIXI.Container();
    cont.eventMode = "static";
    cont.cursor = "pointer";

    cont.addChild(
      new PIXI.Graphics()
        .beginFill(0x444444)
        .drawRoundedRect(0, 0, ENV_WIDTH, ENV_HEIGHT, 12)
        .endFill()
    );

    cont.addChild(
      new PIXI.Graphics()
        .beginFill(color)
        .drawRoundedRect(4, 4, ENV_WIDTH - 8, ENV_HEIGHT - 8, 10)
        .endFill()
    );

    const titleText = new PIXI.Text(title, {
      fill: 0xffffff,
      fontSize: 20,
      wordWrap: true,
      wordWrapWidth: ENV_WIDTH - 20,
    });
    titleText.x = 10;
    titleText.y = 8;
    cont.addChild(titleText);

    let y = titleText.y + titleText.height + 4;
    for (const line of lines) {
      const t = new PIXI.Text(line, {
        fill: 0x000000,
        fontSize: 12,
        wordWrap: true,
        wordWrapWidth: ENV_WIDTH - 20,
      });
      t.x = 10;
      t.y = y;
      cont.addChild(t);
      y += t.height + 2;
    }

    let meterViews = [];
    if (meters.length > 0) {
      meterViews = createMeters(
        cont,
        meters,
        envInst,
        y + 2,
        ENV_WIDTH - 24
      ).meterViews;
    }

    cont.on("pointerenter", () => {
      if (!opts.interaction || !opts.interaction.canShowHoverUI()) return;

      tooltipView.show(
        { title, lines },
        { x: cont.x, y: cont.y, width: ENV_WIDTH, height: ENV_HEIGHT }
      );
    });

    cont.on("pointerleave", () => {
      tooltipView.hide();
    });

    envLayer.addChild(cont);
    return { container: cont, env: envInst, meterViews };
  }

  // --------------------------------------------------------
  // Build permanent view (RESTORES inventory hover/pin)
  // --------------------------------------------------------

  function buildPermanentView(permInst) {
    const { title, lines, color, meters } = getPermUi(permInst);

    const cont = new PIXI.Container();
    cont.eventMode = "static";
    cont.cursor = "pointer";

    cont.addChild(
      new PIXI.Graphics()
        .beginFill(0x444444)
        .drawRoundedRect(0, 0, PERM_WIDTH, PERM_HEIGHT, 16)
        .endFill()
    );

    cont.addChild(
      new PIXI.Graphics()
        .beginFill(color)
        .drawRoundedRect(4, 4, PERM_WIDTH - 8, PERM_HEIGHT - 8, 14)
        .endFill()
    );

    const titleText = new PIXI.Text(title, {
      fill: 0xffffff,
      fontSize: 22,
      wordWrap: true,
      wordWrapWidth: PERM_WIDTH - 20,
    });
    titleText.x = 12;
    titleText.y = 10;
    cont.addChild(titleText);

    let y = titleText.y + titleText.height + 4;
    for (const line of lines) {
      const t = new PIXI.Text(line, {
        fill: 0x000000,
        fontSize: 13,
        wordWrap: true,
        wordWrapWidth: PERM_WIDTH - 22,
      });
      t.x = 10;
      t.y = y;
      cont.addChild(t);
      y += t.height + 2;
    }

    let meterViews = [];
    if (meters.length > 0) {
      meterViews = createMeters(
        cont,
        meters,
        permInst,
        y + 4,
        PERM_WIDTH - 28
      ).meterViews;
    }

    function permHasInventory() {
      const s = getGameState();
      return !!s?.ownerInventories?.[permInst.instanceId];
    }

    cont.on("pointerenter", () => {
      if (!opts.interaction || !opts.interaction.canShowHoverUI()) return;

      tooltipView.show(
        { title, lines },
        { x: cont.x, y: cont.y, width: PERM_WIDTH, height: PERM_HEIGHT }
      );

      if (inventoryView && permHasInventory()) {
        inventoryView.showOnHover(permInst.instanceId, {
          x: cont.x,
          y: cont.y,
          width: PERM_WIDTH,
          height: PERM_HEIGHT,
        });
      }
    });

    cont.on("pointerleave", () => {
      tooltipView.hide();
      if (inventoryView && permHasInventory()) {
        inventoryView.hideOnHoverOut(permInst.instanceId);
      }
    });

    cont.on("pointertap", () => {
      if (inventoryView && permHasInventory()) {
        inventoryView.togglePinned(permInst.instanceId);
      }
    });

    permanentsLayer.addChild(cont);
    return { container: cont, perm: permInst, meterViews };
  }

  // --------------------------------------------------------
  // rebuildAll
  // --------------------------------------------------------

  function rebuildAll() {
    envLayer.removeChildren();
    permanentsLayer.removeChildren();
    envViews.length = 0;
    permViews.clear();

    const s = getGameState();

    // env
    for (let i = 0; i < s.envSlots.length; i++) {
      const slot = s.envSlots[i];
      if (!slot.env) continue;

      const view = buildEnvView(slot.env);
      const pos = layoutEnvPos(i, s.envSlots.length);
      view.container.x = pos.x;
      view.container.y = pos.y;
      envViews[i] = view;
    }

    // permanents
    for (let i = 0; i < s.permanentSlots.length; i++) {
      const slot = s.permanentSlots[i];
      if (!slot.permanent) continue;

      const view = buildPermanentView(slot.permanent);

      // Step 9: shared permanent-row layout
      const pos = layoutPermPosShared(
        app.screen.width,
        i,
        s.permanentSlots.length
      );
      view.container.x = pos.x;
      view.container.y = pos.y; // PERM_ROW_Y from layout-pixi.js

      permViews.set(slot.permanent.instanceId, view);
    }
  }

  // --------------------------------------------------------
  // update
  // --------------------------------------------------------

  function update() {
    const s = getGameState();

    // --- keep env card views in sync with model ---
    for (let i = 0; i < s.envSlots.length; i++) {
      const slotEnv = s.envSlots[i].env;
      const view = envViews[i];

      // remove view if env removed
      if (!slotEnv) {
        if (view) {
          envLayer.removeChild(view.container);
          envViews[i] = undefined;
        }
        continue;
      }

      // rebuild view if env instance changed
      if (!view || view.env.instanceId !== slotEnv.instanceId) {
        if (view) envLayer.removeChild(view.container);

        const newView = buildEnvView(slotEnv);
        const pos = layoutEnvPos(i, s.envSlots.length);
        newView.container.x = pos.x;
        newView.container.y = pos.y;
        envViews[i] = newView;
      }
    }

    // existing meter updates...
    for (let i = 0; i < s.envSlots.length; i++) {
      const view = envViews[i];
      if (view && view.meterViews.length > 0) {
        updateMeters(view.meterViews, view.env);
      }
    }

    for (const view of permViews.values()) {
      if (view.meterViews.length > 0) {
        updateMeters(view.meterViews, view.perm);
      }
    }
  }

  function init() {}

  return { init, rebuildAll, update };
}

// --------------------------------------------------------
// Layout constants (VIEW-ONLY)
// --------------------------------------------------------

const ENV_WIDTH = 220;
const ENV_HEIGHT = 130;
const ENV_GAP = 40;

/**
 * @typedef {Object} BoardEnvView
 * @property {PIXI.Container} container
 * @property {any} env
 * @property {Array<any>} meterViews
 *
 * @typedef {Object} BoardPermView
 * @property {PIXI.Container} container
 * @property {any} perm
 * @property {Array<any>} meterViews
 */

