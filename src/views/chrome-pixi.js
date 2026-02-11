// chrome-pixi.js
// HUD + control buttons (pause).

import {
  SEASON_DISPLAY,
  AP_INCOME_PER_SEC,
  AP_INCOME_MULT_WAXING,
  AP_INCOME_MULT_WANING,
} from "../defs/gamesettings/gamerules-defs.js";
import { isMoonWaxingAtSecond } from "../model/moon.js";
import { getTotalFoodFromEdibles } from "../model/query.js";
import { createTimeLeverView } from "./time-lever-pixi.js";

export function createChromeView({
  app,
  layer,
  getGameState,
  getCurrentSeasonData,
  togglePause,
  isPausePending,
  getApPreview,

  // Stage 3: optional click handlers for opening graphs
  onGoldClick,
  onFoodClick,
  onApClick,
  onPopClick,

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

  const foodHit = new PIXI.Graphics();
  foodHit.eventMode = "static";
  foodHit.cursor = "pointer";
  foodHit.alpha = 0;
  layer.addChild(foodHit);

  foodHit.on("pointertap", () => {
    if (typeof onFoodClick === "function") onFoodClick();
  });

  const apHit = new PIXI.Graphics();
  apHit.eventMode = "static";
  apHit.cursor = "pointer";
  apHit.alpha = 0;
  layer.addChild(apHit);

  apHit.on("pointertap", () => {
    if (typeof onApClick === "function") onApClick();
  });

  const popHit = new PIXI.Graphics();
  popHit.eventMode = "static";
  popHit.cursor = "pointer";
  popHit.alpha = 0;
  layer.addChild(popHit);

  popHit.on("pointertap", () => {
    if (typeof onPopClick === "function") onPopClick();
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
    const baseY = app.screen.height - 70;
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

  function measureTextWidth(text) {
    const metrics = PIXI.TextMetrics?.measureText?.(text, resourceText.style);
    if (metrics && Number.isFinite(metrics.width)) return metrics.width;
    const fontSize = Number(resourceText.style?.fontSize) || 16;
    return text.length * fontSize * 0.6;
  }

  function update() {
    const s = getGameState();
    const preview =
      typeof getApPreview === "function" ? getApPreview() : null;

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
    const tSec = Math.floor(s.tSec ?? 0);
    const moonWaxing = isMoonWaxingAtSecond(tSec);
    const moonPhaseLabel = moonWaxing ? "Waxing" : "Waning";
    const baseIncome = Number.isFinite(AP_INCOME_PER_SEC)
      ? AP_INCOME_PER_SEC
      : 0;
    const incomeMult = moonWaxing
      ? AP_INCOME_MULT_WAXING
      : AP_INCOME_MULT_WANING;
    const incomeMultSafe = Number.isFinite(incomeMult) ? incomeMult : 0;
    const apIncomePerSec = s.apCapOverride?.enabled
      ? baseIncome
      : baseIncome * Math.max(0, incomeMultSafe);
    const apIncomeLabel = Number.isFinite(apIncomePerSec)
      ? apIncomePerSec.toFixed(1)
      : "0.0";

    const edibleFood = getTotalFoodFromEdibles(s);
    const baseFood = Number.isFinite(s.resources.food) ? s.resources.food : 0;
    const foodTotal = baseFood + edibleFood;

    resourceText.text = `Gold: ${s.resources.gold.toFixed(
      1
    )}  Food: ${foodTotal.toFixed(1)}  Pop: ${s.resources.population.toFixed(
      1
    )}  `;

    const goldSegment = `Gold: ${s.resources.gold.toFixed(1)}  `;
    const foodSegment = `Food: ${foodTotal.toFixed(1)}  `;
    const popSegment = `Pop: ${s.resources.population.toFixed(1)}  `;

    const goldWidth = measureTextWidth(goldSegment);
    const foodWidth = measureTextWidth(foodSegment);
    const popWidth = measureTextWidth(popSegment);

    // Position and size the gold hit area over the left section of the HUD line.
    const gx = resourceText.x;
    const gy = resourceText.y;
    const hitH = 34;
    const hitW = Math.max(1, Math.ceil(goldWidth));

    goldHit.clear();
    goldHit.beginFill(0xffffff);
    goldHit.drawRect(gx, gy - 2, hitW, hitH);
    goldHit.endFill();

    // Only show pointer cursor/click affordance if handler exists
    goldHit.eventMode = typeof onGoldClick === "function" ? "static" : "none";
    goldHit.cursor = typeof onGoldClick === "function" ? "pointer" : "default";

    const foodHitW = Math.max(1, Math.ceil(foodWidth));
    const foodHitX = gx + hitW;
    foodHit.clear();
    foodHit.beginFill(0xffffff);
    foodHit.drawRect(foodHitX, gy - 2, foodHitW, hitH);
    foodHit.endFill();

    foodHit.eventMode = typeof onFoodClick === "function" ? "static" : "none";
    foodHit.cursor = typeof onFoodClick === "function" ? "pointer" : "default";

    const popHitW = Math.max(1, Math.ceil(popWidth));
    const popHitX = foodHitX + foodHitW;
    popHit.clear();
    popHit.beginFill(0xffffff);
    popHit.drawRect(popHitX, gy - 2, popHitW, hitH);
    popHit.endFill();

    popHit.eventMode = typeof onPopClick === "function" ? "static" : "none";
    popHit.cursor = typeof onPopClick === "function" ? "pointer" : "default";

    const apHitW = 150;
    const apHitX = Math.max(gx, gx + resourceText.width - apHitW);
    apHit.clear();
    apHit.beginFill(0xffffff);
    apHit.drawRect(apHitX, gy - 2, apHitW, hitH);
    apHit.endFill();

    apHit.eventMode = typeof onApClick === "function" ? "static" : "none";
    apHit.cursor = typeof onApClick === "function" ? "pointer" : "default";
    const yearLabel = Number.isFinite(s.year) ? s.year : 1;
    deckInfoText.text = `Moon: ${moonPhaseLabel}  AP Income: +${apIncomeLabel}/s  Year: ${yearLabel}  Season: ${seasonName}  Deck: ${
      deck?.deck.length ?? 0
    }  Phase: ${phaseLabel}  SeasonLength: ${s.seasonTimeRemaining.toFixed(
      1
    )}`;

    timeLeverView.update(s);
  }

  function init() {}
  function refresh() {}

  return { init, refresh, update };
}

