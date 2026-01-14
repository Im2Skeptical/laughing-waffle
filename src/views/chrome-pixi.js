// chrome-pixi.js
// HUD + control buttons (pause).

import { SEASON_DISPLAY } from "../defs/defs.js";

export function createChromeView({
  app,
  layer,
  getGameState,
  getCurrentSeasonData,
  togglePause,
  isPausePending,

  // Stage 3: optional click handler for opening the gold graph
  onGoldClick,
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

  const pauseButton = makeButton("Pause", () => {
    togglePause();
  });

  const buttons = [pauseButton];

  function layoutButtons() {
    if (!buttons.length) return;

    const BUTTON_WIDTH = 140;
    const gap = 24;
    const totalWidth =
      BUTTON_WIDTH * buttons.length + gap * (buttons.length - 1);
    const startX = (app.screen.width - totalWidth) / 2;
    const y = app.screen.height - 120;

    buttons.forEach((btn, i) => {
      btn.x = startX + i * (BUTTON_WIDTH + gap);
      btn.y = y;
    });
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
    deckInfoText.text = `Turn: ${s.turn}  Season: ${seasonName}  Deck: ${
      deck?.deck.length ?? 0
    }  Discard: ${
      deck?.discard.length ?? 0
    }  Phase: ${phaseLabel}  SeasonLength: ${s.seasonTimeRemaining.toFixed(
      1
    )}`;
  }

  function init() {}
  function refresh() {}

  return { init, refresh, update };
}
