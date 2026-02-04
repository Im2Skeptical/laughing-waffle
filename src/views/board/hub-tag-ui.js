// hub-tag-ui.js
// Tag UI helpers for hub structures.

import { hubTagDefs } from "../../defs/gamesystems/hub-tag-defs.js";

const TAG_PILL_HEIGHT = 20;
const TAG_PILL_RADIUS = 10;
const TAG_PILL_PAD_X = 8;
const TAG_PILL_GAP = 6;
const TAG_PILL_MAX_WIDTH = 90;
const TAG_PILL_WIDTH = TAG_PILL_MAX_WIDTH;
const TAG_TOGGLE_SIZE = 12;
const TAG_TOGGLE_PAD = 4;
const TAG_LABEL_X = TAG_PILL_PAD_X + TAG_TOGGLE_SIZE + TAG_TOGGLE_PAD;
const TAG_ROW_SCALE_ACTIVE = 1.05;
const TAG_PILL_BG_ACTIVE = 0x1f263d;
const TAG_PILL_BG_TOP = 0x2a3958;
const TAG_PILL_BG_LOW = 0x273245;
const TAG_PILL_BG_BYPASSED = 0x4b252c;
const TAG_PILL_BORDER_ACTIVE = 0x1b2a42;
const TAG_PILL_BORDER_TOP = 0x1e2c44;
const TAG_PILL_BORDER_LOW = 0x141c2b;
const TAG_PILL_BORDER_BYPASSED = 0x7a2d36;
const TAG_PILL_TEXT = 0xe6eef9;
const TAG_PILL_TEXT_LOW = 0xb8c2d6;
const TAG_PILL_TEXT_BYPASSED = 0xf2b0b0;

const TAG_PILL_STYLES = {
  active: {
    bgColor: TAG_PILL_BG_ACTIVE,
    borderColor: TAG_PILL_BORDER_ACTIVE,
    textColor: TAG_PILL_TEXT,
    alpha: 1,
    rowScale: TAG_ROW_SCALE_ACTIVE,
  },
  topInactive: {
    bgColor: TAG_PILL_BG_TOP,
    borderColor: TAG_PILL_BORDER_TOP,
    textColor: TAG_PILL_TEXT,
    alpha: 0.95,
    rowScale: 1,
  },
  low: {
    bgColor: TAG_PILL_BG_LOW,
    borderColor: TAG_PILL_BORDER_LOW,
    textColor: TAG_PILL_TEXT_LOW,
    alpha: 0.7,
    rowScale: 1,
  },
  bypassed: {
    bgColor: TAG_PILL_BG_BYPASSED,
    borderColor: TAG_PILL_BORDER_BYPASSED,
    textColor: TAG_PILL_TEXT_BYPASSED,
    alpha: 0.9,
    rowScale: 1,
  },
};

export const HUB_TAG_LAYOUT = {
  PILL_HEIGHT: TAG_PILL_HEIGHT,
  PILL_RADIUS: TAG_PILL_RADIUS,
  PILL_PAD_X: TAG_PILL_PAD_X,
  PILL_GAP: TAG_PILL_GAP,
  PILL_WIDTH: TAG_PILL_WIDTH,
};

