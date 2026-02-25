import { VIEWPORT_DESIGN_HEIGHT, VIEWPORT_DESIGN_WIDTH } from "./layout-pixi.js";

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
  paintLayer.eventMode = "none";
  root.addChild(paintLayer);

  const baseFill = new PIXI.Graphics();
  const haloWarm = new PIXI.Graphics();
  const haloCool = new PIXI.Graphics();
  const haloSoft = new PIXI.Graphics();
  paintLayer.addChild(baseFill, haloWarm, haloCool, haloSoft);

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
    baseFill.beginFill(0x5a5349, 1);
    baseFill.drawRect(0, 0, width, height);
    baseFill.endFill();

    haloWarm.clear();
    haloWarm.beginFill(0xd9c79f, 0.14);
    haloWarm.drawEllipse(
      Math.round(width * 0.5),
      Math.round(height * 0.42),
      Math.round(width * 0.38),
      Math.round(height * 0.36)
    );
    haloWarm.endFill();

    haloCool.clear();
    haloCool.beginFill(0x8f877a, 0.08);
    haloCool.drawEllipse(
      Math.round(width * 0.25),
      Math.round(height * 0.62),
      Math.round(width * 0.24),
      Math.round(height * 0.22)
    );
    haloCool.drawEllipse(
      Math.round(width * 0.78),
      Math.round(height * 0.58),
      Math.round(width * 0.22),
      Math.round(height * 0.2)
    );
    haloCool.endFill();

    haloSoft.clear();
    haloSoft.beginFill(0xefe4ca, 0.05);
    haloSoft.drawEllipse(
      Math.round(width * 0.52),
      Math.round(height * 0.18),
      Math.round(width * 0.26),
      Math.round(height * 0.12)
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
    if (root.parent) root.parent.removeChild(root);
    root.destroy({ children: true });
  }

  return { init, refresh, update, destroy };
}
