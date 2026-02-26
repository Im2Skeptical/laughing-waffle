import { VIEWPORT_DESIGN_HEIGHT, VIEWPORT_DESIGN_WIDTH } from "./layout-pixi.js";

const HALO_LAYER_ALPHA = 0.1;
const BACKDROP_THEME = Object.freeze({
  baseFill: 0x5a5349,
  warmHalo: 0xed6557,
  coolHalo: 0x809464,
  softHalo: 0xcc7d32,
});

function createHaloMergeFilter(alpha) {
  const AlphaFilterCtor = globalThis?.PIXI?.AlphaFilter;
  if (typeof AlphaFilterCtor !== "function") return null;
  try {
    return new AlphaFilterCtor(alpha);
  } catch (_) {
    return null;
  }
}

function getScreenWidth(app) {
  const width = Math.floor(app?.screen?.width ?? VIEWPORT_DESIGN_WIDTH);
  return Math.max(1, width);
}

function getScreenHeight(app) {
  const height = Math.floor(app?.screen?.height ?? VIEWPORT_DESIGN_HEIGHT);
  return Math.max(1, height);
}

export function createBackdropView({ app, layer, paintStyleController } = {}) {
  const root = new PIXI.Container();
  root.eventMode = "none";
  layer?.addChild(root);

  const paintLayer = new PIXI.Container();
  const haloLayer = new PIXI.Container();
  haloLayer.eventMode = "none";
  paintLayer.eventMode = "none";
  root.addChild(paintLayer);

  const baseFill = new PIXI.Graphics();
  const haloWarm = new PIXI.Graphics();
  const haloCool = new PIXI.Graphics();
  const haloSoft = new PIXI.Graphics();
  paintLayer.addChild(baseFill, haloLayer);
  haloLayer.addChild(haloWarm, haloCool, haloSoft);
  const haloMergeFilter = createHaloMergeFilter(HALO_LAYER_ALPHA);
  if (haloMergeFilter) {
    haloLayer.filters = [haloMergeFilter];
    haloLayer.alpha = 1;
  } else {
    haloLayer.alpha = HALO_LAYER_ALPHA;
  }

  let registered = false;
  let lastWidth = -1;
  let lastHeight = -1;

  function registerPaint() {
    if (registered) return;
    paintStyleController?.registerPaintContainer?.(paintLayer, {
      profile: "backdrop",
    });
    registered = true;
  }

  function unregisterPaint() {
    if (!registered) return;
    paintStyleController?.unregisterPaintContainer?.(paintLayer);
    registered = false;
  }

  function redraw() {
    const width = getScreenWidth(app);
    const height = getScreenHeight(app);
    lastWidth = width;
    lastHeight = height;

    baseFill.clear();
    baseFill.beginFill(BACKDROP_THEME.baseFill, 1);
    baseFill.drawRect(0, 0, width, height);
    baseFill.endFill();

    haloWarm.clear();
    haloWarm.beginFill(BACKDROP_THEME.warmHalo, 1.0);
    haloWarm.drawEllipse(
      Math.round(width * 0.7),
      Math.round(height * 0.72),
      Math.round(width * 0.6),
      Math.round(height * 0.5)
    );
    haloWarm.drawEllipse(
      Math.round(width * 0.6),
      Math.round(-height * .05),
      Math.round(width * 0.15),
      Math.round(height * 0.25)
    );
    haloWarm.endFill();

    haloCool.clear();
    haloCool.beginFill(BACKDROP_THEME.coolHalo, 1.0);
    haloCool.drawEllipse(
      Math.round(width * 0.05),
      Math.round(height * 0.82),
      Math.round(width * 0.24),
      Math.round(height * 0.4)
    );
    haloCool.drawEllipse(
      Math.round(width * 0.98),
      Math.round(height * 0.8),
      Math.round(width * 0.22),
      Math.round(height * 0.8)
    );
    haloCool.endFill();

    haloSoft.clear();
    haloSoft.beginFill(BACKDROP_THEME.softHalo, 1.0);
    haloSoft.drawEllipse(
      Math.round(width * 0.3),
      Math.round(height * 0.0),
      Math.round(width * 0.4),
      Math.round(height * 0.2)
    );
    haloSoft.drawEllipse(
      Math.round(width * 0.8),
      Math.round(height * 0.4),
      Math.round(width * 0.4),
      Math.round(height * 0.2)
    );
    haloSoft.endFill();

  }

  function update() {
    const width = getScreenWidth(app);
    const height = getScreenHeight(app);
    if (width !== lastWidth || height !== lastHeight) {
      redraw();
    }
  }

  function init() {
    registerPaint();
    redraw();
  }

  function refresh() {
    redraw();
  }

  function destroy() {
    unregisterPaint();
    haloLayer.filters = null;
    haloMergeFilter?.destroy?.();
    if (root.parent) root.parent.removeChild(root);
    root.destroy({ children: true });
  }

  return { init, refresh, update, destroy };
}
