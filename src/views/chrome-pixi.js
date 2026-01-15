// chrome-pixi.js
// HUD + control buttons (pause).

import { SEASON_DISPLAY } from "../defs/gamerules-defs.js";
import { createTimeLeverView } from "./time-lever-pixi.js";

export function createChromeView({
  app,
  layer,
  getGameState,
  getCurrentSeasonData,
  togglePause,
  isPausePending,

  // Stage 3: optional click handler for opening the gold graph
  onGoldClick,
  onApClick,

  // Time lever (optional)
  getTimeScale,
  setTimeScaleTarget,
}) {
  // ---------- 1. Text HUD ----------

  const resourceText = new PIXI.Text("", {
    fill: 0xffffff,
    fontSize: 26,
  });
  resourceText.position.set(40, 24);
  layer.addChild(resourceText);

  // Clickable hit area for the "Gold: X" region (left portion of the resource line)
  const goldHit = new PIXI.Graphics();
  goldHit.eventMode = "static";
  goldHit.cursor = "pointer";
  goldHit.alpha = 0; // invisible, but interactive
  layer.addChild(goldHit);

  goldHit.on("pointertap", () => {
    if (typeof onGoldClick === "function") onGoldClick();
  });

  const apHit = new PIXI.Graphics();
  apHit.eventMode = "static";
  apHit.cursor = "pointer";
  apHit.alpha = 0;
  layer.addChild(apHit);

  apHit.on("pointertap", () => {
    if (typeof onApClick === "function") onApClick();
  });

  const deckInfoText = new PIXI.Text("", {
    fill: 0xffffff,
    fontSize: 18,
  });
  deckInfoText.position.set(40, 60);
  layer.addChild(deckInfoText);

  // ---------- 2. Buttons ----------

  function makeButton(label, onClick) {
    const container = new PIXI.Container();

    const bg = new PIXI.Graphics()
      .beginFill(0x444444)
      .drawRoundedRect(0, 0, 140, 44, 10)
      .endFill();

    const text = new PIXI.Text(label, {
      fill: 0xffffff,
      fontSize: 18,
    });
    text.anchor.set(0.5, 0.5);
    text.position.set(70, 22);

    container.addChild(bg, text);

    container.eventMode = "static";
    container.cursor = "pointer";

    container.on("pointerover", () => {
      bg.tint = 0x888888;
    });
    container.on("pointerout", () => {
      bg.tint = 0xffffff;
    });
    container.on("pointertap", () => {
      onClick();
    });

    layer.addChild(container);
    return container;
  }

  const BUTTON_WIDTH = 140;
  const BUTTON_HEIGHT = 44;

  const pauseButton = makeButton("Pause", () => {
    togglePause();
  });

  const timeLeverView = createTimeLeverView({
    app,
    layer,
    getTimeScale,
    setTimeScaleTarget,
  });

  const controls = [
    { node: pauseButton, width: BUTTON_WIDTH, height: BUTTON_HEIGHT },
    {
      node: timeLeverView.container,
      width: timeLeverView.width,
      height: timeLeverView.height,
    },
  ];

  function layoutButtons() {
    const active = controls.filter((c) => c.node.visible !== false);
    if (!active.length) return;

    const gap = 24;
    const totalWidth =
      active.reduce((sum, c) => sum + c.width, 0) +
      gap * (active.length - 1);
    const startX = (app.screen.width - totalWidth) / 2;
    const baseY = app.screen.height - 120;
    const centerY = baseY + BUTTON_HEIGHT / 2;

    let x = startX;
    for (const c of active) {
      c.node.x = x;
      c.node.y = centerY - c.height / 2;
      x += c.width + gap;
    }
  }

  layoutButtons();

  // ---------- 3. HUD update ----------

  function update() {
    const s = getGameState();

    // Pause button label/state:
    // - paused => "Paused"
    // - pause requested but not yet committed (rides to next integer second) => "Pausing…"
    // - otherwise => "Pause"
    const pausePending =
      typeof isPausePending === "function" ? !!isPausePending() : false;
    const pauseLabel = pauseButton.children[1];
    const pauseBg = pauseButton.children[0];

    if (s.paused) {
      pauseLabel.text = "Paused";
      pauseBg.tint = 0x55aa55;
    } else if (pausePending) {
      pauseLabel.text = "Pausing…";
      pauseBg.tint = 0xffcc66;
    } else {
      pauseLabel.text = "Pause";
      pauseBg.tint = 0xffffff;
    }

    const seasonKey = s.seasons[s.currentSeasonIndex];
    const seasonName = SEASON_DISPLAY[seasonKey];
    const phaseLabel = s.phase === "planning" ? "Planning" : "Simulation";
    const deck = getCurrentSeasonData(s);

    // AP Tracker Logic
    const curAp = s.actionPoints ?? 0;
    const capAp = s.actionPointCap ?? 100;

    resourceText.text = `Gold: ${s.resources.gold.toFixed(
      1
    )}  Food: ${s.resources.food.toFixed(
      1
    )}  Pop: ${s.resources.population.toFixed(1)}  AP: ${curAp}/${capAp}`;

    // Position and size the gold hit area over the left section of the HUD line.
    // Approximate width for "Gold: 00000.0" plus padding.
    const gx = resourceText.x;
    const gy = resourceText.y;
    const hitW = 240;
    const hitH = 34;

    goldHit.clear();
    goldHit.beginFill(0xffffff);
    goldHit.drawRect(gx, gy - 2, hitW, hitH);
    goldHit.endFill();

    // Only show pointer cursor/click affordance if handler exists
    goldHit.eventMode = typeof onGoldClick === "function" ? "static" : "none";
    goldHit.cursor = typeof onGoldClick === "function" ? "pointer" : "default";

    const apHitW = 150;
    const apHitX = Math.max(gx, gx + resourceText.width - apHitW);
    apHit.clear();
    apHit.beginFill(0xffffff);
    apHit.drawRect(apHitX, gy - 2, apHitW, hitH);
    apHit.endFill();

    apHit.eventMode = typeof onApClick === "function" ? "static" : "none";
    apHit.cursor = typeof onApClick === "function" ? "pointer" : "default";
    deckInfoText.text = `Turn: ${s.turn}  Season: ${seasonName}  Deck: ${
      deck?.deck.length ?? 0
    }  Discard: ${
      deck?.discard.length ?? 0
    }  Phase: ${phaseLabel}  SeasonLength: ${s.seasonTimeRemaining.toFixed(
      1
    )}`;

    timeLeverView.update(s);
  }

  function init() {}
  function refresh() {}

  return { init, refresh, update };
}
