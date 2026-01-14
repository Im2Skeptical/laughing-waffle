// src/views/gold-graph-pixi.js
// Render-only view for the gold graph.
// STAGE 3: tSec aware.

export function createGoldGraphView({
  app,
  layer,
  controller,
  getTimeline,
  getCursorState,
  setPreviewState,
  clearPreviewState,
  commitSecond,
}) {
  const root = new PIXI.Container();
  root.visible = false;
  layer.addChild(root);

  const WIN_W = 600;
  const WIN_H = 260;
  const HEADER_H = 38;

  const header = new PIXI.Graphics();
  const body = new PIXI.Graphics();
  const plotG = new PIXI.Graphics();
  const scrubG = new PIXI.Graphics();
  const text = new PIXI.Text("", {
    fontFamily: "Arial",
    fontSize: 14,
    fill: 0xffffff,
  });

  root.addChild(header, body, plotG, scrubG, text);

  const plot = {
    x: 16,
    y: HEADER_H + 12,
    w: WIN_W - 32,
    h: WIN_H - HEADER_H - 26,
  };

  const plotHit = new PIXI.Graphics();
  plotHit.alpha = 0;
  plotHit.eventMode = "static";
  plotHit.cursor = "pointer";
  root.addChild(plotHit);

  const headerHit = new PIXI.Graphics();
  headerHit.alpha = 0;
  headerHit.eventMode = "static";
  headerHit.cursor = "move";
  root.addChild(headerHit);

  let draggingWindow = false;
  let dragWindowOffset = { x: 0, y: 0 };

  headerHit.on("pointerdown", (e) => {
    draggingWindow = true;
    const p = e.global;
    dragWindowOffset.x = p.x - root.x;
    dragWindowOffset.y = p.y - root.y;
  });

  app.stage.on("pointerup", () => (draggingWindow = false));
  app.stage.on("pointerupoutside", () => (draggingWindow = false));
  app.stage.on("pointermove", (e) => {
    if (!draggingWindow) return;
    const p = e.global;
    root.x = p.x - dragWindowOffset.x;
    root.y = p.y - dragWindowOffset.y;
  });

  let isScrubbing = false;
  let scrubSec = 0;
  let minSec = 0;
  let maxSec = 0;

  let lastRestoreMs = 0;
  const RESTORE_THROTTLE_MS = 33;
  let statusNote = "";

  function clampInt(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v | 0));
  }

  function timeToX(t) {
    const ratio = (t - minSec) / Math.max(1, maxSec - minSec);
    return plot.x + ratio * plot.w;
  }

  function updateScrubFromPointer(globalX) {
    const localX = globalX - root.x;
    const ratio = (localX - plot.x) / Math.max(1, plot.w);
    const t = minSec + ratio * (maxSec - minSec);
    scrubSec = clampInt(Math.round(t), minSec, maxSec);
  }

  function drawWindow() {
    header.clear();
    header.beginFill(0x222244, 0.95);
    header.drawRoundedRect(0, 0, WIN_W, HEADER_H, 14);
    header.endFill();

    body.clear();
    body.beginFill(0x101018, 0.92);
    body.drawRoundedRect(0, HEADER_H, WIN_W, WIN_H - HEADER_H, 14);
    body.endFill();

    plotHit.clear();
    plotHit.beginFill(0xffffff);
    plotHit.drawRect(plot.x, plot.y, plot.w, plot.h);
    plotHit.endFill();

    headerHit.clear();
    headerHit.beginFill(0xffffff);
    headerHit.drawRect(0, 0, WIN_W, HEADER_H);
    headerHit.endFill();

    text.x = 14;
    text.y = 10;
  }

  function updateTimeBounds() {
    const tl = getTimeline?.();
    const cs = getCursorState?.();
    const d = controller.getData?.() ?? {};

    const horizonSec = Math.max(0, Math.floor(d.horizonSec ?? 1200));

    const maxReached = tl?.maxReachedSec ?? 0;
    const currentT = Math.floor(cs?.tSec ?? 0);

    minSec = 0;
    maxSec = Math.max(maxReached, currentT) + horizonSec;

    if (!isScrubbing) {
      scrubSec = clampInt(currentT, minSec, maxSec);
    }
  }

  function drawPlot() {
    plotG.clear();
    const { cache } = controller.getData();
    const tl = getTimeline?.();

    const all = [...(cache?.history || []), ...(cache?.window?.forecast || [])];
    if (!all.length) return;

    let minGold = Infinity;
    let maxGold = -Infinity;

    for (const p of all) {
      const t = p.tSec ?? 0;
      if (t < minSec || t > maxSec) continue;

      const g = p.gold ?? 0;
      if (g < minGold) minGold = g;
      if (g > maxGold) maxGold = g;
    }

    if (!Number.isFinite(minGold)) {
      minGold = 0;
      maxGold = 100;
    }
    if (minGold === maxGold) {
      minGold -= 10;
      maxGold += 10;
    }

    const pad = (maxGold - minGold) * 0.1;
    minGold -= pad;
    maxGold += pad;

    function yForGold(g) {
      const t = (g - minGold) / Math.max(1e-6, maxGold - minGold);
      return plot.y + plot.h - t * plot.h;
    }

    // Grid
    plotG.lineStyle(1, 0x444466, 0.5);
    plotG.drawRect(plot.x, plot.y, plot.w, plot.h);
    plotG.lineStyle(1, 0x444466, 0.2);
    for (let t = minSec; t <= maxSec; t += 10) {
      const x = timeToX(t);
      if (x > plot.x && x < plot.x + plot.w) {
        plotG.moveTo(x, plot.y);
        plotG.lineTo(x, plot.y + plot.h);
      }
    }

    // Data Line
    all.sort((a, b) => (a.tSec ?? 0) - (b.tSec ?? 0));

    plotG.lineStyle(2, 0xffd966, 1);
    let first = true;

    for (const p of all) {
      const t = p.tSec ?? 0;
      if (t < minSec || t > maxSec) continue;

      const x = timeToX(t);
      const y = yForGold(p.gold ?? 0);

      if (first) {
        plotG.moveTo(x, y);
        first = false;
      } else {
        plotG.lineTo(x, y);
      }
    }

    // Markers (actions)
    if (tl && tl.actions) {
      plotG.beginFill(0x55ff55);
      plotG.lineStyle(0);
      for (const entry of tl.actions) {
        const t = entry.tSec ?? 0;
        if (t >= minSec && t <= maxSec) {
          const x = timeToX(t);
          plotG.drawCircle(x, plot.y + plot.h - 3, 3);
        }
      }
      plotG.endFill();
    }
  }

  function drawScrub() {
    scrubG.clear();
    const cs = getCursorState?.();
    const tl = getTimeline?.();

    if (!cs) return;

    const curT = Math.floor(cs.tSec ?? 0);
    const maxReached = tl?.maxReachedSec ?? 0;

    const x = timeToX(scrubSec);

    const color = isScrubbing ? 0xffffff : 0xaaaaaa;
    scrubG.lineStyle(1, color, 0.8);
    scrubG.moveTo(x, plot.y);
    scrubG.lineTo(x, plot.y + plot.h);

    if (isScrubbing && Math.abs(scrubSec - curT) > 0) {
      const cx = timeToX(curT);
      if (cx >= plot.x && cx <= plot.x + plot.w) {
        scrubG.lineStyle(1, 0x00ff00, 0.5);
        scrubG.moveTo(cx, plot.y);
        scrubG.lineTo(cx, plot.y + plot.h);
      }
    }

    const zone = scrubSec <= maxReached ? "History" : "Forecast";
    const note = statusNote ? ` • ${statusNote}` : "";

    text.text = `Time: ${scrubSec}s (${zone}) • Live: ${curT}s${note}`;
  }

  function applyPreviewThrottled(force) {
    const now = performance.now();
    if (!force && now - lastRestoreMs < RESTORE_THROTTLE_MS) {
      drawScrub();
      return;
    }
    lastRestoreMs = now;

    const restored = controller.getStateAt(scrubSec);
    if (restored) {
      setPreviewState?.(restored);
    }
    drawScrub();
  }

  function endScrub(commit) {
    if (!isScrubbing) return;
    isScrubbing = false;

    if (commit) {
      clearPreviewState?.();
      const res = commitSecond?.(scrubSec);
      if (res && res.ok === false) {
        statusNote = `Jump failed: ${res.reason}`;
        drawScrub();
        return;
      }
      return;
    }
    clearPreviewState?.();
    drawScrub();
  }

  plotHit.on("pointerdown", (e) => {
    statusNote = "";
    isScrubbing = true;
    updateScrubFromPointer(e.global.x);
    applyPreviewThrottled(true);
  });

  plotHit.on("pointermove", (e) => {
    if (!isScrubbing) return;
    updateScrubFromPointer(e.global.x);
    applyPreviewThrottled(false);
  });

  plotHit.on("pointerup", () => endScrub(true));
  plotHit.on("pointerupoutside", () => endScrub(true));

  function open() {
    if (root.visible) return;
    root.visible = true;
    root.x = 40;
    root.y = app.screen.height - WIN_H - 140;
    controller.ensureCache();
    render();
  }

  function close() {
    if (!root.visible) return;
    root.visible = false;
    isScrubbing = false;
    clearPreviewState?.();
  }

  function isOpen() {
    return !!root.visible;
  }

  function render() {
    if (!root.visible) return;
    updateTimeBounds();
    drawPlot();
    drawScrub();
  }

  drawWindow();

  return { open, close, isOpen, render };
}
