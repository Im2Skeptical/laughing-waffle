// button.js
// Shared button builder for skill tree view controls.

export function makeButton(label, width, onTap) {
  const root = new PIXI.Container();
  root.eventMode = "static";
  root.cursor = "pointer";

  const bg = new PIXI.Graphics();
  bg.beginFill(0x2a3350, 0.96);
  bg.drawRoundedRect(0, 0, width, 34, 8);
  bg.endFill();
  root.addChild(bg);

  const text = new PIXI.Text(label, {
    fill: 0xffffff,
    fontSize: 13,
    fontWeight: "bold",
  });
  text.x = Math.floor((width - text.width) / 2);
  text.y = 8;
  root.addChild(text);

  root.on("pointertap", (ev) => {
    ev?.stopPropagation?.();
    onTap?.();
  });

  return { root, bg, text };
}
