export function createTooltipView({ layer, interaction }) {
  const container = new PIXI.Container();
  container.visible = false;

  // Tooltip must not intercept mouse events
  container.eventMode = "none";
  layer.addChild(container);

  const padding = 6;
  const defaultMaxWidth = 260;
  const bg = new PIXI.Graphics();
  container.addChild(bg);

  const DESIGN_WIDTH = 1920;
  const DESIGN_HEIGHT = 1080;

  let hideTimeoutId = null;

  function init() {}

  function show(spec, anchor) {
    const { title, lines = [], maxWidth = defaultMaxWidth } = spec;
    // anchor can be {x, y} or {x, y, width, height}
    const { x, y } = anchor;
    const aw = anchor.width ?? 0;
    const ah = anchor.height ?? 0;

    if (hideTimeoutId !== null) {
      clearTimeout(hideTimeoutId);
      hideTimeoutId = null;
    }

    while (container.children.length > 1) {
      container.removeChildAt(1);
    }
    bg.clear();

    const titleText = new PIXI.Text(title ?? "", {
      fill: 0xffffff,
      fontSize: 12,
      fontWeight: "bold",
      wordWrap: true,
      wordWrapWidth: maxWidth,
    });
    titleText.x = padding;
    titleText.y = padding;
    container.addChild(titleText);

    let cy = padding + titleText.height + 4;

    for (const line of lines) {
      if (!line) continue;
      const lt = new PIXI.Text(line, {
        fill: 0xffffff,
        fontSize: 11,
        wordWrap: true,
        wordWrapWidth: maxWidth,
      });
      lt.x = padding;
      lt.y = cy;
      container.addChild(lt);
      cy += lt.height + 2;
    }

    const totalWidth = maxWidth + padding * 2;
    const totalHeight = cy + padding;

    bg.beginFill(0x000000, 0.9);
    bg.drawRoundedRect(0, 0, totalWidth, totalHeight, 8);
    bg.endFill();

    // ------------ placement: LEFT of the anchor rect ------------
    const margin = 12;

    // default: to the left, vertically centred on the anchor rect
    let posX = x - totalWidth - margin;
    let posY = y + (ah ? (ah - totalHeight) / 2 : 0);

    // If that would go off-screen on the left, flip to the right side
    if (posX < 10) {
      posX = x + aw + margin;
    }

    // Clamp inside the design rect
    if (posX + totalWidth > DESIGN_WIDTH - 10) {
      posX = DESIGN_WIDTH - totalWidth - 10;
    }
    if (posY < 10) posY = 10;
    if (posY + totalHeight > DESIGN_HEIGHT - 10) {
      posY = DESIGN_HEIGHT - totalHeight - 10;
    }

    container.x = posX;
    container.y = posY;
    container.visible = true;
  }

  function hide() {
    if (hideTimeoutId !== null) {
      clearTimeout(hideTimeoutId);
    }
    hideTimeoutId = setTimeout(() => {
      container.visible = false;
      hideTimeoutId = null;
    }, 0);
  }

  function isVisible() {
    return container.visible;
  }

  function getContainer() {
    return container;
  }

  function update(dt) {}

  return {
    init,
    show,
    hide,
    isVisible,
    getContainer,
    update,
  };
}
