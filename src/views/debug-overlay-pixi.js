// debug-overlay-pixi.js
// Debug UI overlay (Pixi).

import { ActionKinds } from "../model/actions.js";

const DESIGN_WIDTH = 1920;

export function createDebugOverlay({ layer, runner }) {
  const root = new PIXI.Container();
  root.x = DESIGN_WIDTH - 220;
  root.y = 10;
  layer.addChild(root);

  const hudBg = new PIXI.Graphics();
  hudBg.beginFill(0x000000, 0.5);
  hudBg.drawRoundedRect(0, 0, 200, 40, 8);
  hudBg.endFill();
  root.addChild(hudBg);

  const apText = new PIXI.Text("AP: -- / --", {
    fontFamily: "Arial",
    fontSize: 18,
    fill: 0xffd700,
    fontWeight: "bold",
  });
  apText.x = 10;
  apText.y = 10;
  root.addChild(apText);

  const dbgBtn = new PIXI.Graphics();
  dbgBtn.beginFill(0x444444);
  dbgBtn.drawRoundedRect(160, 5, 30, 30, 4);
  dbgBtn.endFill();
  dbgBtn.eventMode = "static";
  dbgBtn.cursor = "pointer";
  root.addChild(dbgBtn);

  const dbgIcon = new PIXI.Text("D", { fontSize: 20, fill: 0xffffff });
  dbgIcon.x = 166;
  dbgIcon.y = 8;
  root.addChild(dbgIcon);

  const panel = new PIXI.Container();
  panel.y = 50;
  panel.visible = false;
  root.addChild(panel);

  const panelBg = new PIXI.Graphics();
  panelBg.beginFill(0x222222, 0.9);
  panelBg.drawRoundedRect(0, 0, 200, 100, 8);
  panelBg.endFill();
  panel.addChild(panelBg);

  const cheatBtn = new PIXI.Container();
  cheatBtn.x = 10;
  cheatBtn.y = 10;
  panel.addChild(cheatBtn);

  const cheatBg = new PIXI.Graphics();
  cheatBg.beginFill(0x555555);
  cheatBg.drawRect(0, 0, 180, 30);
  cheatBg.endFill();
  cheatBtn.addChild(cheatBg);

  const cheatText = new PIXI.Text("Toggle Cheat AP", {
    fontSize: 14,
    fill: 0xffffff,
  });
  cheatText.x = 10;
  cheatText.y = 6;
  cheatBtn.addChild(cheatText);

  let cheatsEnabled = false;

  dbgBtn.on("pointerdown", () => {
    panel.visible = !panel.visible;
  });

  cheatBtn.eventMode = "static";
  cheatBtn.cursor = "pointer";
  cheatBtn.on("pointerdown", () => {
    cheatsEnabled = !cheatsEnabled;
    const payload = cheatsEnabled
      ? { enabled: true, cap: 9999, points: 9999 }
      : { enabled: false };
    runner.dispatchAction(ActionKinds.DEBUG_SET_CAP, payload);
    cheatBg.clear();
    cheatBg.beginFill(cheatsEnabled ? 0x00aa00 : 0x555555);
    cheatBg.drawRect(0, 0, 180, 30);
    cheatBg.endFill();
  });

  return {
    update: () => {
      const state = runner.getState();
      if (state) {
        const cur = state.actionPoints ?? 0;
        const cap = state.actionPointCap ?? 100;
        apText.text = `AP: ${cur} / ${cap}`;
        apText.style.fill = cur < 20 ? 0xff5555 : 0xffd700;
      }
    },
  };
}
