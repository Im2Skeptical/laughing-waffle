// src/views/year-end-performance-pixi.js
// Full-screen popup for end-of-year summary details.

function toSafeInt(value, fallback = 0) {
  if (!Number.isFinite(value)) return Math.max(0, Math.floor(fallback));
  return Math.max(0, Math.floor(value));
}

function toSafeSignedInt(value, fallback = 0) {
  if (!Number.isFinite(value)) return Math.floor(fallback);
  return Math.floor(value);
}

function formatSigned(value) {
  const v = toSafeSignedInt(value, 0);
  if (v > 0) return `+${v}`;
  return String(v);
}

function formatOutcomeLabel(outcome) {
  if (outcome === "populationAttracted") return "Population attracted";
  if (outcome === "populationDormant") return "Population dormant";
  if (outcome === "populationHalved") return "Population halved";
  if (outcome === "populationChanged") return "Population changed";
  return "Population unchanged";
}

function hasOwn(obj, key) {
  return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
}

function toOptionalInt(value, fallback = null) {
  if (value == null) return fallback;
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

function normalizeReport(entry) {
  const eventData = entry?.data;
  const report =
    eventData?.yearEndPerformance &&
    typeof eventData.yearEndPerformance === "object"
      ? eventData.yearEndPerformance
      : null;
  if (!report) return null;

  const hasPopulationSplit =
    hasOwn(report, "populationSkillPointsPerLeader") ||
    hasOwn(eventData, "populationSkillPointsPerLeader");
  const hasFaithSplit =
    hasOwn(report, "faithSkillPointsPerLeader") ||
    hasOwn(eventData, "faithSkillPointsPerLeader");
  const populationSkillPointsPerLeader = hasPopulationSplit
    ? toSafeInt(
        report.populationSkillPointsPerLeader,
        eventData?.populationSkillPointsPerLeader ?? 0
      )
    : null;
  const faithSkillPointsPerLeader = hasFaithSplit
    ? toSafeInt(
        report.faithSkillPointsPerLeader,
        eventData?.faithSkillPointsPerLeader ?? 0
      )
    : null;

  return {
    year: toSafeInt(report.year, eventData?.year ?? 1),
    previousPopulation: toSafeInt(
      report.previousPopulation,
      eventData?.previousPopulation ?? 0
    ),
    nextPopulation: toSafeInt(report.nextPopulation, eventData?.nextPopulation ?? 0),
    populationDelta: toSafeSignedInt(
      report.populationDelta,
      (eventData?.nextPopulation ?? 0) - (eventData?.previousPopulation ?? 0)
    ),
    populationOutcome:
      typeof report.populationOutcome === "string"
        ? report.populationOutcome
        : "populationUnchanged",
    grainTotal: toSafeInt(report.grainTotal, eventData?.grainTotal ?? 0),
    edibleTotal: toSafeInt(report.edibleTotal, eventData?.edibleTotal ?? 0),
    skillPointsPerLeader: toOptionalInt(
      report.skillPointsPerLeader,
      toOptionalInt(eventData?.skillPointsPerLeader, null)
    ),
    leaderCount: toSafeInt(report.leaderCount, eventData?.leaderCount ?? 0),
    totalSkillPointsAwarded: toSafeInt(
      report.totalSkillPointsAwarded,
      eventData?.totalSkillPointsAwarded ?? 0
    ),
    populationSkillPointsPerLeader,
    faithSkillPointsPerLeader,
    populationSkillPointsAwardedTotal: toSafeInt(
      report.populationSkillPointsAwardedTotal,
      eventData?.populationSkillPointsAwardedTotal ?? 0
    ),
    faithSkillPointsAwardedTotal: toSafeInt(
      report.faithSkillPointsAwardedTotal,
      eventData?.faithSkillPointsAwardedTotal ?? 0
    ),
  };
}

export function createYearEndPerformanceView({ app, layer, onClose } = {}) {
  const root = new PIXI.Container();
  root.visible = false;
  root.zIndex = 180;
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

  const title = new PIXI.Text("End of the Year Performance", {
    fill: 0xf3f6ff,
    fontSize: 34,
    fontWeight: "bold",
  });
  panel.addChild(title);

  const yearText = new PIXI.Text("", {
    fill: 0xb9c6e0,
    fontSize: 16,
    fontWeight: "bold",
  });
  panel.addChild(yearText);

  const popText = new PIXI.Text("", {
    fill: 0xffffff,
    fontSize: 20,
    fontWeight: "bold",
  });
  panel.addChild(popText);

  const outcomeText = new PIXI.Text("", {
    fill: 0x9fb2d4,
    fontSize: 15,
  });
  panel.addChild(outcomeText);

  const grainText = new PIXI.Text("", {
    fill: 0xf6d77c,
    fontSize: 18,
    fontWeight: "bold",
  });
  panel.addChild(grainText);

  const edibleText = new PIXI.Text("", {
    fill: 0x94d88c,
    fontSize: 18,
    fontWeight: "bold",
  });
  panel.addChild(edibleText);

  const skillText = new PIXI.Text("", {
    fill: 0x90c5ff,
    fontSize: 18,
    fontWeight: "bold",
  });
  panel.addChild(skillText);

  const closeHint = new PIXI.Text("Click to close", {
    fill: 0xa4aec4,
    fontSize: 15,
    fontStyle: "italic",
  });
  panel.addChild(closeHint);

  const PANEL_WIDTH = 760;
  const PANEL_HEIGHT = 360;
  const PANEL_PAD_X = 28;

  let openEventId = null;
  let openEventSec = null;
  let openReport = null;

  function drawBackdrop() {
    blocker.clear();
    blocker.beginFill(0x000000, 0.6);
    blocker.drawRect(0, 0, app.screen.width, app.screen.height);
    blocker.endFill();
  }

  function drawPanelFrame() {
    panelBg.clear();
    panelBg.lineStyle(2, 0x6b7ea8, 0.85);
    panelBg.beginFill(0x162033, 0.96);
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
    title.y = 18;
    yearText.x = PANEL_PAD_X;
    yearText.y = 62;
    popText.x = PANEL_PAD_X;
    popText.y = 100;
    outcomeText.x = PANEL_PAD_X;
    outcomeText.y = 136;
    grainText.x = PANEL_PAD_X;
    grainText.y = 182;
    edibleText.x = PANEL_PAD_X;
    edibleText.y = 216;
    skillText.x = PANEL_PAD_X;
    skillText.y = 250;
    closeHint.x = PANEL_PAD_X;
    closeHint.y = PANEL_HEIGHT - closeHint.height - 14;
  }

  function applyReportText(report) {
    if (!report) return;
    yearText.text = `Year ${report.year}`;
    popText.text = `Population: ${report.previousPopulation} -> ${report.nextPopulation} (${formatSigned(
      report.populationDelta
    )})`;
    outcomeText.text = formatOutcomeLabel(report.populationOutcome);
    grainText.text = `Total Grain: ${report.grainTotal}`;
    edibleText.text = `Total Edibles: ${report.edibleTotal}`;
    const hasBreakdown =
      report.populationSkillPointsPerLeader != null ||
      report.faithSkillPointsPerLeader != null;
    if (hasBreakdown && report.skillPointsPerLeader != null) {
      const populationPart =
        report.populationSkillPointsPerLeader != null
          ? report.populationSkillPointsPerLeader
          : report.skillPointsPerLeader;
      const faithPart =
        report.faithSkillPointsPerLeader != null ? report.faithSkillPointsPerLeader : 0;
      skillText.text = `Skill Points Gained: ${report.totalSkillPointsAwarded} (${report.skillPointsPerLeader} x ${report.leaderCount} leaders; ${populationPart} pop + ${faithPart} faith)`;
      return;
    }
    if (hasBreakdown) {
      skillText.text = `Skill Points Gained: ${report.totalSkillPointsAwarded} (${report.populationSkillPointsAwardedTotal} pop + ${report.faithSkillPointsAwardedTotal} faith across ${report.leaderCount} leaders)`;
      return;
    }
    const perLeader = report.skillPointsPerLeader ?? 0;
    skillText.text = `Skill Points Gained: ${report.totalSkillPointsAwarded} (${perLeader} x ${report.leaderCount} leaders)`;
  }

  function openForEntry(entry, opts = {}) {
    const report = normalizeReport(entry);
    if (!report) return { ok: false, reason: "noReportData" };
    openReport = report;
    openEventId = Number.isFinite(entry?.id) ? Math.floor(entry.id) : null;
    openEventSec = Number.isFinite(entry?.tSec) ? Math.floor(entry.tSec) : null;
    root.visible = true;
    layout();
    applyReportText(openReport);
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
    openReport = null;
    openEventId = null;
    openEventSec = null;
    onClose?.(closedInfo);
    return { ok: true };
  }

  function toggleForEntry(entry) {
    const entryId = Number.isFinite(entry?.id) ? Math.floor(entry.id) : null;
    if (root.visible && entryId != null && entryId === openEventId) {
      return close("toggleOff");
    }
    return openForEntry(entry, { source: "toggle" });
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
    toggleForEntry,
    close,
    isOpen: () => root.visible,
    isOpenForEvent: (entryId) =>
      root.visible &&
      Number.isFinite(entryId) &&
      Number.isFinite(openEventId) &&
      Math.floor(entryId) === openEventId,
    getOpenEventId: () => openEventId,
    getOpenEventSec: () => openEventSec,
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
