export function createProcessWidgetCardModules({
  PIXI,
  COLORS,
  MODULE_PAD,
  MODULE_RADIUS,
  itemDefs,
  getDropEndpointId,
  dropTargetRegistry,
  drawModuleBox,
  drawDropboxBox,
  fitTextToWidth,
  attachLozengeHoverHandlers,
  formatOutputLabel,
  getPoolItemOptions,
  normalizeWithdrawSelection,
  getPoolItemTotals,
  formatRequirementLabel,
  resolveFixedEndpointId,
  countContributingPawnsForProcess,
} = {}) {
  function formatPoolSummary(poolTarget) {
    if (!poolTarget || poolTarget.kind !== "pool") return null;
    const pool = poolTarget.target;
    if (!pool || typeof pool !== "object") return null;
    const totals = { bronze: 0, silver: 0, gold: 0, diamond: 0 };
    if (
      pool.bronze != null ||
      pool.silver != null ||
      pool.gold != null ||
      pool.diamond != null
    ) {
      totals.bronze = Math.max(0, Math.floor(pool.bronze ?? 0));
      totals.silver = Math.max(0, Math.floor(pool.silver ?? 0));
      totals.gold = Math.max(0, Math.floor(pool.gold ?? 0));
      totals.diamond = Math.max(0, Math.floor(pool.diamond ?? 0));
    } else {
      const keys = Object.keys(pool);
      for (const key of keys) {
        const bucket = pool[key];
        if (!bucket || typeof bucket !== "object") continue;
        totals.bronze += Math.max(0, Math.floor(bucket.bronze ?? 0));
        totals.silver += Math.max(0, Math.floor(bucket.silver ?? 0));
        totals.gold += Math.max(0, Math.floor(bucket.gold ?? 0));
        totals.diamond += Math.max(0, Math.floor(bucket.diamond ?? 0));
      }
    }
    return `B ${totals.bronze}  S ${totals.silver}  G ${totals.gold}  D ${totals.diamond}`;
  }

  function drawStandardProgressBar({
    container,
    x,
    y,
    width,
    height,
    ratio,
    radius = 7,
    fillColor = COLORS.progressFill,
    fillAlpha = 0.98,
  }) {
    const clampedRatio = Math.max(0, Math.min(1, Number(ratio) || 0));
    const bg = new PIXI.Graphics();
    bg.lineStyle(1, COLORS.progressBorder || COLORS.moduleBorder, 0.92);
    bg.beginFill(COLORS.progressBg, 0.96);
    bg.drawRoundedRect(x, y, width, height, radius);
    bg.endFill();
    container.addChild(bg);

    const fillSize =
      clampedRatio > 0 ? Math.max(2, width * clampedRatio) : 0;
    if (fillSize <= 0) return;
    const fill = new PIXI.Graphics();
    fill.beginFill(fillColor, fillAlpha);
    fill.drawRoundedRect(x, y, fillSize, height, radius);
    fill.endFill();
    container.addChild(fill);
  }

  function buildOutputModule({
    container,
    width,
    outputs,
    poolSummary,
    selectionControl = null,
  }) {
    const bg = new PIXI.Graphics();
    container.addChild(bg);

    const title = new PIXI.Text("Output", {
      fill: COLORS.moduleText,
      fontSize: 10,
      fontWeight: "bold",
    });
    title.x = MODULE_PAD;
    title.y = MODULE_PAD;
    container.addChild(title);

    if (selectionControl?.label) {
      const btnPadX = 6;
      const btnPadY = 2;
      const btnHeight = 14;
      const btnWidth = Math.max(64, Math.floor(width * 0.42));
      const btn = new PIXI.Container();
      btn.x = Math.max(MODULE_PAD, width - MODULE_PAD - btnWidth);
      btn.y = MODULE_PAD - 1;
      btn.eventMode = selectionControl?.enabled === false ? "none" : "static";
      btn.cursor = selectionControl?.enabled === false ? "default" : "pointer";

      const btnBg = new PIXI.Graphics();
      btnBg.lineStyle(1, COLORS.moduleBorder, 0.95);
      btnBg.beginFill(COLORS.pillEnabled, 0.98);
      btnBg.drawRoundedRect(0, 0, btnWidth, btnHeight, 6);
      btnBg.endFill();
      btn.addChild(btnBg);

      const label = new PIXI.Text(String(selectionControl.label), {
        fill: COLORS.moduleText,
        fontSize: 9,
        fontWeight: "bold",
      });
      label.x = btnPadX;
      label.y = btnPadY;
      btn.addChild(label);

      const chevron = new PIXI.Text("v", {
        fill: COLORS.moduleSub,
        fontSize: 9,
      });
      chevron.x = btnWidth - chevron.width - btnPadX;
      chevron.y = btnPadY;
      btn.addChild(chevron);

      const fullLabel = String(selectionControl.label);
      const labelMaxWidth = Math.max(0, chevron.x - btnPadX - 4);
      fitTextToWidth(label, fullLabel, labelMaxWidth);
      attachLozengeHoverHandlers(btn, { fullLabel, hoverSpec: null });

      btn.on("pointertap", () => {
        if (selectionControl?.enabled === false) return;
        selectionControl?.onOpen?.(btn.getBounds());
      });

      container.addChild(btn);
    }

    let y = title.y + 14;
    if (!Array.isArray(outputs) || outputs.length === 0) {
      const none = new PIXI.Text("None", {
        fill: COLORS.moduleSub,
        fontSize: 9,
      });
      none.x = MODULE_PAD;
      none.y = y;
      container.addChild(none);
      y += 12;
    } else {
      const primary = outputs[0];
      const label = formatOutputLabel(primary);
      const qty = Math.max(0, Math.floor(primary.qty ?? primary.amount ?? 0));
      const lineText =
        primary.kind === "pool" && primary.fromLedger
          ? label
          : qty > 1
            ? `${label} x${qty}`
            : label;

      const line = new PIXI.Text(lineText, {
        fill: COLORS.moduleSub,
        fontSize: 9,
      });
      line.x = MODULE_PAD;
      line.y = y;
      fitTextToWidth(line, lineText, Math.max(20, width - MODULE_PAD * 2));
      container.addChild(line);
      y += 12;

      if (poolSummary) {
        const poolText = new PIXI.Text(poolSummary, {
          fill: COLORS.moduleSub,
          fontSize: 9,
        });
        poolText.x = MODULE_PAD;
        poolText.y = y;
        fitTextToWidth(poolText, poolSummary, Math.max(20, width - MODULE_PAD * 2));
        container.addChild(poolText);
        y += 12;
      }

      if (outputs.length > 1) {
        const more = new PIXI.Text(`+${outputs.length - 1} more`, {
          fill: COLORS.moduleSub,
          fontSize: 9,
        });
        more.x = MODULE_PAD;
        more.y = y;
        container.addChild(more);
        y += 12;
      }
    }

    const height = Math.max(52, y + MODULE_PAD - 2);
    drawModuleBox(bg, width, height);
    return height;
  }

  function buildGrowthOutputModule({
    container,
    width,
    pool,
    selectionControl = null,
  }) {
    const bg = new PIXI.Graphics();
    container.addChild(bg);

    const title = new PIXI.Text("Matured Pool", {
      fill: COLORS.moduleText,
      fontSize: 10,
      fontWeight: "bold",
    });
    title.x = MODULE_PAD;
    title.y = MODULE_PAD;
    container.addChild(title);

    if (selectionControl?.label) {
      const btnPadX = 6;
      const btnPadY = 2;
      const btnHeight = 14;
      const btnWidth = Math.max(64, Math.floor(width * 0.42));
      const btn = new PIXI.Container();
      btn.x = Math.max(MODULE_PAD, width - MODULE_PAD - btnWidth);
      btn.y = MODULE_PAD - 1;
      btn.eventMode = selectionControl?.enabled === false ? "none" : "static";
      btn.cursor = selectionControl?.enabled === false ? "default" : "pointer";

      const btnBg = new PIXI.Graphics();
      btnBg.lineStyle(1, COLORS.moduleBorder, 0.95);
      btnBg.beginFill(COLORS.pillEnabled, 0.98);
      btnBg.drawRoundedRect(0, 0, btnWidth, btnHeight, 6);
      btnBg.endFill();
      btn.addChild(btnBg);

      const label = new PIXI.Text(String(selectionControl.label), {
        fill: COLORS.moduleText,
        fontSize: 9,
        fontWeight: "bold",
      });
      label.x = btnPadX;
      label.y = btnPadY;
      btn.addChild(label);

      const chevron = new PIXI.Text("v", {
        fill: COLORS.moduleSub,
        fontSize: 9,
      });
      chevron.x = btnWidth - chevron.width - btnPadX;
      chevron.y = btnPadY;
      btn.addChild(chevron);

      const fullLabel = String(selectionControl.label);
      const labelMaxWidth = Math.max(0, chevron.x - btnPadX - 4);
      fitTextToWidth(label, fullLabel, labelMaxWidth);
      attachLozengeHoverHandlers(btn, { fullLabel, hoverSpec: null });

      btn.on("pointertap", () => {
        if (selectionControl?.enabled === false) return;
        selectionControl?.onOpen?.(btn.getBounds());
      });

      container.addChild(btn);
    }

    let y = title.y + 14;
    const summary = formatPoolSummary({ kind: "pool", target: pool });
    if (!summary) {
      const none = new PIXI.Text("None", {
        fill: COLORS.moduleSub,
        fontSize: 9,
      });
      none.x = MODULE_PAD;
      none.y = y;
      container.addChild(none);
      y += 12;
    } else {
      const poolText = new PIXI.Text(summary, {
        fill: COLORS.moduleSub,
        fontSize: 9,
      });
      poolText.x = MODULE_PAD;
      poolText.y = y;
      fitTextToWidth(poolText, summary, Math.max(20, width - MODULE_PAD * 2));
      container.addChild(poolText);
      y += 12;
    }

    const height = Math.max(52, y + MODULE_PAD - 2);
    drawModuleBox(bg, width, height);
    return height;
  }

  function getRequirementRows(reqs) {
    if (!Array.isArray(reqs) || reqs.length === 0) return [];
    const toolRows = reqs
      .filter((req) => req?.consume === false || req?.requirementType === "tool")
      .map((req) => {
        const amount = Math.max(0, Math.floor(req?.amount ?? 0));
        const progress = Math.max(0, Math.floor(req?.progress ?? 0));
        return {
          label: formatRequirementLabel(req),
          progress,
          amount,
          accessibleTotal: null,
          displayMode: "badge",
          badgeState: progress >= amount && amount > 0 ? "ready" : "missing",
        };
      });
    const materialReqs = reqs.filter(
      (req) => !(req?.consume === false || req?.requirementType === "tool")
    );
    if (materialReqs.length > 3) {
      let totalAmount = 0;
      let totalProgress = 0;
      for (const req of materialReqs) {
        totalAmount += Math.max(0, Math.floor(req.amount ?? 0));
        totalProgress += Math.max(0, Math.floor(req.progress ?? 0));
      }
      return toolRows.concat([
        {
          label: "Items",
          progress: totalProgress,
          amount: totalAmount,
          accessibleTotal: null,
          displayMode: "bar",
        },
      ]);
    }
    return toolRows.concat(
      materialReqs.map((req) => ({
        label: formatRequirementLabel(req),
        progress: Math.max(0, Math.floor(req.progress ?? 0)),
        amount: Math.max(0, Math.floor(req.amount ?? 0)),
        accessibleTotal: null,
        displayMode: "bar",
      }))
    );
  }

  function getPrestigeTotals(process) {
    const totals = { bronze: 0, silver: 0, gold: 0, diamond: 0 };
    const byKind = process?.consumedByKindTier || null;
    if (!byKind || typeof byKind !== "object") return totals;
    for (const bucket of Object.values(byKind)) {
      if (!bucket || typeof bucket !== "object") continue;
      totals.bronze += Math.max(0, Math.floor(bucket.bronze ?? 0));
      totals.silver += Math.max(0, Math.floor(bucket.silver ?? 0));
      totals.gold += Math.max(0, Math.floor(bucket.gold ?? 0));
      totals.diamond += Math.max(0, Math.floor(bucket.diamond ?? 0));
    }
    return totals;
  }

  function resolveLockedOutputEndpoint(process, processDef, output) {
    if (!processDef || !output) return null;
    const slots = processDef.routingSlots?.outputs || [];
    const slot =
      output.slotId && slots.find((s) => s?.slotId === output.slotId)
        ? slots.find((s) => s?.slotId === output.slotId)
        : slots[0] || null;
    if (!slot || !slot.locked) return null;
    const endpointId =
      resolveFixedEndpointId(slot.candidateRule?.endpointId, process, {
        leaderId: process?.leaderId ?? null,
      }) || (Array.isArray(slot.default?.ordered) ? slot.default.ordered[0] : null);
    return endpointId || null;
  }

  function buildProgressModule({
    container,
    width,
    process,
    processDef,
    vertical,
    state,
    target,
    systemId,
  }) {
    const bg = new PIXI.Graphics();
    container.addChild(bg);

    const labelPrefix = new PIXI.Text("Progress:", {
      fill: COLORS.moduleText,
      fontSize: 11,
      fontWeight: "bold",
    });
    labelPrefix.x = MODULE_PAD;
    labelPrefix.y = MODULE_PAD;
    container.addChild(labelPrefix);

    const labelMode = new PIXI.Text(vertical ? " Time" : " Work", {
      fill: COLORS.moduleText,
      fontSize: 11,
      fontWeight: "bold",
    });
    labelMode.x = labelPrefix.x + labelPrefix.width;
    labelMode.y = MODULE_PAD;
    container.addChild(labelMode);

    const duration = Math.max(1, Math.floor(processDef?.transform?.durationSec ?? 1));
    const progress = Math.max(0, Math.floor(process?.progress ?? 0));
    const ratio = Math.min(1, progress / duration);
    const barTop = MODULE_PAD + 18;

    if (vertical) {
      const barWidth = 18;
      const barHeight = 56;
      const barX = Math.floor((width - barWidth) / 2);
      const barY = barTop;
      drawStandardProgressBar({
        container,
        x: barX,
        y: barY,
        width: barWidth,
        height: barHeight,
        ratio: 1,
        radius: 8,
        fillColor: COLORS.progressBg,
      });

      const fillHeight = Math.max(0, barHeight * ratio);
      if (fillHeight > 0) {
        const fill = new PIXI.Graphics();
        fill.beginFill(COLORS.progressFill, 0.98);
        fill.drawRoundedRect(
          barX,
          barY + (barHeight - fillHeight),
          barWidth,
          fillHeight,
          8
        );
        fill.endFill();
        container.addChild(fill);
      }

      const remain = Math.max(0, duration - progress);
      const timeText = new PIXI.Text(`${remain}s`, {
        fill: COLORS.moduleText,
        fontSize: 11,
      });
      timeText.x = Math.floor((width - timeText.width) / 2);
      timeText.y = barY + barHeight + 4;
      container.addChild(timeText);

      const ratioText = new PIXI.Text(`${progress}/${duration}`, {
        fill: COLORS.moduleSub,
        fontSize: 10,
      });
      ratioText.x = Math.floor((width - ratioText.width) / 2);
      ratioText.y = timeText.y + 14;
      fitTextToWidth(ratioText, `${progress}/${duration}`, Math.max(20, width - MODULE_PAD * 2));
      ratioText.x = Math.floor((width - ratioText.width) / 2);
      container.addChild(ratioText);
    } else {
      const barWidth = width - MODULE_PAD * 2;
      const barHeight = 16;
      const barX = MODULE_PAD;
      const barY = barTop;
      drawStandardProgressBar({
        container,
        x: barX,
        y: barY,
        width: barWidth,
        height: barHeight,
        ratio,
        radius: 7,
      });

      const remain = Math.max(0, duration - progress);
      const timeText = new PIXI.Text(`${remain}s`, {
        fill: COLORS.moduleText,
        fontSize: 11,
      });
      timeText.x = Math.floor((width - timeText.width) / 2);
      timeText.y = barY + barHeight + 6;
      container.addChild(timeText);

      const progressText = new PIXI.Text(`${progress}/${duration} work`, {
        fill: COLORS.moduleText,
        fontSize: 10,
        fontWeight: "bold",
      });
      fitTextToWidth(
        progressText,
        `${progress}/${duration} work`,
        Math.max(20, width - MODULE_PAD * 2)
      );
      progressText.x = Math.floor((width - progressText.width) / 2);
      progressText.y = timeText.y + 14;
      container.addChild(progressText);

      const contributorCount =
        typeof countContributingPawnsForProcess === "function"
          ? countContributingPawnsForProcess({
              state,
              target,
              systemId,
              process,
              processDef,
            })
          : null;
      const pawnsText = new PIXI.Text(
        Number.isFinite(contributorCount)
          ? `Pawns ${Math.max(0, Math.floor(contributorCount))}`
          : "Pawns -",
        {
          fill: COLORS.moduleSub,
          fontSize: 10,
        }
      );
      pawnsText.x = Math.floor((width - pawnsText.width) / 2);
      pawnsText.y = progressText.y + 13;
      container.addChild(pawnsText);
    }

    const height = Math.max(64, container.height + MODULE_PAD);
    drawModuleBox(bg, width, height);
    return height;
  }

  function normalizeGrowthProgressEntry(entry) {
    const process = entry?.process || null;
    if (!process) return null;
    const processDef = entry?.processDef || null;
    const duration = Math.max(
      1,
      Math.floor(processDef?.transform?.durationSec ?? process?.durationSec ?? 1)
    );
    const progress = Math.max(0, Math.floor(process?.progress ?? 0));
    const ratio = Math.min(1, progress / duration);
    const remain = Math.max(0, duration - progress);
    return {
      id: String(process?.id ?? ""),
      ratio,
      remain,
    };
  }

  function buildGrowthProgressGroups(entries, maxGroups = 5) {
    const normalized = (Array.isArray(entries) ? entries : [])
      .map((entry) => normalizeGrowthProgressEntry(entry))
      .filter((entry) => !!entry)
      .sort((a, b) => {
        if (a.remain !== b.remain) return a.remain - b.remain;
        return a.id.localeCompare(b.id);
      });
    if (normalized.length === 0) return [];

    const groups = normalized.map((entry) => ({
      items: [entry],
      minRemain: entry.remain,
      maxRemain: entry.remain,
    }));

    const limit = Math.max(1, Math.floor(maxGroups));
    while (groups.length > limit) {
      let mergeAt = 0;
      let bestGap = Infinity;
      for (let i = 0; i < groups.length - 1; i += 1) {
        const left = groups[i];
        const right = groups[i + 1];
        const gap = Math.max(0, right.minRemain - left.maxRemain);
        if (gap < bestGap) {
          bestGap = gap;
          mergeAt = i;
        }
      }

      const left = groups[mergeAt];
      const right = groups[mergeAt + 1];
      const mergedItems = left.items.concat(right.items).sort((a, b) => {
        if (a.remain !== b.remain) return a.remain - b.remain;
        return a.id.localeCompare(b.id);
      });
      groups.splice(mergeAt, 2, {
        items: mergedItems,
        minRemain: Math.min(left.minRemain, right.minRemain),
        maxRemain: Math.max(left.maxRemain, right.maxRemain),
      });
    }

    return groups.map((group) => ({
      items: group.items,
      earliestRemain: group.minRemain,
      memberCount: group.items.length,
    }));
  }

  function buildGrowthProgressModule({ container, width, entries }) {
    const bg = new PIXI.Graphics();
    container.addChild(bg);

    const labelPrefix = new PIXI.Text("Progress:", {
      fill: COLORS.moduleText,
      fontSize: 11,
      fontWeight: "bold",
    });
    labelPrefix.x = MODULE_PAD;
    labelPrefix.y = MODULE_PAD;
    container.addChild(labelPrefix);

    const labelMode = new PIXI.Text(" Time", {
      fill: COLORS.moduleText,
      fontSize: 11,
      fontWeight: "bold",
    });
    labelMode.x = labelPrefix.x + labelPrefix.width;
    labelMode.y = MODULE_PAD;
    container.addChild(labelMode);

    const groups = buildGrowthProgressGroups(entries, 5);
    if (groups.length === 0) {
      const none = new PIXI.Text("No crops growing", {
        fill: COLORS.moduleSub,
        fontSize: 10,
      });
      none.x = MODULE_PAD;
      none.y = labelPrefix.y + 16;
      container.addChild(none);

      const height = Math.max(56, none.y + 18);
      drawModuleBox(bg, width, height);
      return height;
    }

    const barHeight = 48;
    const barGap = 8;
    const barAreaWidth = width - MODULE_PAD * 2;
    const count = groups.length;
    const maxBarWidth = 20;
    const barWidthRaw = Math.floor(
      (barAreaWidth - barGap * (count - 1)) / count
    );
    const barWidth = Math.max(10, Math.min(maxBarWidth, barWidthRaw));
    const totalBarsWidth = barWidth * count + barGap * Math.max(0, count - 1);
    const startX = Math.floor(MODULE_PAD + (barAreaWidth - totalBarsWidth) / 2);
    const barY = labelPrefix.y + 16;

    groups.forEach((group, index) => {
      const x = startX + index * (barWidth + barGap);
      drawStandardProgressBar({
        container,
        x,
        y: barY,
        width: barWidth,
        height: barHeight,
        ratio: 1,
        radius: 7,
        fillColor: COLORS.progressBg,
      });

      const members = group.items
        .slice()
        .sort((a, b) => a.ratio - b.ratio || a.id.localeCompare(b.id));
      for (const member of members) {
        const fillHeight = Math.max(2, barHeight * member.ratio);
        const fill = new PIXI.Graphics();
        fill.beginFill(COLORS.progressFill, 0.26);
        fill.drawRoundedRect(
          x,
          barY + (barHeight - fillHeight),
          barWidth,
          fillHeight,
          6
        );
        fill.endFill();
        container.addChild(fill);
      }

      const timeText = new PIXI.Text(`${group.earliestRemain}s`, {
        fill: COLORS.moduleSub,
        fontSize: 10,
      });
      timeText.x = x + Math.max(0, Math.floor((barWidth - timeText.width) / 2));
      timeText.y = barY + barHeight + 4;
      container.addChild(timeText);

      if (group.memberCount > 1) {
        const countText = new PIXI.Text(`x${group.memberCount}`, {
          fill: COLORS.headerSub,
          fontSize: 9,
          fontWeight: "bold",
        });
        countText.x = x + Math.max(0, Math.floor((barWidth - countText.width) / 2));
        countText.y = barY - 10;
        container.addChild(countText);
      }
    });

    const height = Math.max(64, barY + barHeight + 22);
    drawModuleBox(bg, width, height);
    return height;
  }

  function buildRequirementsModule({
    container,
    width,
    reqs,
    rowsOverride = null,
    hasShortage = false,
  }) {
    const bg = new PIXI.Graphics();
    container.addChild(bg);

    const rows = Array.isArray(rowsOverride) ? rowsOverride : getRequirementRows(reqs);
    const hasToolRows = rows.some((row) => row?.displayMode === "badge");
    const title = new PIXI.Text(hasToolRows ? "Materials & Tools" : "Materials", {
      fill: COLORS.moduleText,
      fontSize: 11,
      fontWeight: "bold",
    });
    title.x = MODULE_PAD;
    title.y = MODULE_PAD;
    container.addChild(title);

    let y = title.y + 14;
    if (rows.length === 0) {
      const none = new PIXI.Text("None", {
        fill: COLORS.moduleSub,
        fontSize: 10,
      });
      none.x = MODULE_PAD;
      none.y = y;
      container.addChild(none);
      y += 12;
    } else {
      for (const row of rows) {
        if (row?.displayMode === "badge") {
          const label = new PIXI.Text(String(row.label || "Tool"), {
            fill: COLORS.moduleSub,
            fontSize: 10,
          });
          label.x = MODULE_PAD;
          label.y = y;
          fitTextToWidth(
            label,
            String(row.label || "Tool"),
            Math.max(20, width - MODULE_PAD * 2 - 40)
          );
          container.addChild(label);

          const badgeLabel = row.badgeState === "ready" ? "Ready" : "Missing";
          const badgeColor =
            row.badgeState === "ready" ? 0x5a8a55 : COLORS.pillInvalid;
          const badgeBorder =
            row.badgeState === "ready" ? COLORS.progressFill : COLORS.dangerBorder;
          const badgeText = new PIXI.Text(badgeLabel, {
            fill: COLORS.moduleText,
            fontSize: 9,
            fontWeight: "bold",
          });
          const badgeWidth = Math.max(34, Math.ceil(badgeText.width) + 10);
          const badgeHeight = 14;
          const badgeX = width - MODULE_PAD - badgeWidth;
          const badgeY = y - 1;
          const badgeBg = new PIXI.Graphics();
          badgeBg.lineStyle(1, badgeBorder, 0.95);
          badgeBg.beginFill(badgeColor, 0.92);
          badgeBg.drawRoundedRect(badgeX, badgeY, badgeWidth, badgeHeight, 7);
          badgeBg.endFill();
          container.addChild(badgeBg);
          badgeText.x = badgeX + Math.floor((badgeWidth - badgeText.width) / 2);
          badgeText.y = badgeY + Math.floor((badgeHeight - badgeText.height) / 2);
          container.addChild(badgeText);

          y += 18;
          continue;
        }
        const reachable = Number.isFinite(row.accessibleTotal)
          ? Math.max(0, Math.floor(row.accessibleTotal))
          : null;
        const label = new PIXI.Text(String(row.label || "Material"), {
          fill: COLORS.moduleSub,
          fontSize: 10,
        });
        let reachText = null;
        let reachWidth = 0;
        if (reachable != null) {
          const reachLabel = `Reach ${reachable}`;
          reachText = new PIXI.Text(reachLabel, {
            fill: COLORS.moduleSub,
            fontSize: 9,
            fontWeight: "bold",
          });
          reachWidth = Math.ceil(reachText.width) + 6;
          reachText.x = Math.max(MODULE_PAD, width - MODULE_PAD - reachText.width);
          reachText.y = y + 1;
          container.addChild(reachText);
        }
        fitTextToWidth(
          label,
          String(row.label || "Material"),
          Math.max(20, width - MODULE_PAD * 2 - reachWidth)
        );
        label.x = MODULE_PAD;
        label.y = y;
        container.addChild(label);

        const barWidth = width - MODULE_PAD * 2;
        const barHeight = 12;
        const barY = y + 12;
        const ratio = row.amount > 0 ? Math.min(1, row.progress / row.amount) : 0;
        drawStandardProgressBar({
          container,
          x: MODULE_PAD,
          y: barY,
          width: barWidth,
          height: barHeight,
          ratio,
          radius: 6,
        });

        const progressText = new PIXI.Text(
          `${Math.max(0, Math.floor(row.progress ?? 0))}/${Math.max(
            0,
            Math.floor(row.amount ?? 0)
          )}`,
          {
            fill: COLORS.moduleText,
            fontSize: 9,
            fontWeight: "bold",
            stroke: COLORS.progressBg,
            strokeThickness: 2,
          }
        );
        progressText.x = MODULE_PAD + Math.max(0, Math.floor((barWidth - progressText.width) / 2));
        progressText.y = barY + Math.max(0, Math.floor((barHeight - progressText.height) / 2));
        container.addChild(progressText);

        y += 24;
      }
    }

    const height = Math.max(58, y + MODULE_PAD - 2);
    drawModuleBox(bg, width, height, {
      borderColor: hasShortage ? COLORS.dangerBorder : COLORS.moduleBorder,
    });
    return height;
  }

  function buildPrestigeModule({ container, width, process }) {
    const bg = new PIXI.Graphics();
    container.addChild(bg);

    const title = new PIXI.Text("Prestige", {
      fill: COLORS.moduleText,
      fontSize: 10,
      fontWeight: "bold",
    });
    title.x = MODULE_PAD;
    title.y = MODULE_PAD;
    container.addChild(title);

    const totals = getPrestigeTotals(process);
    const rows = [
      { key: "bronze", label: "B", value: totals.bronze },
      { key: "silver", label: "S", value: totals.silver },
      { key: "gold", label: "G", value: totals.gold },
      { key: "diamond", label: "D", value: totals.diamond },
    ];
    const max = Math.max(1, ...rows.map((r) => r.value));

    let y = title.y + 14;
    const barWidth = width - MODULE_PAD * 2 - 16;
    for (const row of rows) {
      const label = new PIXI.Text(row.label, {
        fill: COLORS.moduleSub,
        fontSize: 9,
      });
      label.x = MODULE_PAD;
      label.y = y;
      container.addChild(label);

      const ratio = Math.min(1, row.value / max);
      const barBg = new PIXI.Graphics();
      barBg.beginFill(COLORS.progressBg, 1);
      barBg.drawRoundedRect(MODULE_PAD + 12, y + 2, barWidth, 6, 4);
      barBg.endFill();
      container.addChild(barBg);

      const fill = new PIXI.Graphics();
      fill.beginFill(COLORS.progressFill, 1);
      fill.drawRoundedRect(
        MODULE_PAD + 12,
        y + 2,
        Math.max(2, barWidth * ratio),
        6,
        4
      );
      fill.endFill();
      container.addChild(fill);

      y += 12;
    }

    const height = Math.max(52, y + MODULE_PAD - 2);
    drawModuleBox(bg, width, height);
    return height;
  }

  function buildWithdrawModule({
    container,
    width,
    pool,
    withdrawState,
    onOpenItemDropdown,
    onWithdraw,
  }) {
    const bg = new PIXI.Graphics();
    container.addChild(bg);

    const title = new PIXI.Text("Withdraw", {
      fill: COLORS.moduleText,
      fontSize: 10,
      fontWeight: "bold",
    });
    title.x = MODULE_PAD;
    title.y = MODULE_PAD;
    container.addChild(title);

    const options = getPoolItemOptions(pool);
    const selectedItemId = normalizeWithdrawSelection(withdrawState, options);
    const totals = getPoolItemTotals(pool, selectedItemId);
    const selectedLabel = selectedItemId
      ? itemDefs?.[selectedItemId]?.name || selectedItemId
      : "No stored items";
    const maxAmount = Math.max(1, totals.total);
    const amount = Math.max(
      1,
      Math.min(maxAmount, Math.floor(withdrawState?.amount ?? 1))
    );
    if (withdrawState) withdrawState.amount = amount;

    const selectBtnY = title.y + 14;
    const selectBtnW = width - MODULE_PAD * 2;
    const selectBtnH = 16;
    const selectBtn = new PIXI.Container();
    selectBtn.x = MODULE_PAD;
    selectBtn.y = selectBtnY;
    selectBtn.eventMode = options.length > 0 ? "static" : "none";
    selectBtn.cursor = options.length > 0 ? "pointer" : "default";
    container.addChild(selectBtn);

    const selectBg = new PIXI.Graphics();
    selectBg.lineStyle(1, COLORS.moduleBorder, 0.95);
    selectBg.beginFill(COLORS.pillEnabled, 0.98);
    selectBg.drawRoundedRect(0, 0, selectBtnW, selectBtnH, 6);
    selectBg.endFill();
    selectBtn.addChild(selectBg);

    const selectText = new PIXI.Text(selectedLabel, {
      fill: options.length > 0 ? COLORS.moduleText : COLORS.moduleSub,
      fontSize: 9,
      fontWeight: "bold",
    });
    selectText.x = 6;
    selectText.y = 2;
    selectBtn.addChild(selectText);

    const selectChevron = new PIXI.Text("v", {
      fill: COLORS.moduleSub,
      fontSize: 9,
    });
    selectChevron.x = selectBtnW - selectChevron.width - 6;
    selectChevron.y = 2;
    selectBtn.addChild(selectChevron);

    const selectLabelMaxWidth = Math.max(0, selectChevron.x - selectText.x - 4);
    fitTextToWidth(selectText, selectedLabel, selectLabelMaxWidth);
    attachLozengeHoverHandlers(selectBtn, {
      fullLabel: selectedLabel,
      hoverSpec: null,
    });

    if (options.length > 0) {
      selectBtn.on("pointertap", () => {
        onOpenItemDropdown?.(selectBtn.getBounds());
      });
    }

    let y = selectBtnY + selectBtnH + 6;
    const tierRows = [
      { label: "B", key: "bronze" },
      { label: "S", key: "silver" },
      { label: "G", key: "gold" },
      { label: "D", key: "diamond" },
    ];
    for (const row of tierRows) {
      const value = Math.max(0, Math.floor(totals.byTier?.[row.key] ?? 0));
      const text = new PIXI.Text(`${row.label} ${value}`, {
        fill: COLORS.moduleSub,
        fontSize: 9,
      });
      text.x = MODULE_PAD;
      text.y = y;
      container.addChild(text);
      y += 10;
    }

    const controlsY = y + 2;
    const controlsW = width - MODULE_PAD * 2;
    const amountW = 34;
    const btnW = 16;
    const btnH = 16;
    const gap = 4;
    const amountX =
      MODULE_PAD + Math.floor((controlsW - (btnW * 2 + amountW + gap * 2)) / 2);

    const minusBtn = new PIXI.Container();
    minusBtn.x = amountX;
    minusBtn.y = controlsY;
    minusBtn.eventMode = "static";
    minusBtn.cursor = "pointer";
    container.addChild(minusBtn);
    const minusBg = new PIXI.Graphics();
    minusBtn.addChild(minusBg);
    const minusText = new PIXI.Text("-", {
      fill: COLORS.moduleText,
      fontSize: 11,
      fontWeight: "bold",
    });
    minusText.x = 6;
    minusText.y = 1;
    minusBtn.addChild(minusText);

    const amountBg = new PIXI.Graphics();
    amountBg.x = amountX + btnW + gap;
    amountBg.y = controlsY;
    container.addChild(amountBg);
    const amountText = new PIXI.Text(String(amount), {
      fill: COLORS.moduleText,
      fontSize: 9,
      fontWeight: "bold",
    });
    container.addChild(amountText);

    const plusBtn = new PIXI.Container();
    plusBtn.x = amountX + btnW + gap + amountW + gap;
    plusBtn.y = controlsY;
    plusBtn.eventMode = "static";
    plusBtn.cursor = "pointer";
    container.addChild(plusBtn);
    const plusBg = new PIXI.Graphics();
    plusBtn.addChild(plusBg);
    const plusText = new PIXI.Text("+", {
      fill: COLORS.moduleText,
      fontSize: 11,
      fontWeight: "bold",
    });
    plusText.x = 4;
    plusText.y = 1;
    plusBtn.addChild(plusText);

    const spawnBtn = new PIXI.Container();
    spawnBtn.x = MODULE_PAD;
    spawnBtn.y = controlsY + btnH + 6;
    spawnBtn.eventMode = "static";
    spawnBtn.cursor = "pointer";
    container.addChild(spawnBtn);
    const spawnBg = new PIXI.Graphics();
    spawnBtn.addChild(spawnBg);
    const spawnText = new PIXI.Text("Spawn To Cursor", {
      fill: COLORS.moduleText,
      fontSize: 9,
      fontWeight: "bold",
    });
    spawnBtn.addChild(spawnText);

    function drawSmallButton(nodeBg, enabled) {
      nodeBg.clear();
      nodeBg.lineStyle(1, COLORS.moduleBorder, 0.95);
      nodeBg.beginFill(enabled ? COLORS.pillEnabled : COLORS.pillDisabled, 0.98);
      nodeBg.drawRoundedRect(0, 0, btnW, btnH, 5);
      nodeBg.endFill();
    }

    function refreshControls() {
      const current = Math.max(
        1,
        Math.min(
          Math.max(1, Math.floor(totals.total ?? 0)),
          Math.floor(withdrawState?.amount ?? 1)
        )
      );
      if (withdrawState) withdrawState.amount = current;
      amountText.text = String(current);
      amountText.x = amountBg.x + Math.floor((amountW - amountText.width) / 2);
      amountText.y = amountBg.y + 2;
      amountBg.clear();
      amountBg.lineStyle(1, COLORS.moduleBorder, 0.95);
      amountBg.beginFill(COLORS.dropboxBg, 0.98);
      amountBg.drawRoundedRect(0, 0, amountW, btnH, 5);
      amountBg.endFill();

      const canMinus = current > 1;
      const canPlus = totals.total > 0 && current < totals.total;
      const canSpawn = totals.total > 0 && !!selectedItemId;

      drawSmallButton(minusBg, canMinus);
      drawSmallButton(plusBg, canPlus);
      minusBtn.alpha = canMinus ? 1 : 0.55;
      plusBtn.alpha = canPlus ? 1 : 0.55;
      minusBtn.cursor = canMinus ? "pointer" : "default";
      plusBtn.cursor = canPlus ? "pointer" : "default";

      spawnBg.clear();
      spawnBg.lineStyle(1, COLORS.moduleBorder, 0.95);
      spawnBg.beginFill(canSpawn ? 0x2f5a3d : 0x27303f, 0.98);
      spawnBg.drawRoundedRect(0, 0, selectBtnW, 18, 6);
      spawnBg.endFill();
      spawnText.x = Math.floor((selectBtnW - spawnText.width) / 2);
      spawnText.y = 3;
      spawnBtn.alpha = canSpawn ? 1 : 0.65;
      spawnBtn.cursor = canSpawn ? "pointer" : "default";
    }

    minusBtn.on("pointertap", () => {
      if (withdrawState?.amount > 1) {
        withdrawState.amount -= 1;
        refreshControls();
      }
    });

    plusBtn.on("pointertap", () => {
      const cur = Math.floor(withdrawState?.amount ?? 1);
      if (totals.total > 0 && cur < totals.total) {
        withdrawState.amount = cur + 1;
        refreshControls();
      }
    });

    spawnBtn.on("pointertap", () => {
      if (!selectedItemId) return;
      if (totals.total <= 0) return;
      const qty = Math.max(
        1,
        Math.min(totals.total, Math.floor(withdrawState?.amount ?? 1))
      );
      onWithdraw?.(selectedItemId, qty);
    });

    refreshControls();

    const height = Math.max(88, spawnBtn.y + 24);
    drawModuleBox(bg, width, height);
    return height;
  }

  function buildDropboxModule({
    container,
    width,
    height,
    process,
    dropTargets,
    dropOwnerId = null,
    labelText = "Dropbox",
    dropEnabled = true,
  }) {
    const bg = new PIXI.Graphics();
    container.addChild(bg);
    drawDropboxBox(bg, width, height);

    const size = Math.min(width, height);
    const slot = new PIXI.Graphics();
    let affordanceLevel = "neutral";
    const getAffordanceStyle = () => {
      if (affordanceLevel === "valid") {
        return {
          stroke: COLORS.dropboxValidBorder,
          fill: COLORS.dropboxValidBg,
        };
      }
      if (affordanceLevel === "invalid") {
        return {
          stroke: COLORS.dropboxInvalidBorder,
          fill: COLORS.dropboxInvalidBg,
        };
      }
      if (affordanceLevel === "capped") {
        return {
          stroke: COLORS.dropboxCappedBorder,
          fill: COLORS.dropboxCappedBg,
        };
      }
      return {
        stroke: COLORS.dropboxBorder,
        fill: COLORS.drawerBg,
      };
    };
    const drawSlot = () => {
      const style = getAffordanceStyle();
      slot.clear();
      slot.lineStyle(1, style.stroke, 0.9);
      slot.beginFill(style.fill, 0.95);
      slot.drawRoundedRect(0, 0, size, size, 8);
      slot.endFill();
    };
    drawSlot();
    slot.x = Math.floor((width - size) / 2);
    slot.y = Math.floor((height - size) / 2) - 6;
    container.addChild(slot);

    const label = new PIXI.Text(labelText, {
      fill: COLORS.moduleSub,
      fontSize: 9,
    });
    label.x = Math.floor((width - label.width) / 2);
    label.y = slot.y + size + 4;
    container.addChild(label);

    // Full-module drop hitbox so drops do not require exact slot-pixel precision.
    const hitbox = new PIXI.Graphics();
    hitbox.beginFill(0xffffff, 0.001);
    hitbox.drawRoundedRect(0, 0, width, height, MODULE_RADIUS);
    hitbox.endFill();
    container.addChildAt(hitbox, 0);

    const dropId =
      typeof dropOwnerId === "string" && dropOwnerId.length > 0
        ? dropOwnerId
        : getDropEndpointId(process?.id);
    const canDrop = dropEnabled === true && !!dropId;
    if (canDrop && Array.isArray(dropTargets)) {
      let errorTimeout = null;
      let cachedBounds = null;
      const targetDef = {
        ownerId: dropId,
        kind: "processDropbox",
        getBounds: () => {
          const bounds = hitbox.getBounds();
          if (
            Number.isFinite(bounds?.width) &&
            Number.isFinite(bounds?.height) &&
            bounds.width > 0 &&
            bounds.height > 0
          ) {
            cachedBounds = {
              x: bounds.x,
              y: bounds.y,
              width: bounds.width,
              height: bounds.height,
            };
            return bounds;
          }
          return cachedBounds || bounds;
        },
        setAffordance: (level = "neutral") => {
          affordanceLevel =
            level === "valid" || level === "invalid" || level === "capped"
              ? level
              : "neutral";
          drawSlot();
        },
        clearAffordance: () => {
          affordanceLevel = "neutral";
          drawSlot();
        },
        flashError: () => {
          const prevLevel = affordanceLevel;
          affordanceLevel = "invalid";
          drawSlot();
          if (errorTimeout != null) clearTimeout(errorTimeout);
          errorTimeout = setTimeout(() => {
            affordanceLevel = prevLevel;
            drawSlot();
            errorTimeout = null;
          }, 180);
        },
      };
      dropTargets.push({
        ...targetDef,
      });
      const initialAffordanceLevel =
        dropTargetRegistry?.getDropboxDragAffordance?.(dropId) ?? null;
      if (initialAffordanceLevel) targetDef.setAffordance(initialAffordanceLevel);

      slot.eventMode = "none";
      slot.cursor = "default";
    } else {
      slot.alpha = 0.75;
      label.alpha = 0.75;
      slot.eventMode = "none";
      slot.cursor = "default";
    }
  }

  return {
    formatPoolSummary,
    resolveLockedOutputEndpoint,
    buildProgressModule,
    buildGrowthProgressModule,
    buildRequirementsModule,
    buildOutputModule,
    buildGrowthOutputModule,
    buildPrestigeModule,
    buildWithdrawModule,
    buildDropboxModule,
  };
}
