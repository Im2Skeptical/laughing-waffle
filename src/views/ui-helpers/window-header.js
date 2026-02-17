// window-header.js
// Shared draggable header with pin + close controls.

export function createWindowHeader(opts = {}) {
  const {
    stage,
    parent,
    width,
    height = 22,
    radius = 8,
    background = 0x303048,
    title = "",
    titleStyle = { fill: 0xffffff, fontSize: 12 },
    paddingX = 8,
    paddingY = 4,
    showPin = true,
    showClose = true,
    pinText = "[ ]",
    pinTextPinned = "[*]",
    pinStyle = { fill: 0xffffff, fontSize: 12 },
    closeText = "x",
    closeStyle = { fill: 0xffffff, fontSize: 12 },
    pinOffsetX = 40,
    closeOffsetX = 20,
    hitAreaTopPadding = 0,
    hitAreaBottomPadding = 0,
    dragTarget,
    canDrag,
    onDragStart,
    onDragEnd,
    onPinToggle,
    onClose,
  } = opts;

  const header = new PIXI.Container();
  if (parent) parent.addChild(header);

  const bg = new PIXI.Graphics();
  header.addChild(bg);

  const titleText = new PIXI.Text(title, titleStyle);
  titleText.x = paddingX;
  titleText.y = paddingY;
  header.addChild(titleText);

  let pinNode = null;
  if (showPin) {
    pinNode = new PIXI.Text(pinText, pinStyle);
    pinNode.eventMode = "static";
    pinNode.cursor = "pointer";
    pinNode.on("pointerdown", (ev) => ev?.stopPropagation?.());
    pinNode.on("pointertap", (ev) => {
      ev?.stopPropagation?.();
      onPinToggle?.();
    });
    header.addChild(pinNode);
  }

  let closeNode = null;
  if (showClose) {
    closeNode = new PIXI.Text(closeText, closeStyle);
    closeNode.eventMode = "static";
    closeNode.cursor = "pointer";
    closeNode.on("pointerdown", (ev) => ev?.stopPropagation?.());
    closeNode.on("pointertap", (ev) => {
      ev?.stopPropagation?.();
      onClose?.();
    });
    header.addChild(closeNode);
  }

  let currentWidth = Number.isFinite(width) ? width : 0;
  function redraw() {
    bg.clear();
    bg.beginFill(background);
    bg.drawRoundedRect(0, 0, currentWidth, height, radius);
    bg.endFill();
    const topPad = Math.max(0, Math.floor(hitAreaTopPadding || 0));
    const bottomPad = Math.max(0, Math.floor(hitAreaBottomPadding || 0));
    header.hitArea = new PIXI.Rectangle(
      0,
      -topPad,
      currentWidth,
      height + topPad + bottomPad
    );

    if (pinNode) {
      pinNode.x = currentWidth - pinOffsetX;
      pinNode.y = paddingY;
    }
    if (closeNode) {
      closeNode.x = currentWidth - closeOffsetX;
      closeNode.y = paddingY;
    }
  }

  redraw();

  header.eventMode = "static";
  header.cursor = dragTarget ? "move" : "default";

  const dragState = {
    active: false,
    offsetX: 0,
    offsetY: 0,
  };

  function onDragMove(ev) {
    if (!dragState.active || !dragTarget) return;
    const g = ev?.data?.global;
    if (!g) return;
    dragTarget.x = g.x - dragState.offsetX;
    dragTarget.y = g.y - dragState.offsetY;
  }

  function onDragEndInternal() {
    if (!dragState.active) return;
    dragState.active = false;
    stage?.off?.("pointermove", onDragMove);
    stage?.off?.("pointerup", onDragEndInternal);
    stage?.off?.("pointerupoutside", onDragEndInternal);
    onDragEnd?.();
  }

  header.on("pointerdown", (ev) => {
    if (!dragTarget || !stage) return;
    if (typeof canDrag === "function" && !canDrag()) return;
    const g = ev?.data?.global;
    if (!g) return;
    dragState.active = true;
    dragState.offsetX = g.x - dragTarget.x;
    dragState.offsetY = g.y - dragTarget.y;
    stage.on("pointermove", onDragMove);
    stage.on("pointerup", onDragEndInternal);
    stage.on("pointerupoutside", onDragEndInternal);
    onDragStart?.(ev);
  });

  function setPinned(pinned) {
    if (!pinNode) return;
    pinNode.text = pinned ? pinTextPinned : pinText;
  }

  function setTitle(nextTitle) {
    if (typeof nextTitle !== "string") return;
    titleText.text = nextTitle;
  }

  function setWidth(nextWidth) {
    if (!Number.isFinite(nextWidth)) return;
    currentWidth = Math.max(0, Math.floor(nextWidth));
    redraw();
  }

  return {
    container: header,
    bg,
    titleText,
    pinText: pinNode,
    closeText: closeNode,
    setPinned,
    setTitle,
    setWidth,
  };
}