export function createHubTagUi(opts) {
  const {
    tooltipView,
    startTagDrag,
    setTextResolution,
    baseTextResolution,
    hoverTextResolution,
    requestPauseForAction,
    toggleTag,
  } = opts;

  function getTagLabel(tagId) {
    const def = hubTagDefs[tagId];
    return def?.ui?.name || tagId;
  }

  function getTagTooltipLines(tagId) {
    const def = hubTagDefs[tagId];
    const lines = [];
    if (def?.ui?.description) lines.push(def.ui.description);
    return lines;
  }

  function isTagDisabled(structure, tagId) {
    const entry = structure?.tagStates?.[tagId];
    return entry?.disabled === true;
  }

  function updateToggleVisual(entry, isDisabled) {
    if (!entry?.toggleBg || !entry?.toggleIcon) return;
    const fill = isDisabled ? 0x5a2a31 : 0x2e5c3f;
    const stroke = isDisabled ? 0xf2b0b0 : 0xcff5d6;

    entry.toggleBg.clear();
    entry.toggleBg
      .lineStyle(1, stroke, 0.9)
      .beginFill(fill, 0.95)
      .drawRoundedRect(0, 0, TAG_TOGGLE_SIZE, TAG_TOGGLE_SIZE, 3)
      .endFill();

    entry.toggleIcon.clear();
    if (isDisabled) {
      entry.toggleIcon
        .lineStyle(2, stroke, 1)
        .moveTo(3, 3)
        .lineTo(TAG_TOGGLE_SIZE - 3, TAG_TOGGLE_SIZE - 3)
        .moveTo(TAG_TOGGLE_SIZE - 3, 3)
        .lineTo(3, TAG_TOGGLE_SIZE - 3);
    } else {
      entry.toggleIcon.beginFill(0xd7ffe0, 1);
      entry.toggleIcon.drawCircle(TAG_TOGGLE_SIZE / 2, TAG_TOGGLE_SIZE / 2, 3);
      entry.toggleIcon.endFill();
    }
  }

  function setTagPillStyle(entry, style) {
    if (!entry || !style) return;
    const bgColor = style.bgColor ?? TAG_PILL_BG_LOW;
    const borderColor = style.borderColor ?? TAG_PILL_BORDER_LOW;
    const textColor = style.textColor ?? TAG_PILL_TEXT;
    const alpha = style.alpha ?? 1;
    const rowScale = style.rowScale ?? 1;

    if (entry.bgColor !== bgColor || entry.borderColor !== borderColor) {
      entry.bg.clear();
      entry.bg
        .lineStyle(1, borderColor, 0.9)
        .beginFill(bgColor, 0.95)
        .drawRoundedRect(0, 0, TAG_PILL_WIDTH, TAG_PILL_HEIGHT, TAG_PILL_RADIUS)
        .endFill();
      entry.bgColor = bgColor;
      entry.borderColor = borderColor;
    }

    if (entry.labelText?.style?.fill !== textColor) {
      entry.labelText.style.fill = textColor;
      entry.labelText.dirty = true;
    }
    if (entry.expandText?.style?.fill !== textColor) {
      entry.expandText.style.fill = textColor;
      entry.expandText.dirty = true;
    }

    entry.container.alpha = alpha;

    if (entry.rowScale !== rowScale) {
      entry.rowScale = rowScale;
      entry.row.scale.set(rowScale);
    }
  }

  function buildTagEntry(view, tagId) {
    const container = new PIXI.Container();
    const row = new PIXI.Container();
    row.eventMode = "static";
    row.cursor = "grab";
    container.addChild(row);

    const bg = new PIXI.Graphics()
      .lineStyle(1, TAG_PILL_BORDER_LOW, 0.9)
      .beginFill(TAG_PILL_BG_LOW, 0.95)
      .drawRoundedRect(0, 0, TAG_PILL_WIDTH, TAG_PILL_HEIGHT, TAG_PILL_RADIUS)
      .endFill();
    row.addChild(bg);

    const toggle = new PIXI.Container();
    toggle.x = TAG_PILL_PAD_X - 2;
    toggle.y = Math.round((TAG_PILL_HEIGHT - TAG_TOGGLE_SIZE) / 2);
    toggle.eventMode = "static";
    toggle.cursor = "pointer";
    row.addChild(toggle);

    const toggleBg = new PIXI.Graphics();
    toggle.addChild(toggleBg);

    const toggleIcon = new PIXI.Graphics();
    toggle.addChild(toggleIcon);

    const label = getTagLabel(tagId);
    const labelText = new PIXI.Text(label, {
      fill: TAG_PILL_TEXT,
      fontSize: 10,
      wordWrap: false,
    });
    labelText.x = TAG_LABEL_X;
    labelText.y = Math.round((TAG_PILL_HEIGHT - labelText.height) / 2);
    row.addChild(labelText);

    const expandText = new PIXI.Text(">", {
      fill: TAG_PILL_TEXT,
      fontSize: 10,
    });
    expandText.x = TAG_PILL_WIDTH - 14;
    expandText.y = Math.round((TAG_PILL_HEIGHT - expandText.height) / 2);
    row.addChild(expandText);

    const entry = {
      tagId,
      container,
      row,
      bg,
      bgColor: TAG_PILL_BG_LOW,
      borderColor: TAG_PILL_BORDER_LOW,
      labelText,
      expandText,
      toggle,
      toggleBg,
      toggleIcon,
      rowScale: 1,
      expanded: false,
      height: TAG_PILL_HEIGHT,
    };

    entry.setExpanded = (expanded) => {
      entry.expanded = !!expanded;
      entry.expandText.text = entry.expanded ? "v" : ">";
    };

    toggle.on("pointerdown", (ev) => {
      ev?.stopPropagation?.();
      view.ignoreNextTagTap = true;
    });
    toggle.on("pointertap", (ev) => {
      ev?.stopPropagation?.();
      view.ignoreNextTagTap = true;
      view.hasTagToggle = true;
      requestPauseForAction?.();
      if (typeof toggleTag === "function") {
        toggleTag({
          hubCol: Number.isFinite(view.structure?.col)
            ? Math.floor(view.structure.col)
            : view.col,
          tagId,
        });
      }
    });

    row.on("pointerover", () => {
      const lines = getTagTooltipLines(tagId);
      if (lines.length && tooltipView) {
        tooltipView.show({ title: getTagLabel(tagId), lines }, row.getBounds());
      }
    });
    row.on("pointerout", () => {
      tooltipView?.hide?.();
    });
    row.on("pointerdown", (ev) => {
      if (view.ignoreNextTagTap) view.ignoreNextTagTap = false;
      startTagDrag?.(view, entry, ev);
    });
    row.on("pointertap", (ev) => {
      ev?.stopPropagation?.();
      if (view.ignoreNextTagTap) {
        view.ignoreNextTagTap = false;
        return;
      }
      view.hasTagToggle = true;
      const next = view.expandedTagId === tagId ? null : tagId;
      view.expandedTagId = next;
      for (const entry of view.tagEntries || []) {
        entry.setExpanded(entry.tagId === view.expandedTagId);
      }
      layoutTagEntries(view);
    });

    return entry;
  }

  function layoutTagEntries(view) {
    const entries = view.tagEntries || [];
    const tagMaxY =
      typeof view.tagMaxY === "number" ? view.tagMaxY : 0;
    const maxHeight = Math.max(0, tagMaxY - view.tagStartY);

    let y = 0;
    for (const entry of entries) {
      if (!entry) continue;
      const rowScale = entry.rowScale ?? 1;
      const rowHeight = TAG_PILL_HEIGHT * rowScale;
      const spaceRemaining = maxHeight - y;
      if (spaceRemaining < rowHeight) {
        entry.container.visible = false;
        continue;
      }
      entry.container.visible = true;
      entry.container.x = 0;
      entry.container.y = y;
      entry.height = rowHeight;
      y += rowHeight + TAG_PILL_GAP;
    }
  }

  function updateTagEntries(view, structure) {
    const tags = Array.isArray(structure?.tags) ? structure.tags : [];
    const enabledTags = tags.filter((tagId) => !isTagDisabled(structure, tagId));
    const topTagId = enabledTags[0] ?? null;
    const pawnCount =
      Number.isFinite(view?.pawnCount) && view.pawnCount > 0
        ? Math.floor(view.pawnCount)
        : 0;
    const hasPawn = pawnCount > 0;
    const activeTagIds = new Set(
      hasPawn ? enabledTags.slice(0, pawnCount) : []
    );
    for (const entry of view.tagEntries || []) {
      const isDisabled = isTagDisabled(structure, entry.tagId);
      const isActive =
        hasPawn &&
        !isDisabled &&
        (activeTagIds.has(entry.tagId) || entry.tagId === topTagId);
      const isTopInactive =
        !hasPawn && entry.tagId === topTagId && !isDisabled;
      const isLowerPriority = !isDisabled && entry.tagId !== topTagId;

      let style = TAG_PILL_STYLES.low;
      if (isDisabled) {
        style = TAG_PILL_STYLES.bypassed;
      } else if (isActive) {
        style = TAG_PILL_STYLES.active;
      } else if (isTopInactive) {
        style = TAG_PILL_STYLES.topInactive;
      } else if (isLowerPriority) {
        style = TAG_PILL_STYLES.low;
      }

      setTagPillStyle(entry, style);
      updateToggleVisual(entry, isDisabled);
    }
  }

  function rebuildStructureTags(view, structure) {
    const tags = Array.isArray(structure?.tags) ? structure.tags : [];
    view.tagSignature = tags.join("|");

    view.tagContainer.removeChildren();
    view.tagEntries = [];
    view.tagContainer.sortableChildren = false;

    if (view.expandedTagId && !tags.includes(view.expandedTagId)) {
      view.expandedTagId = null;
    }

    if (!view.hasTagToggle) {
      const pawnCount =
        Number.isFinite(view?.pawnCount) && view.pawnCount > 0
          ? Math.floor(view.pawnCount)
          : 0;
      const enabledTags = tags.filter((tagId) => !isTagDisabled(structure, tagId));
      const activeTagId = pawnCount > 0 ? enabledTags[0] ?? null : null;
      view.expandedTagId = activeTagId;
    }

    for (const tagId of tags) {
      const entry = buildTagEntry(view, tagId);
      entry.setExpanded(view.expandedTagId === tagId);
      view.tagContainer.addChild(entry.container);
      view.tagEntries.push(entry);
    }

    if (Array.isArray(view.hoverTextNodes)) {
      view.hoverTextNodes.length = 0;
      if (Array.isArray(view.hoverTextBaseNodes)) {
        view.hoverTextNodes.push(...view.hoverTextBaseNodes);
      }
      for (const entry of view.tagEntries) {
        if (entry?.labelText) view.hoverTextNodes.push(entry.labelText);
        if (entry?.expandText) view.hoverTextNodes.push(entry.expandText);
      }
      setTextResolution?.(
        view.hoverTextNodes,
        view.isHovered ? hoverTextResolution : baseTextResolution
      );
    }

    layoutTagEntries(view);
    updateTagEntries(view, structure);
  }

  return {
    rebuildStructureTags,
    updateTagEntries,
    layoutTagEntries,
  };
}
