// chrome-pixi.js
// Topbar chrome: year display only.

import { VIEWPORT_DESIGN_HEIGHT, VIEWPORT_DESIGN_WIDTH } from "./layout-pixi.js";

const TOPBAR_HEIGHT_RATIO = 0.048;
const TOPBAR_HEIGHT_MIN = 42;
const TOPBAR_HEIGHT_MAX = 58;
const PLATE_WIDTH_RATIO = 0.26;
const PLATE_WIDTH_MIN = 280;
const PLATE_WIDTH_MAX = 520;

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function getScreenWidth(app) {
  const width = Math.floor(app?.screen?.width ?? VIEWPORT_DESIGN_WIDTH);
  return Math.max(1, width);
}

function getScreenHeight(app) {
  const height = Math.floor(app?.screen?.height ?? VIEWPORT_DESIGN_HEIGHT);
  return Math.max(1, height);
}

export function createChromeView({ app, layer, getGameState }) {
  const root = new PIXI.Container();
  root.eventMode = "none";
  layer?.addChild(root);

  const topbarBg = new PIXI.Graphics();
  const centerPlate = new PIXI.Graphics();
  const centerPlateAccents = new PIXI.Graphics();
  root.addChild(topbarBg, centerPlate, centerPlateAccents);

  const yearText = new PIXI.Text("", {
    fill: 0xf0ece1,
    fontFamily: "Trebuchet MS",
    fontSize: 28,
    fontWeight: "700",
  });
  yearText.anchor.set(0.5, 0.5);
  root.addChild(yearText);

  let lastScreenWidth = -1;
  let lastScreenHeight = -1;
  let lastYearLabel = "";

  function applyLayout() {
    const screenWidth = getScreenWidth(app);
    const screenHeight = getScreenHeight(app);
    lastScreenWidth = screenWidth;
    lastScreenHeight = screenHeight;

    const barHeight = clamp(
      Math.round(screenHeight * TOPBAR_HEIGHT_RATIO),
      TOPBAR_HEIGHT_MIN,
      TOPBAR_HEIGHT_MAX
    );
    const plateWidth = clamp(
      Math.round(screenWidth * PLATE_WIDTH_RATIO),
      PLATE_WIDTH_MIN,
      PLATE_WIDTH_MAX
    );
    const plateHeight = barHeight + 12;
    const plateX = Math.round((screenWidth - plateWidth) * 0.5);
    const plateY = 4;

    topbarBg.clear();
    topbarBg.beginFill(0x3b3639, 0.96);
    topbarBg.drawRect(0, 0, screenWidth, barHeight);
    topbarBg.endFill();
    topbarBg.lineStyle(1, 0x7a6f66, 0.65);
    topbarBg.moveTo(0, barHeight - 0.5);
    topbarBg.lineTo(screenWidth, barHeight - 0.5);

    centerPlate.clear();
    centerPlate.lineStyle(2, 0x72695f, 0.9);
    centerPlate.beginFill(0x5a5552, 0.98);
    centerPlate.drawRoundedRect(plateX, plateY, plateWidth, plateHeight, 12);
    centerPlate.endFill();

    centerPlateAccents.clear();
    centerPlateAccents.lineStyle(3, 0xb8a048, 0.85);
    const accentY = Math.round(plateY + plateHeight * 0.5);
    const accentInset = 34;
    const accentLen = 46;
    const leftStartX = plateX + accentInset;
    const rightStartX = plateX + plateWidth - accentInset;
    centerPlateAccents.moveTo(leftStartX, accentY);
    centerPlateAccents.bezierCurveTo(
      leftStartX - 10,
      accentY - 12,
      leftStartX - 26,
      accentY + 12,
      leftStartX - accentLen,
      accentY
    );
    centerPlateAccents.moveTo(rightStartX, accentY);
    centerPlateAccents.bezierCurveTo(
      rightStartX + 10,
      accentY - 12,
      rightStartX + 26,
      accentY + 12,
      rightStartX + accentLen,
      accentY
    );

    yearText.style.fontSize = clamp(Math.round(barHeight * 0.58), 22, 34);
    yearText.position.set(Math.round(screenWidth * 0.5), Math.round(plateY + plateHeight * 0.5));
  }

  function update() {
    const state = typeof getGameState === "function" ? getGameState() : null;
    const year = Number.isFinite(state?.year) ? Math.max(1, Math.floor(state.year)) : 1;
    const nextYearLabel = `Year: ${year} AF`;
    if (nextYearLabel !== lastYearLabel) {
      yearText.text = nextYearLabel;
      lastYearLabel = nextYearLabel;
    }

    const screenWidth = getScreenWidth(app);
    const screenHeight = getScreenHeight(app);
    if (screenWidth !== lastScreenWidth || screenHeight !== lastScreenHeight) {
      applyLayout();
    }
  }

  function init() {
    applyLayout();
    update();
  }

  function refresh() {
    applyLayout();
  }

  return { init, refresh, update };
}
