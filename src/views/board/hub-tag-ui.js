// hub-tag-ui.js
// Tag UI helpers for hub structures.

import { hubTagDefs } from "../../defs/gamesystems/hub-tag-defs.js";

const TAG_PILL_HEIGHT = 20;
const TAG_PILL_RADIUS = 10;
const TAG_PILL_PAD_X = 8;
const TAG_PILL_GAP = 6;
const TAG_PILL_MAX_WIDTH = 90;
const TAG_PILL_WIDTH = TAG_PILL_MAX_WIDTH;
const TAG_PILL_BG_ACTIVE = 0x1f263d;
const TAG_PILL_BG_INACTIVE = 0x2f4a6f;
const TAG_PILL_BORDER_ACTIVE = 0x1b2a42;
const TAG_PILL_BORDER_INACTIVE = 0x101524;
const TAG_PILL_TEXT = 0xe6eef9;

export const HUB_TAG_LAYOUT = {
  PILL_HEIGHT: TAG_PILL_HEIGHT,
  PILL_RADIUS: TAG_PILL_RADIUS,
  PILL_PAD_X: TAG_PILL_PAD_X,
  PILL_GAP: TAG_PILL_GAP,
  PILL_WIDTH: TAG_PILL_WIDTH,
};

export function createHubTagUi(opts) {
  const { tooltipView, startTagDrag, setTextResolution, baseTextResolution, hoverTextResolution } = opts;

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

  function setTagPillStyle(entry, isActive) {
    const bgColor = isActive ? TAG_PILL_BG_ACTIVE : TAG_PILL_BG_INACTIVE;
    const borderColor = isActive
      ? TAG_PILL_BORDER_ACTIVE
      : TAG_PILL_BORDER_INACTIVE;
    if (entry.bgColor === bgColor && entry.borderColor === borderColor) return;
    entry.bg.clear();
    entry.bg
      .lineStyle(1, borderColor, 0.9)
      .beginFill(bgColor, 0.95)
      .drawRoundedRect(0, 0, TAG_PILL_WIDTH, TAG_PILL_HEIGHT, TAG_PILL_RADIUS)
      .endFill();
    entry.bgColor = bgColor;
    entry.borderColor = borderColor;
  }

  function buildTagEntry(view, tagId) {
    const container = new PIXI.Container();
    const row = new PIXI.Container();
    row.eventMode = "static";
    row.cursor = "grab";
    container.addChild(row);

    const bg = new PIXI.Graphics()
      .lineStyle(1, TAG_PILL_BORDER_INACTIVE, 0.9)
      .beginFill(TAG_PILL_BG_INACTIVE, 0.95)
      .drawRoundedRect(0, 0, TAG_PILL_WIDTH, TAG_PILL_HEIGHT, TAG_PILL_RADIUS)
      .endFill();
    row.addChild(bg);

    const label = getTagLabel(tagId);
    const labelText = new PIXI.Text(label, {
      fill: TAG_PILL_TEXT,
      fontSize: 10,
      wordWrap: false,
    });
    labelText.x = TAG_PILL_PAD_X;
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
      bgColor: TAG_PILL_BG_INACTIVE,
      borderColor: TAG_PILL_BORDER_INACTIVE,
      labelText,
      expandText,
      expanded: false,
      height: TAG_PILL_HEIGHT,
    };

    entry.setExpanded = (expanded) => {
      entry.expanded = !!expanded;
      entry.expandText.text = entry.expanded ? "v" : ">";
    };

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
      const spaceRemaining = maxHeight - y;
      if (spaceRemaining < TAG_PILL_HEIGHT) {
        entry.container.visible = false;
        continue;
      }
      entry.container.visible = true;
      entry.container.x = 0;
      entry.container.y = y;
      entry.height = TAG_PILL_HEIGHT;
      y += TAG_PILL_HEIGHT + TAG_PILL_GAP;
    }
  }

  function updateTagEntries(view, structure) {
    const tags = Array.isArray(structure?.tags) ? structure.tags : [];
    const topTagId =
      tags.find((tagId) => !isTagDisabled(structure, tagId)) || null;
    for (const entry of view.tagEntries || []) {
      const isDisabled = isTagDisabled(structure, entry.tagId);
      const isActive = entry.tagId === topTagId && !isDisabled;
      setTagPillStyle(entry, isActive);
      entry.container.alpha = isDisabled ? 0.55 : 1;
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

    if (!view.hasTagToggle && view.expandedTagId == null && tags.length > 0) {
      view.expandedTagId = tags[0];
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
