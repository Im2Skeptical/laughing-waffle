import { normalizeTooltipSpec } from "./tooltip-spec.js";
import { MUCHA_UI_COLORS } from "./ui-helpers/mucha-ui-palette.js";
import { applyTextResolution } from "./ui-helpers/text-resolution.js";

const PANEL_WIDTH = 340;
const PANEL_X = 18;
const PANEL_Y = 18;

function makeText(text, style) {
  const node = new PIXI.Text(text, style);
  applyTextResolution(node, 1);
  return node;
}

export function createDebugInspectorView({ layer }) {
  const container = new PIXI.Container();
  container.visible = false;
  container.eventMode = "none";
  layer.addChild(container);

  const bg = new PIXI.Graphics();
  container.addChild(bg);

  let enabled = false;
  let signature = "";

  function render(spec) {
    while (container.children.length > 1) {
      container.removeChildAt(1);
    }
    bg.clear();
    container.x = PANEL_X;
    container.y = PANEL_Y;

    const normalized = normalizeTooltipSpec(
      spec ?? {
        title: "Raw Inspector",
        subtitle: "No hover target",
        sections: [{ type: "paragraph", segments: ["Move the pointer over a target."] }],
      }
    );
    const sections =
      Array.isArray(normalized.debugSections) && normalized.debugSections.length > 0
        ? normalized.debugSections
        : normalized.sections;

    let cursorY = 10;
    const titleNode = makeText(normalized.title || "Raw Inspector", {
      fill: MUCHA_UI_COLORS?.ink?.primary ?? 0xffffff,
      fontSize: 14,
      fontWeight: "bold",
    });
    titleNode.x = 10;
    titleNode.y = cursorY;
    container.addChild(titleNode);
    cursorY += titleNode.height + 2;

    if (normalized.subtitle) {
      const subtitleNode = makeText(normalized.subtitle, {
        fill: MUCHA_UI_COLORS?.ink?.muted ?? 0xc9bba5,
        fontSize: 10,
        fontWeight: "bold",
      });
      subtitleNode.x = 10;
      subtitleNode.y = cursorY;
      container.addChild(subtitleNode);
      cursorY += subtitleNode.height + 8;
    }

    for (const section of sections) {
      if (!section) continue;
      if (section.type === "table") {
        if (section.title) {
          const sectionTitle = makeText(section.title, {
            fill: MUCHA_UI_COLORS?.ink?.muted ?? 0xc9bba5,
            fontSize: 10,
            fontWeight: "bold",
          });
          sectionTitle.x = 10;
          sectionTitle.y = cursorY;
          container.addChild(sectionTitle);
          cursorY += sectionTitle.height + 4;
        }
        for (const row of section.rows || []) {
          const line = makeText(`${row.label}: ${row.value}`, {
            fill: MUCHA_UI_COLORS?.ink?.primary ?? 0xffffff,
            fontSize: 10,
          });
          line.x = 10;
          line.y = cursorY;
          container.addChild(line);
          cursorY += line.height + 2;
        }
        cursorY += 4;
        continue;
      }

      let text = "";
      if (section.type === "meter") {
        text = `${section.label}: ${Math.round(section.value)}/${Math.round(section.max)}`;
      } else if (section.type === "keywordRow") {
        text = (section.entries || []).map((entry) => entry.text).join(" | ");
      } else {
        text = (section.segments || []).map((segment) => segment.text).join("");
      }
      if (section.title) {
        const sectionTitle = makeText(section.title, {
          fill: MUCHA_UI_COLORS?.ink?.muted ?? 0xc9bba5,
          fontSize: 10,
          fontWeight: "bold",
        });
        sectionTitle.x = 10;
        sectionTitle.y = cursorY;
        container.addChild(sectionTitle);
        cursorY += sectionTitle.height + 2;
      }
      if (text) {
        const body = makeText(text, {
          fill: MUCHA_UI_COLORS?.ink?.primary ?? 0xffffff,
          fontSize: 10,
          wordWrap: true,
          wordWrapWidth: PANEL_WIDTH - 20,
        });
        body.x = 10;
        body.y = cursorY;
        container.addChild(body);
        cursorY += body.height + 6;
      }
    }

    bg.beginFill(MUCHA_UI_COLORS?.surfaces?.panelDeep ?? 0x161310, 0.96);
    bg.lineStyle(2, normalized.accentColor ?? (MUCHA_UI_COLORS?.surfaces?.border ?? 0x8f7c60), 0.9);
    bg.drawRoundedRect(0, 0, PANEL_WIDTH, Math.max(80, cursorY + 8), 10);
    bg.endFill();
  }

  function setEnabled(nextEnabled) {
    enabled = nextEnabled === true;
    container.visible = enabled;
    if (enabled && !signature) {
      render(null);
      signature = "__empty__";
    }
  }

  function updateFromTooltipSpec(spec) {
    if (!enabled) return;
    const normalized = normalizeTooltipSpec(spec ?? null);
    const nextSignature = JSON.stringify({
      title: normalized.title,
      subtitle: normalized.subtitle,
      debugSections: normalized.debugSections,
      accentColor: normalized.accentColor,
    });
    if (signature === nextSignature) return;
    signature = nextSignature;
    render(spec);
  }

  function update() {}

  return {
    setEnabled,
    isEnabled: () => enabled,
    updateFromTooltipSpec,
    update,
    getScreenRect: () => {
      if (!container.visible) return null;
      const bounds = container.getBounds?.();
      if (!bounds) return null;
      return bounds;
    },
  };
}
