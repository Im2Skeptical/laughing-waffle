import { keywordDefs } from "../defs/gamesystems/keyword-defs.js";
import {
  makeKeywordRowSection,
  makeParagraphSection,
} from "./tooltip-spec.js";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function interpolateTemplate(value, values) {
  if (typeof value !== "string" || value.length <= 0) return value ?? "";
  return value.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
    const replacement = values?.[key];
    return replacement == null ? "" : String(replacement);
  });
}

export function makeDefTooltipSpec({
  def = null,
  title = "",
  subtitle = "",
  lines = [],
  accentColor = null,
  sourceKind = null,
  sourceId = null,
  scale = 1,
  keywords = null,
  values = null,
  subject = null,
  context = null,
  extraSections = [],
} = {}) {
  const ui = def?.ui && typeof def.ui === "object" ? def.ui : {};
  const tooltipCard =
    ui?.tooltipCard && typeof ui.tooltipCard === "object" ? ui.tooltipCard : null;

  const resolvedTitleInput =
    title ||
    (typeof tooltipCard?.title === "function"
      ? tooltipCard.title(subject ?? values, context)
      : tooltipCard?.title) ||
    (typeof ui.title === "function" ? ui.title(subject ?? values, context) : ui.title) ||
    def?.name ||
    def?.id ||
    "";
  const resolvedSubtitleInput =
    subtitle ||
    (typeof tooltipCard?.subtitle === "function"
      ? tooltipCard.subtitle(subject ?? values, context)
      : tooltipCard?.subtitle) ||
    "";
  const resolvedTitle = interpolateTemplate(
    resolvedTitleInput,
    values
  );
  const resolvedSubtitle = interpolateTemplate(
    resolvedSubtitleInput,
    values
  );
  const resolvedLines = [
    ...asArray(tooltipCard?.lines)
      .map((line) => (typeof line === "function" ? line(subject ?? values, context) : line))
      .map((line) => interpolateTemplate(line, values))
      .filter(Boolean),
    ...asArray(lines).filter(Boolean),
  ];
  const keywordIds = Array.isArray(keywords)
    ? keywords.filter(Boolean)
    : asArray(ui?.keywords).filter(Boolean);
  const keywordEntries = keywordIds
    .map((keywordId) => {
      const defEntry = keywordDefs[keywordId];
      return {
        keywordId,
        text: defEntry?.label || keywordId,
      };
    })
    .filter((entry) => typeof entry.keywordId === "string" && entry.keywordId.length > 0);

  const sections = resolvedLines.map((line) => makeParagraphSection([String(line)]));
  if (keywordEntries.length > 0) {
    sections.push(makeKeywordRowSection(keywordEntries, "Keywords"));
  }
  sections.push(...asArray(extraSections).filter(Boolean));

  return {
    title: resolvedTitle,
    subtitle: resolvedSubtitle,
    accentColor,
    sourceKind,
    sourceId,
    scale,
    sections,
    debugSections: sections,
  };
}
