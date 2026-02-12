// src/views/gold-graph-pixi.js
// Render-only view for metric graphs.
// STAGE 3: tSec aware.

import { GRAPH_METRICS } from "../model/graph-metrics.js";
import { perfEnabled, perfNowMs, recordGraphRender } from "../model/perf.js";
import { getActionSecondsInRange } from "../model/timeline.js";

function getSeriesValue(point, seriesId) {
  if (point?.values && point.values[seriesId] != null) {
    const v = point.values[seriesId];
    return Number.isFinite(v) ? v : 0;
  }
  if (seriesId === "gold") {
    const v = point?.gold ?? 0;
    return Number.isFinite(v) ? v : 0;
  }
  return 0;
}

export function createMetricGraphView({
  app,
  layer,
  controller,
  metric = GRAPH_METRICS.gold,
  getMetricDef,
  getTimeline,
  getCursorState,
  getSeriesValueOverride,
  setPreviewState,
  clearPreviewState,
  commitSecond,
  openPosition,
  historyWindowSec = null,
}) {
  let metricDef = GRAPH_METRICS.gold;
  let series = GRAPH_METRICS.gold.series;

  function resolveMetric() {
    const next =
      typeof getMetricDef === "function" ? getMetricDef() : metric;
    const resolved =
      typeof next === "string" ? GRAPH_METRICS[next] : next;
    metricDef =
      resolved && typeof resolved === "object"
        ? resolved
        : GRAPH_METRICS.gold;
    series = Array.isArray(metricDef.series)
      ? metricDef.series
      : GRAPH_METRICS.gold.series;
  }

  function getActiveSeries() {
    const data = controller?.getData?.() ?? null;
    if (Array.isArray(data?.series) && data.series.length) {
      return data.series;
    }
    resolveMetric();
    return series;
  }

  function getMetricLabel() {
    const data = controller?.getData?.() ?? null;
    return data?.label ?? metricDef?.label ?? "Metric";
  }

  resolveMetric();

  const root = new PIXI.Container();
  root.visible = false;
  layer.addChild(root);

  const WIN_W = 1200;
  const WIN_H = 150;
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

  const ZOOM_BTN_W = 70;
  const ZOOM_BTN_H = 22;
  const zoomBtn = new PIXI.Container();
  const zoomBg = new PIXI.Graphics();
  const zoomText = new PIXI.Text("", {
    fontFamily: "Arial",
    fontSize: 12,
    fill: 0xffffff,
  });
  zoomBtn.addChild(zoomBg, zoomText);
  zoomBtn.eventMode = "static";
  zoomBtn.cursor = "pointer";
  root.addChild(zoomBtn);

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
  let zoomed = false;
  let lastPlotMs = 0;
  let lastPlotVersion = -1;
  let lastPlotBoundsKey = "";
  const PLOT_THROTTLE_MS = 80;
  const MAX_PLOT_POINTS = 150000;

  let lastRestoreMs = 0;
  const RESTORE_THROTTLE_MS = 33;
  let statusNote = "";
  let lastScrubSignature = "";
  let cachedActionSecs = [];
  let lastActionRevision = null;
  let lastActionRangeKey = "";
  const ACTION_SNAP_THRESHOLD_SEC = 0.75;

  function clampInt(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v | 0));
  }

  function getGridStep(rangeSec, targetLines = 12) {
    const range = Math.max(1, Math.floor(rangeSec));
    const rough = range / Math.max(1, targetLines);
    const pow10 = Math.pow(10, Math.floor(Math.log10(rough)));
    const candidates = [1, 2, 5, 10];
    let step = candidates[candidates.length - 1] * pow10;
    for (const c of candidates) {
      const s = c * pow10;
      if (s >= rough) {
        step = s;
        break;
      }
    }
    return Math.max(1, Math.round(step));
  }

  function timeToX(t) {
    const ratio = (t - minSec) / Math.max(1, maxSec - minSec);
    return plot.x + ratio * plot.w;
  }

  function updateScrubFromPointer(globalX) {
    const localX = globalX - root.x;
    const ratio = (localX - plot.x) / Math.max(1, plot.w);
    const t = minSec + ratio * (maxSec - minSec);
    scrubSec = clampInt(Math.round(applyActionSnap(t)), minSec, maxSec);
  }

  function applyActionSnap(t) {
    const list = getActionSecs(minSec, maxSec);
    if (!list.length) return t;

    let lo = 0;
    let hi = list.length - 1;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const val = list[mid];
      if (val < t) lo = mid + 1;
      else if (val > t) hi = mid - 1;
      else return val;
    }

    const candidates = [];
    if (lo >= 0 && lo < list.length) candidates.push(list[lo]);
    if (hi >= 0 && hi < list.length) candidates.push(list[hi]);

    let best = t;
    let bestDist = Infinity;
    for (const c of candidates) {
      const dist = Math.abs(c - t);
      if (dist < bestDist) {
        bestDist = dist;
        best = c;
      }
    }

    return bestDist <= ACTION_SNAP_THRESHOLD_SEC ? best : t;
  }

  function getActionSecs(startSec, endSec) {
    const tl = getTimeline?.();
    const rev = Math.floor(tl?.revision ?? -1);
    const start = Math.max(0, Math.floor(startSec ?? 0));
    const end = Math.max(0, Math.floor(endSec ?? 0));
    const rangeKey = `${start}:${end}`;
    if (rev !== lastActionRevision || rangeKey !== lastActionRangeKey) {
      lastActionRevision = rev;
      lastActionRangeKey = rangeKey;
      cachedActionSecs = getActionSecondsInRange(tl, start, end);
    }
    return cachedActionSecs;
  }

  function updateZoomButton() {
    const x = WIN_W - 16 - ZOOM_BTN_W;
    const y = Math.floor((HEADER_H - ZOOM_BTN_H) / 2);

    zoomBg.clear();
    zoomBg.beginFill(zoomed ? 0x555555 : 0x333355);
    zoomBg.drawRoundedRect(0, 0, ZOOM_BTN_W, ZOOM_BTN_H, 6);
    zoomBg.endFill();

    zoomText.text = zoomed ? "Full" : "Focus";
    zoomText.x = (ZOOM_BTN_W - zoomText.width) / 2;
    zoomText.y = (ZOOM_BTN_H - zoomText.height) / 2;

    zoomBtn.x = x;
    zoomBtn.y = y;
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

    updateZoomButton();
  }

  function updateTimeBounds() {
    const tl = getTimeline?.();
    const cs = getCursorState?.();
    const d = controller.getData?.() ?? {};

    const horizonSec = Math.max(0, Math.floor(d.horizonSec ?? 1200));

    const historyEnd = tl?.historyEndSec ?? 0;
    const currentT = Math.floor(cs?.tSec ?? 0);
    const rollingWindow =
      Number.isFinite(historyWindowSec) && historyWindowSec > 0
        ? Math.floor(historyWindowSec)
        : null;

    if (zoomed) {
      const halfSpan = Math.max(1, Math.floor(horizonSec / 4));
      const span = halfSpan * 2;
      let min = currentT - halfSpan;
      let max = currentT + halfSpan;

      if (min < 0) {
        max += -min;
        min = 0;
      }

      minSec = min;
      maxSec = Math.max(min + span, max);
    } else {
      const liveMax = Math.max(historyEnd, currentT);
      minSec =
        rollingWindow != null ? Math.max(0, liveMax - rollingWindow) : 0;
      maxSec = liveMax + horizonSec;
    }

    if (!isScrubbing) {
      scrubSec = clampInt(currentT, minSec, maxSec);
    }
  }

  function drawPlot() {
    resolveMetric();
    const perfStart = perfEnabled() ? perfNowMs() : 0;
    plotG.clear();
    const data = controller.getData?.() ?? {};
    const seriesList = getActiveSeries();
    const cs = getCursorState?.();
    const cursorSec = Math.floor(cs?.tSec ?? 0);
    const sampleRes = controller.getSamplesForWindow?.({
      startSec: minSec,
      endSec: maxSec,
      focus: zoomed,
      cursorSec,
    });
    const sampledPoints = Array.isArray(sampleRes?.points)
      ? sampleRes.points
      : [];

    if (!sampledPoints.length || !seriesList.length) return;

    let pointsForDraw = sampledPoints;
    const maxPlotPoints = Math.min(
      MAX_PLOT_POINTS,
      Math.max(200, Math.floor(plot.w) * 2)
    );
    if (sampledPoints.length > maxPlotPoints) {
      const step = Math.ceil(sampledPoints.length / maxPlotPoints);
      const decimated = [];
      for (let i = 0; i < sampledPoints.length; i += step) {
        decimated.push(sampledPoints[i]);
      }
      const last = sampledPoints[sampledPoints.length - 1];
      if (last && decimated[decimated.length - 1] !== last) {
        decimated.push(last);
      }
      pointsForDraw = decimated;
    }

    if (!pointsForDraw.length) return;

    function resolveValue(point, seriesDef) {
      const t = Math.max(0, Math.floor(point?.tSec ?? 0));
      const override = getSeriesValueOverride?.(t, seriesDef.id, point);
      if (Number.isFinite(override)) return override;
      return getSeriesValue(point, seriesDef.id);
    }

    let minValue = Infinity;
    let maxValue = -Infinity;
    for (const p of pointsForDraw) {
      for (const s of seriesList) {
        const v = resolveValue(p, s);
        if (v < minValue) minValue = v;
        if (v > maxValue) maxValue = v;
      }
    }

    if (!Number.isFinite(minValue)) {
      minValue = 0;
      maxValue = 100;
    }
    if (minValue === maxValue) {
      minValue -= 10;
      maxValue += 10;
    }

    const pad = (maxValue - minValue) * 0.1;
    minValue -= pad;
    maxValue += pad;

    function yForValue(v) {
      const t = (v - minValue) / Math.max(1e-6, maxValue - minValue);
      return plot.y + plot.h - t * plot.h;
    }

    // Grid
    plotG.lineStyle(1, 0x444466, 0.5);
    plotG.drawRect(plot.x, plot.y, plot.w, plot.h);
    plotG.lineStyle(1, 0x444466, 0.2);
    const gridStep = getGridStep(maxSec - minSec, 12);
    const startGrid =
      Math.ceil(minSec / gridStep) * gridStep;
    for (let t = startGrid; t <= maxSec; t += gridStep) {
      const x = timeToX(t);
      if (x > plot.x && x < plot.x + plot.w) {
        plotG.moveTo(x, plot.y);
        plotG.lineTo(x, plot.y + plot.h);
      }
    }

    // Data Line
    for (const s of seriesList) {
      const lineColor = Number.isFinite(s.color) ? s.color : 0xffffff;
      plotG.lineStyle(2, lineColor, 1);
      let first = true;

      for (const p of pointsForDraw) {
        const t = p.tSec ?? 0;

        const x = timeToX(t);
        const value = resolveValue(p, s);
        const y = yForValue(value);

        if (first) {
          plotG.moveTo(x, y);
          first = false;
        } else {
          plotG.lineTo(x, y);
        }
      }
    }

    // Markers (actions)
    const actionSecs = getActionSecs(minSec, maxSec);
    if (actionSecs.length) {
      plotG.beginFill(0x55ff55);
      plotG.lineStyle(0);
      for (const t of actionSecs) {
        if (t >= minSec && t <= maxSec) {
          const x = timeToX(t);
          plotG.drawCircle(x, plot.y + plot.h - 3, 3);
        }
      }
      plotG.endFill();
    }

    if (perfEnabled()) {
      recordGraphRender({
        ms: perfNowMs() - perfStart,
        points: pointsForDraw.length,
        metric: data.metric?.id ?? metricDef?.id ?? metricDef?.label ?? null,
      });
    }
  }

  function drawScrub() {
    resolveMetric();
    const cs = getCursorState?.();
    const tl = getTimeline?.();

    if (!cs) return;

    const curT = Math.floor(cs.tSec ?? 0);
    const historyEnd = tl?.historyEndSec ?? 0;
    const metricLabel = getMetricLabel();
    const signature =
      `${isScrubbing ? 1 : 0}|${scrubSec}|${curT}|${historyEnd}|` +
      `${minSec}:${maxSec}|${statusNote}|${metricLabel}`;
    if (signature === lastScrubSignature) return;
    lastScrubSignature = signature;

    scrubG.clear();

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

    const zone = scrubSec <= historyEnd ? "History" : "Forecast";
    const note = statusNote ? ` • ${statusNote}` : "";

    text.text = `${metricLabel} • Time: ${scrubSec}s (${zone}) • Live: ${curT}s${note}`;
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
      const stateData = controller?.getStateDataAt?.(scrubSec);
      const res = commitSecond?.(scrubSec, stateData);
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

  zoomBtn.on("pointerdown", (e) => {
    e.stopPropagation();
  });
  zoomBtn.on("pointertap", (e) => {
    e.stopPropagation();
    zoomed = !zoomed;
    statusNote = "";
    render();
  });

  function open() {
    if (root.visible) return;
    root.visible = true;
    const defaultX = 20;
    const defaultY = app.screen.height - WIN_H - 800;
    root.x = openPosition?.x ?? defaultX;
    root.y = openPosition?.y ?? defaultY;
    controller?.setActive?.(true);
    controller.handleInvalidate?.("open");
    controller.ensureCache();
    render();
  }

  function close() {
    if (!root.visible) return;
    root.visible = false;
    isScrubbing = false;
    clearPreviewState?.();
    controller?.setActive?.(false);
  }

  function isOpen() {
    return !!root.visible;
  }

  function render() {
    if (!root.visible) return;
    resolveMetric();
    updateTimeBounds();
    updateZoomButton();
    const now = performance.now();
    const data = controller.getData?.() ?? {};
    const boundsKey = `${minSec}:${maxSec}`;
    const cacheVersion =
      Number.isFinite(data.cacheVersion) ? data.cacheVersion : -1;
    const versionChanged =
      cacheVersion !== lastPlotVersion || boundsKey !== lastPlotBoundsKey;
    const shouldPlot =
      isScrubbing || zoomed
        ? now - lastPlotMs >= PLOT_THROTTLE_MS
        : versionChanged && now - lastPlotMs >= PLOT_THROTTLE_MS;
    if (shouldPlot) {
      drawPlot();
      lastPlotMs = now;
      lastPlotVersion = cacheVersion;
      lastPlotBoundsKey = boundsKey;
    }
    drawScrub();
  }

  drawWindow();

  return { open, close, isOpen, render };
}

export function createGoldGraphView(opts) {
  return createMetricGraphView({ ...opts, metric: GRAPH_METRICS.gold });
}
