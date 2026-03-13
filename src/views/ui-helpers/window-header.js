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
    pinControlMode = "text",
    pinText = "[ ]",
    pinTextPinned = "[*]",
    pinStyle = { fill: MUCHA_UI_COLORS.ink.primary, fontSize: 12 },
    pinButtonWidth = 42,
    pinButtonHeight = 16,
    pinButtonRadius = 4,
    pinButtonBg = MUCHA_UI_COLORS.surfaces.panel,
    pinButtonBgHover = MUCHA_UI_COLORS.surfaces.panelSoft,
    pinButtonBgPinned = MUCHA_UI_COLORS.surfaces.panelSoft,
    pinButtonBgPinnedHover = MUCHA_UI_COLORS.surfaces.panelRaised,
    pinButtonStroke = MUCHA_UI_COLORS.surfaces.border,
    pinButtonStrokePinned = MUCHA_UI_COLORS.surfaces.border,
    pinButtonTextOff = MUCHA_UI_COLORS.ink.primary,
    pinButtonTextPinned = MUCHA_UI_COLORS.ink.primary,
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
  let pinButton = null;
  let pinButtonBgGraphic = null;
  let pinHovered = false;
  let pinIsPinned = false;

  function drawPinButton(buttonWidth, buttonHeight) {
    if (!pinButtonBgGraphic) return;
    const active = pinIsPinned === true;
    const fill = active
      ? pinHovered
        ? pinButtonBgPinnedHover
        : pinButtonBgPinned
      : pinHovered
        ? pinButtonBgHover
        : pinButtonBg;
    const stroke = active ? pinButtonStrokePinned : pinButtonStroke;
    pinButtonBgGraphic.clear();
    pinButtonBgGraphic
      .lineStyle(1, stroke, 0.95)
      .beginFill(fill, 0.98)
      .drawRoundedRect(
        0,
        0,
        buttonWidth,
        buttonHeight,
        Math.max(0, pinButtonRadius)
      )
      .endFill();
  }

  if (showPin) {
    pinNode = new PIXI.Text(pinText, pinStyle);
    if (pinControlMode === "button") {
      pinNode.eventMode = "none";
      pinButton = new PIXI.Container();
      pinButton.eventMode = "static";
      pinButton.cursor = "pointer";
      pinButtonBgGraphic = new PIXI.Graphics();
      pinButton.addChild(pinButtonBgGraphic);
      pinButton.addChild(pinNode);
      pinButton.on("pointerover", () => {
        pinHovered = true;
        drawPinButton(
          Math.max(30, Math.floor(pinButtonWidth)),
          Math.max(14, Math.floor(pinButtonHeight))
        );
      });
      pinButton.on("pointerout", () => {
        pinHovered = false;
        drawPinButton(
          Math.max(30, Math.floor(pinButtonWidth)),
          Math.max(14, Math.floor(pinButtonHeight))
        );
      });
      pinButton.on("pointerdown", (ev) => ev?.stopPropagation?.());
      pinButton.on("pointertap", (ev) => {
        ev?.stopPropagation?.();
        onPinToggle?.();
      });
      header.addChild(pinButton);
    } else {
      pinNode.eventMode = "static";
      pinNode.cursor = "pointer";
      pinNode.on("pointerdown", (ev) => ev?.stopPropagation?.());
      pinNode.on("pointertap", (ev) => {
        ev?.stopPropagation?.();
        onPinToggle?.();
      });
      header.addChild(pinNode);
    }
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
    if (pinNode && pinButton) {
      const buttonWidth = Math.max(30, Math.floor(pinButtonWidth));
      const buttonHeight = Math.max(
        14,
        Math.min(height - 4, Math.floor(pinButtonHeight))
      );
      if (closeButton) {
        pinButton.x = Math.max(0, closeButton.x - buttonWidth - 8);
      } else {
        pinButton.x = Math.max(0, currentWidth - pinOffsetX - buttonWidth);
      }
      pinButton.y = Math.floor((height - buttonHeight) / 2);
      pinButton.hitArea = new PIXI.Rectangle(0, 0, buttonWidth, buttonHeight);
      drawPinButton(buttonWidth, buttonHeight);
      pinNode.style.fill = pinIsPinned ? pinButtonTextPinned : pinButtonTextOff;
      pinNode.x = Math.floor((buttonWidth - pinNode.width) / 2);
      pinNode.y = Math.floor((buttonHeight - pinNode.height) / 2);
    } else if (pinNode) {
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

  function toDragParentLocal(globalPoint) {
    if (!dragTarget?.parent || !globalPoint) return null;
    if (typeof dragTarget.parent.toLocal === "function") {
      return dragTarget.parent.toLocal(globalPoint);
    }
    return {
      x: Number(globalPoint.x) || 0,
      y: Number(globalPoint.y) || 0,
    };
  }

  function onDragMove(ev) {
    if (!dragState.active || !dragTarget) return;
    const g = ev?.data?.global;
    if (!g) return;
    const local = toDragParentLocal(g);
    if (!local) return;
    dragTarget.x = local.x - dragState.offsetX;
    dragTarget.y = local.y - dragState.offsetY;
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
    const local = toDragParentLocal(g);
    if (!local) return;
    dragState.active = true;
    dragState.offsetX = local.x - dragTarget.x;
    dragState.offsetY = local.y - dragTarget.y;
    stage.on("pointermove", onDragMove);
    stage.on("pointerup", onDragEndInternal);
    stage.on("pointerupoutside", onDragEndInternal);
    onDragStart?.(ev);
  });

  function setPinned(pinned) {
    if (!pinNode) return;
    pinIsPinned = pinned === true;
    pinNode.text = pinIsPinned ? pinTextPinned : pinText;
    if (pinButton) {
      redraw();
    }
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
