// button.js
// Shared button builder for skill tree view controls.

const BUTTON_VARIANTS = Object.freeze({
  idle: Object.freeze({ bg: 0x2a3350, text: 0xffffff }),
  pending: Object.freeze({ bg: 0x8a6f2c, text: 0xffffff }),
  saved: Object.freeze({ bg: 0x2d6f43, text: 0xffffff }),
  error: Object.freeze({ bg: 0x8a2b35, text: 0xffffff }),
});

export function makeButton(label, width, onTap) {
  const root = new PIXI.Container();
  root.eventMode = "static";
  root.cursor = "pointer";

  const bg = new PIXI.Graphics();
  root.addChild(bg);

  const text = new PIXI.Text(label, {
    fill: BUTTON_VARIANTS.idle.text,
    fontSize: 13,
    fontWeight: "bold",
  });
  text.x = Math.floor((width - text.width) / 2);
  text.y = 8;
  root.addChild(text);

  let variant = null;
  function setVariant(nextVariant) {
    const key = Object.prototype.hasOwnProperty.call(BUTTON_VARIANTS, nextVariant)
      ? nextVariant
      : "idle";
    if (variant === key) return;
    variant = key;
    const style = BUTTON_VARIANTS[key];
    bg.clear();
    bg.beginFill(style.bg, 0.96);
    bg.drawRoundedRect(0, 0, width, 34, 8);
    bg.endFill();
    if (text.style?.fill !== style.text) {
      text.style.fill = style.text;
      text.dirty = true;
    }
  }
  setVariant("idle");

  root.on("pointertap", (ev) => {
    ev?.stopPropagation?.();
    onTap?.();
  });

  return { root, bg, text, setVariant };
}
