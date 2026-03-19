// src/views/run-complete-pixi.js
// Full-screen popup shown when a run is completed.

function toSafeInt(value, fallback = 0) {
  if (!Number.isFinite(value)) return Math.max(0, Math.floor(fallback));
  return Math.max(0, Math.floor(value));
}

function normalizeRunComplete(entry) {
  const data = entry?.data;
  const year = toSafeInt(data?.year, 1);
  const reason =
    typeof data?.reason === "string" && data.reason.length > 0
      ? data.reason
      : "unknown";
  return {
    year,
    reason,
    text: `Civilization lasted until Year ${year}.`,
  };
}

function formatReason(reason) {
  if (reason === "faithCollapsedAtBronze") {
    return "Faith collapsed while already at bronze.";
  }
  if (reason === "leaderFaithCollapsedAtBronze") {
    return "All leaders were lost after faith collapse from starvation.";
  }
  return "Run complete.";
}

export function createRunCompleteView({ app, layer, onClose } = {}) {
  const root = new PIXI.Container();
  root.visible = false;
  root.zIndex = 190;
  layer.addChild(root);

  const blocker = new PIXI.Graphics();
  blocker.eventMode = "static";
  blocker.cursor = "pointer";
  root.addChild(blocker);

  const panel = new PIXI.Container();
  panel.eventMode = "static";
  panel.cursor = "pointer";
  root.addChild(panel);

  const panelBg = new PIXI.Graphics();
  panel.addChild(panelBg);

  const title = new PIXI.Text("Run Complete", {
    fill: 0xffd7d7,
    fontSize: 38,
    fontWeight: "bold",
  });
  panel.addChild(title);

  const messageText = new PIXI.Text("", {
    fill: 0xffffff,
    fontSize: 24,
    fontWeight: "bold",
  });
  panel.addChild(messageText);

  const reasonText = new PIXI.Text("", {
    fill: 0xffb4b4,
    fontSize: 16,
  });
  panel.addChild(reasonText);

  const closeHint = new PIXI.Text("Click to close", {
    fill: 0xa4aec4,
    fontSize: 15,
    fontStyle: "italic",
  });
  panel.addChild(closeHint);

  const PANEL_WIDTH = 700;
  const PANEL_HEIGHT = 240;
  const PANEL_PAD_X = 28;

  let openEventId = null;
  let openEventSec = null;
  let openInfo = null;

  function drawBackdrop() {
    blocker.clear();
    blocker.beginFill(0x000000, 0.68);
    blocker.drawRect(0, 0, app.screen.width, app.screen.height);
    blocker.endFill();
  }

  function drawPanelFrame() {
    panelBg.clear();
    panelBg.lineStyle(2, 0xd26f6f, 0.9);
    panelBg.beginFill(0x2d0f17, 0.96);
    panelBg.drawRoundedRect(0, 0, PANEL_WIDTH, PANEL_HEIGHT, 16);
    panelBg.endFill();
  }

  function layout() {
    drawBackdrop();
    drawPanelFrame();

    panel.x = Math.floor((app.screen.width - PANEL_WIDTH) / 2);
    panel.y = Math.floor((app.screen.height - PANEL_HEIGHT) / 2);
    panel.hitArea = new PIXI.Rectangle(0, 0, PANEL_WIDTH, PANEL_HEIGHT);

    title.x = PANEL_PAD_X;
    title.y = 20;
    messageText.x = PANEL_PAD_X;
    messageText.y = 92;
    reasonText.x = PANEL_PAD_X;
    reasonText.y = 132;
    closeHint.x = PANEL_PAD_X;
    closeHint.y = PANEL_HEIGHT - closeHint.height - 14;
  }

  function applyText(info) {
    if (!info) return;
    messageText.text = info.text;
    reasonText.text = formatReason(info.reason);
  }

  function openForEntry(entry, opts = {}) {
    const info = normalizeRunComplete(entry);
    openInfo = info;
    openEventId = Number.isFinite(entry?.id) ? Math.floor(entry.id) : null;
    openEventSec = Number.isFinite(entry?.tSec) ? Math.floor(entry.tSec) : null;
    root.visible = true;
    layout();
    applyText(info);
    return {
      ok: true,
      source: typeof opts.source === "string" ? opts.source : "unknown",
      eventId: openEventId,
      eventSec: openEventSec,
    };
  }

  function close(reason = "close") {
    if (!root.visible) return { ok: false, reason: "alreadyClosed" };
    root.visible = false;
    const closedInfo = {
      eventId: openEventId,
      eventSec: openEventSec,
      reason,
    };
    openInfo = null;
    openEventId = null;
    openEventSec = null;
    onClose?.(closedInfo);
    return { ok: true };
  }

  blocker.on("pointerdown", (ev) => {
    ev?.stopPropagation?.();
  });
  blocker.on("pointertap", (ev) => {
    ev?.stopPropagation?.();
    close("click");
  });
  panel.on("pointerdown", (ev) => {
    ev?.stopPropagation?.();
  });
  panel.on("pointertap", (ev) => {
    ev?.stopPropagation?.();
    close("click");
  });

  function init() {
    layout();
  }

  function resize() {
    layout();
  }

  function update() {}

  return {
    init,
    update,
    resize,
    container: root,
    openForEntry,
    close,
    isOpen: () => root.visible,
    isOpenForEvent: (entryId) =>
      root.visible &&
      Number.isFinite(entryId) &&
      Number.isFinite(openEventId) &&
      Math.floor(entryId) === openEventId,
    getOpenEventId: () => openEventId,
    getOpenEventSec: () => openEventSec,
    getOpenInfo: () => openInfo,
    getScreenRect: () =>
      !root.visible
        ? null
        : {
            x: 0,
            y: 0,
            width: app.screen.width,
            height: app.screen.height,
          },
  };
}
