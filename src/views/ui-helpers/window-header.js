// window-header.js
// Shared draggable header with pin + close controls.
import { MUCHA_UI_COLORS } from "./mucha-ui-palette.js";

export function createWindowHeader(opts = {}) {
  const {
    stage,
    parent,
    width,
    height = 22,
    radius = 8,
    background = MUCHA_UI_COLORS.surfaces.header,
    title = "",
    titleStyle = { fill: MUCHA_UI_COLORS.ink.primary, fontSize: 12 },
    paddingX = 8,
    paddingY = 4,
    showPin = true,
    showClose = true,
    pinText = "[ ]",
    pinTextPinned = "[*]",
    pinStyle = { fill: MUCHA_UI_COLORS.ink.primary, fontSize: 12 },
    closeText = "x",
    closeStyle = { fill: MUCHA_UI_COLORS.ink.primary, fontSize: 12 },
    closeButtonWidth = 42,
    closeButtonHeight = 16,
    closeButtonRadius = 4,
    closeButtonBg = MUCHA_UI_COLORS.intent.warnPop,
    closeButtonBgHover = MUCHA_UI_COLORS.intent.dangerPop,
    closeButtonStroke = MUCHA_UI_COLORS.accents.cream,
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
  let closeButton = null;
  let closeButtonBgGraphic = null;
  let closeHovered = false;

  function drawCloseButton(buttonWidth, buttonHeight) {
    if (!closeButtonBgGraphic) return;
    closeButtonBgGraphic.clear();
    closeButtonBgGraphic
      .lineStyle(1, closeButtonStroke, 0.95)
      .beginFill(closeHovered ? closeButtonBgHover : closeButtonBg, 0.98)
      .drawRoundedRect(
        0,
        0,
        buttonWidth,
        buttonHeight,
        Math.max(0, closeButtonRadius)
      )
      .endFill();
  }

  if (showClose) {
    closeNode = new PIXI.Text(closeText, closeStyle);
    closeNode.eventMode = "none";

    closeButton = new PIXI.Container();
    closeButton.eventMode = "static";
    closeButton.cursor = "pointer";
    closeButtonBgGraphic = new PIXI.Graphics();
    closeButton.addChild(closeButtonBgGraphic);
    closeButton.addChild(closeNode);
    closeButton.on("pointerover", () => {
      closeHovered = true;
      drawCloseButton(
        Math.max(30, Math.floor(closeButtonWidth)),
        Math.max(14, Math.floor(closeButtonHeight))
      );
    });
    closeButton.on("pointerout", () => {
      closeHovered = false;
      drawCloseButton(
        Math.max(30, Math.floor(closeButtonWidth)),
        Math.max(14, Math.floor(closeButtonHeight))
      );
    });
    closeButton.on("pointerdown", (ev) => ev?.stopPropagation?.());
    closeButton.on("pointertap", (ev) => {
      ev?.stopPropagation?.();
      onClose?.();
    });
    header.addChild(closeButton);
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

    if (closeNode && closeButton) {
      const buttonWidth = Math.max(30, Math.floor(closeButtonWidth));
      const buttonHeight = Math.max(
        14,
        Math.min(height - 4, Math.floor(closeButtonHeight))
      );
      closeButton.x = Math.max(0, currentWidth - closeOffsetX - buttonWidth);
      closeButton.y = Math.floor((height - buttonHeight) / 2);
      closeButton.hitArea = new PIXI.Rectangle(0, 0, buttonWidth, buttonHeight);
      drawCloseButton(buttonWidth, buttonHeight);
      closeNode.x = Math.floor((buttonWidth - closeNode.width) / 2);
      closeNode.y = Math.floor((buttonHeight - closeNode.height) / 2);
    }
    if (pinNode) {
      const preferredPinX = currentWidth - pinOffsetX;
      if (closeButton) {
        pinNode.x = Math.min(
          preferredPinX,
          closeButton.x - Math.max(8, pinNode.width + 6)
        );
      } else {
        pinNode.x = preferredPinX;
      }
      pinNode.y = paddingY;
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
    closeButton,
    setPinned,
    setTitle,
    setWidth,
  };
}
