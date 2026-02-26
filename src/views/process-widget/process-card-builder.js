export function createProcessWidgetProcessCardBuilder({
  PIXI,
  app,
  CORE_WIDTH,
  CARD_RADIUS,
  HEADER_HEIGHT,
  HEADER_PAD_X,
  HEADER_PAD_Y,
  BODY_PAD,
  MIN_BODY_CONTENT_HEIGHT,
  DRAWER_COLLAPSED,
  DRAWER_EXPANDED,
  DROPBOX_SIZE,
  SEGMENT_GAP,
  MODULE_GAP,
  COLORS,
  drawerExpanded,
  createWindowHeader,
  getTargetKey,
  getTargetLabel,
  getCardTitle,
  getProcessVariant,
  isRecipeSystem,
  getSelectedRecipeId,
  formatCropName,
  formatRecipeName,
  openGrowthSelectionDropdown,
  openRecipeSelectionDropdown,
  resolveEndpointTarget,
  hasSelectableSlots,
  buildGrowthProgressModule,
  buildProgressModule,
  buildRequirementsModule,
  buildGrowthOutputModule,
  resolveLockedOutputEndpoint,
  formatPoolSummary,
  buildOutputModule,
  buildPrestigeModule,
  getDepositPoolTarget,
  canWithdrawFromTarget,
  getWithdrawState,
  buildWithdrawModule,
  openWithdrawItemDropdown,
  requestPoolWithdraw,
  collectModuleView,
  stretchModuleViews,
  buildRoutingDrawer,
  buildDropboxModule,
  drawCardBackground,
} = {}) {
  function buildProcessCard(state, target, entry, index, count, opts = {}) {
    const process = entry.process;
    const processDef = entry.processDef;
    const targetLabel = getTargetLabel(target);
    const isGrowthGroup = opts.groupMode === "growth";
    const growthEntries = Array.isArray(opts.groupEntries)
      ? opts.groupEntries
      : null;
    const isPreview = opts.preview === true;
    const variantOverride = opts.variantOverride || null;
    const routingMode = opts.routingMode || "process";
    const routingProcess = opts.routingProcess || process;
    const routingProcessDef = opts.routingProcessDef || processDef;
    const routingState = opts.routingState || routingProcess?.routing || null;
    const routingTargetRef = opts.routingTargetRef || null;
    const routingSystemId = opts.routingSystemId || null;
    const allowRouting =
      typeof opts.allowRouting === "boolean"
        ? opts.allowRouting
        : routingMode === "template"
          ? true
          : !isPreview;
    const allowDropbox =
      typeof opts.allowDropbox === "boolean" ? opts.allowDropbox : !isPreview;
    const drawerKey =
      opts.drawerKey ||
      (routingMode === "template"
        ? `${routingSystemId || "system"}:${getTargetKey(target) || "target"}`
        : process?.id);

    const card = new PIXI.Container();
    const bg = new PIXI.Graphics();
    card.addChild(bg);

    const showDropbox = allowDropbox && !!routingProcessDef?.supportsDropslot;
    const inputDrawerVisible =
      allowRouting && hasSelectableSlots(routingProcessDef, "inputs");
    const outputDrawerVisible =
      allowRouting && hasSelectableSlots(routingProcessDef, "outputs");

    const leftDrawerWidth = inputDrawerVisible
      ? drawerExpanded.inputs.has(`${drawerKey}:inputs`)
        ? DRAWER_EXPANDED
        : DRAWER_COLLAPSED
      : 0;
    const rightDrawerWidth = outputDrawerVisible
      ? drawerExpanded.outputs.has(`${drawerKey}:outputs`)
        ? DRAWER_EXPANDED
        : DRAWER_COLLAPSED
      : 0;

    const dropboxGap = showDropbox ? SEGMENT_GAP : 0;
    const centralWidth = Math.max(
      120,
      CORE_WIDTH - (showDropbox ? DROPBOX_SIZE + dropboxGap : 0)
    );

    const segments = [];
    if (inputDrawerVisible) segments.push({ key: "left", width: leftDrawerWidth });
    if (showDropbox) segments.push({ key: "dropbox", width: DROPBOX_SIZE });
    segments.push({ key: "central", width: centralWidth });
    if (outputDrawerVisible) segments.push({ key: "right", width: rightDrawerWidth });

    let x = 0;
    for (let i = 0; i < segments.length; i++) {
      segments[i].x = x;
      x += segments[i].width;
      if (i < segments.length - 1) x += SEGMENT_GAP;
    }
    const totalWidth = x;

    const title =
      opts.titleOverride ||
      getCardTitle(targetLabel, process, processDef, variantOverride);
    const pinned = typeof opts.pinned === "boolean" ? opts.pinned : false;

    const headerUi = createWindowHeader({
      stage: app?.stage,
      parent: card,
      width: totalWidth,
      height: HEADER_HEIGHT,
      radius: CARD_RADIUS,
      background: COLORS.headerBg,
      title,
      titleStyle: { fill: COLORS.headerText, fontSize: 12, fontWeight: "bold" },
      paddingX: HEADER_PAD_X,
      paddingY: HEADER_PAD_Y,
      pinOffsetX: 40,
      closeOffsetX: 10,
      dragTarget: opts.dragTarget,
      onPinToggle: () => opts.onPinToggle?.(process, target),
      onClose: () => opts.onClose?.(process, target),
    });
    headerUi.setPinned(!!pinned);

    if (isGrowthGroup && growthEntries) {
      const batchText = new PIXI.Text(`${growthEntries.length} batches`, {
        fill: COLORS.headerSub,
        fontSize: 9,
      });
      batchText.x = headerUi.titleText.x + headerUi.titleText.width + 6;
      batchText.y = HEADER_PAD_Y + 1;
      headerUi.container.addChild(batchText);
    } else if (count > 1) {
      const idxText = new PIXI.Text(`${index + 1}/${count}`, {
        fill: COLORS.headerSub,
        fontSize: 9,
      });
      idxText.x = headerUi.titleText.x + headerUi.titleText.width + 6;
      idxText.y = HEADER_PAD_Y + 1;
      headerUi.container.addChild(idxText);
    }

    const body = new PIXI.Container();
    body.y = HEADER_HEIGHT + 6;
    card.addChild(body);

    const bodyHeightTarget = MIN_BODY_CONTENT_HEIGHT;

    const central = new PIXI.Container();
    central.x = segments.find((s) => s.key === "central").x;
    central.y = BODY_PAD;
    body.addChild(central);

    const variant = variantOverride || getProcessVariant(process, processDef);
    const processSystemId = entry?.systemId || routingSystemId || null;
    const outputs = Array.isArray(processDef?.transform?.outputs)
      ? processDef.transform.outputs
      : [];
    const reqs = Array.isArray(processDef?.transform?.requirements)
      ? processDef.transform.requirements
      : [];

    let outputSelectionControl = null;
    if (variant === "growing") {
      const cropId = target?.systemState?.growth?.selectedCropId ?? null;
      outputSelectionControl = {
        label: formatCropName(cropId),
        enabled: true,
        onOpen: (bounds) => openGrowthSelectionDropdown(target, bounds),
      };
    } else if (isRecipeSystem(processSystemId)) {
      const recipeId = getSelectedRecipeId(target, processSystemId);
      outputSelectionControl = {
        label: formatRecipeName(recipeId),
        enabled: true,
        onOpen: (bounds) =>
          openRecipeSelectionDropdown(target, processSystemId, bounds),
      };
    }

    const modules = [];
    if (variant === "growing") {
      modules.push("progress", "output");
    } else if (variant === "depositing") {
      if (canWithdrawFromTarget(target)) modules.push("prestige", "withdraw");
      else modules.push("prestige", "output");
    } else if (variant === "building") {
      modules.push("requirements", "progress");
    } else if (variant === "cooking" || variant === "crafting") {
      modules.push("requirements", "progress", "output");
    } else {
      modules.push("requirements", "progress", "output");
    }

    const forceModules =
      opts.forceModules instanceof Set ? opts.forceModules : null;
    const filteredModules = modules.filter((id) => {
      if (forceModules?.has(id)) return true;
      if (id === "requirements") return reqs.length > 0;
      if (id === "output") return isGrowthGroup ? true : outputs.length > 0;
      return true;
    });

    const moduleCount = filteredModules.length || 1;
    const moduleWidth = Math.floor(
      (centralWidth - (moduleCount - 1) * MODULE_GAP) / moduleCount
    );

    let moduleX = 0;
    let moduleMaxHeight = 0;
    const moduleViews = [];

    for (const id of filteredModules) {
      const mod = new PIXI.Container();
      mod.x = moduleX;
      mod.y = 0;
      central.addChild(mod);

      let height = 0;
      if (id === "progress") {
        if (isGrowthGroup) {
          height = buildGrowthProgressModule({
            container: mod,
            width: moduleWidth,
            entries: growthEntries,
          });
        } else {
          const vertical = processDef?.transform?.mode !== "work";
          height = buildProgressModule({
            container: mod,
            width: moduleWidth,
            process,
            processDef,
            vertical,
          });
        }
      } else if (id === "requirements") {
        height = buildRequirementsModule({
          container: mod,
          width: moduleWidth,
          reqs,
        });
      } else if (id === "output") {
        if (isGrowthGroup) {
          const pool = target?.systemState?.growth?.maturedPool || null;
          height = buildGrowthOutputModule({
            container: mod,
            width: moduleWidth,
            pool,
            selectionControl: outputSelectionControl,
          });
        } else {
          const primaryPool = outputs.find((out) => out?.kind === "pool");
          let poolSummary = null;
          if (primaryPool) {
            const endpointId = resolveLockedOutputEndpoint(
              process,
              processDef,
              primaryPool
            );
            if (endpointId) {
              const poolTarget = resolveEndpointTarget(state, endpointId);
              poolSummary = formatPoolSummary(poolTarget);
            }
          }
          height = buildOutputModule({
            container: mod,
            width: moduleWidth,
            outputs,
            poolSummary,
            selectionControl: outputSelectionControl,
          });
        }
      } else if (id === "prestige") {
        height = buildPrestigeModule({
          container: mod,
          width: moduleWidth,
          process,
        });
      } else if (id === "withdraw") {
        const depositInfo = getDepositPoolTarget(target);
        const pool = depositInfo?.pool ?? null;
        const withdrawState = getWithdrawState(target);
        height = buildWithdrawModule({
          container: mod,
          width: moduleWidth,
          pool,
          withdrawState,
          onOpenItemDropdown: (bounds) =>
            openWithdrawItemDropdown(target, bounds),
          onWithdraw: (itemId, qty) => requestPoolWithdraw(target, itemId, qty),
        });
      }

      collectModuleView(moduleViews, mod, moduleWidth);
      moduleMaxHeight = Math.max(moduleMaxHeight, height);
      moduleX += moduleWidth + MODULE_GAP;
    }

    central.y = BODY_PAD;
    central.height = moduleMaxHeight;

    let leftDrawer = null;
    let rightDrawer = null;
    const drawerHeightTarget = Math.max(
      bodyHeightTarget,
      moduleMaxHeight,
      showDropbox ? DROPBOX_SIZE + 18 : 0
    );

    if (inputDrawerVisible) {
      leftDrawer = buildRoutingDrawer({
        kind: "inputs",
        width: leftDrawerWidth,
        height: drawerHeightTarget,
        process,
        processDef,
        routingProcess,
        routingProcessDef,
        routingState,
        routingMode,
        targetRef: routingTargetRef,
        systemId: routingSystemId,
        drawerKey,
        target,
        state,
        hideDrop: showDropbox,
      });
      leftDrawer.container.x = segments.find((s) => s.key === "left").x;
      leftDrawer.container.y = BODY_PAD;
      body.addChild(leftDrawer.container);
    }

    let dropbox = null;
    if (showDropbox) {
      dropbox = new PIXI.Container();
      dropbox.x = segments.find((s) => s.key === "dropbox").x;
      dropbox.y = BODY_PAD;
      body.addChild(dropbox);
    }

    if (outputDrawerVisible) {
      rightDrawer = buildRoutingDrawer({
        kind: "outputs",
        width: rightDrawerWidth,
        height: drawerHeightTarget,
        process,
        processDef,
        routingProcess,
        routingProcessDef,
        routingState,
        routingMode,
        targetRef: routingTargetRef,
        systemId: routingSystemId,
        drawerKey,
        target,
        state,
        hideDrop: false,
      });
      rightDrawer.container.x = segments.find((s) => s.key === "right").x;
      rightDrawer.container.y = BODY_PAD;
      body.addChild(rightDrawer.container);
    }

    const leftHeight = leftDrawer?.container?.height || 0;
    const rightHeight = rightDrawer?.container?.height || 0;
    const dropboxHeight = showDropbox ? DROPBOX_SIZE + 18 : 0;
    const bodyContentHeight = Math.max(
      moduleMaxHeight,
      leftHeight,
      rightHeight,
      dropboxHeight,
      bodyHeightTarget
    );
    stretchModuleViews(moduleViews, bodyContentHeight);
    central.height = bodyContentHeight;

    const bodyHeight = bodyContentHeight + BODY_PAD * 2;

    if (leftDrawer) {
      leftDrawer.setHeight?.(bodyContentHeight);
    }
    if (rightDrawer) {
      rightDrawer.setHeight?.(bodyContentHeight);
    }

    if (showDropbox && dropbox) {
      buildDropboxModule({
        container: dropbox,
        width: DROPBOX_SIZE,
        height: bodyContentHeight,
        process,
        dropTargets: opts.dropTargets,
        labelText: "Dropbox",
        dropEnabled:
          typeof opts.dropboxInteractive === "boolean"
            ? opts.dropboxInteractive
            : true,
      });
    }

    central.y = BODY_PAD;
    const centralBg = new PIXI.Graphics();
    centralBg.beginFill(0x000000, 0);
    centralBg.drawRect(0, 0, centralWidth, bodyContentHeight);
    centralBg.endFill();
    central.addChildAt(centralBg, 0);

    const totalHeight = HEADER_HEIGHT + 6 + bodyHeight;
    drawCardBackground(bg, totalWidth, totalHeight);

    return { card, width: totalWidth, height: totalHeight };
  }

  return {
    buildProcessCard,
  };
}
