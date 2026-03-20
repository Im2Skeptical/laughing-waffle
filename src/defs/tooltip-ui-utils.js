function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function ensureTooltipCardUi(
  registry,
  { getTitle = null, getLines = null, getKeywords = null } = {}
) {
  if (!registry || typeof registry !== "object") return registry;
  for (const def of Object.values(registry)) {
    if (!def || typeof def !== "object") continue;
    if (!def.ui || typeof def.ui !== "object") def.ui = {};
    if (!def.ui.tooltipCard || typeof def.ui.tooltipCard !== "object") {
      const title =
        typeof getTitle === "function"
          ? getTitle(def)
          : def.ui.title || def.ui.name || def.name || def.id || "";
      const lines =
        typeof getLines === "function"
          ? asArray(getLines(def)).filter(Boolean)
          : asArray(def.ui.lines).length > 0
          ? asArray(def.ui.lines).filter(Boolean)
          : def.ui.description
          ? [def.ui.description]
          : [];
      def.ui.tooltipCard = {
        title,
        lines,
      };
    }
    if (!Array.isArray(def.ui.keywords)) {
      def.ui.keywords =
        typeof getKeywords === "function"
          ? asArray(getKeywords(def)).filter(Boolean)
          : [];
    }
  }
  return registry;
}
