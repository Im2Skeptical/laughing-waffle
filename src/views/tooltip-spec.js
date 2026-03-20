function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function makeTextSegment(text) {
  return {
    kind: "text",
    text: typeof text === "string" ? text : String(text ?? ""),
  };
}

function normalizeParagraphContent(content) {
  const rawSegments = Array.isArray(content) ? content : [content];
  const segments = [];
  for (const entry of rawSegments) {
    if (entry == null) continue;
    if (typeof entry === "string" || typeof entry === "number") {
      const text = String(entry);
      if (!text.length) continue;
      segments.push(makeTextSegment(text));
      continue;
    }
    if (typeof entry !== "object") continue;
    if (entry.kind === "keyword" && isNonEmptyString(entry.keywordId)) {
      segments.push({
        kind: "keyword",
        keywordId: entry.keywordId,
        text: isNonEmptyString(entry.text) ? entry.text : entry.keywordId,
      });
      continue;
    }
    if (isNonEmptyString(entry.text)) {
      segments.push(makeTextSegment(entry.text));
    }
  }
  return segments;
}

function normalizeMeterSection(section) {
  const label = isNonEmptyString(section?.label) ? section.label : "";
  const value = Number.isFinite(section?.value) ? Number(section.value) : 0;
  const max = Number.isFinite(section?.max) ? Number(section.max) : 0;
  return {
    type: "meter",
    label,
    value,
    max,
    accentColor: Number.isFinite(section?.accentColor) ? section.accentColor : null,
    text: isNonEmptyString(section?.text) ? section.text : null,
  };
}

function normalizeTableSection(section) {
  const rows = [];
  for (const row of asArray(section?.rows)) {
    if (!row) continue;
    const label =
      typeof row.label === "string" || typeof row.label === "number"
        ? String(row.label)
        : "";
    const value =
      typeof row.value === "string" || typeof row.value === "number"
        ? String(row.value)
        : "";
    if (!label && !value) continue;
    rows.push({ label, value });
  }
  return {
    type: "table",
    title: isNonEmptyString(section?.title) ? section.title : null,
    rows,
  };
}

function normalizeKeywordRowSection(section) {
  const entries = [];
  for (const entry of asArray(section?.entries)) {
    if (!entry) continue;
    if (typeof entry === "string") {
      entries.push({ keywordId: entry, text: entry });
      continue;
    }
    if (typeof entry !== "object" || !isNonEmptyString(entry.keywordId)) continue;
    entries.push({
      keywordId: entry.keywordId,
      text: isNonEmptyString(entry.text) ? entry.text : entry.keywordId,
    });
  }
  return {
    type: "keywordRow",
    title: isNonEmptyString(section?.title) ? section.title : null,
    entries,
  };
}

function normalizeSection(section) {
  if (section == null) return null;
  if (typeof section === "string" || typeof section === "number") {
    const text = String(section);
    if (!text.length) return null;
    return {
      type: "paragraph",
      segments: [makeTextSegment(text)],
    };
  }
  if (typeof section !== "object") return null;
  const type = isNonEmptyString(section.type) ? section.type : "paragraph";
  if (type === "meter") return normalizeMeterSection(section);
  if (type === "table") return normalizeTableSection(section);
  if (type === "keywordRow") return normalizeKeywordRowSection(section);
  const segments = normalizeParagraphContent(section.segments ?? section.text ?? "");
  if (!segments.length) return null;
  return {
    type: "paragraph",
    title: isNonEmptyString(section?.title) ? section.title : null,
    segments,
  };
}

export function makeParagraphSection(segments, title = null) {
  return normalizeSection({
    type: "paragraph",
    title,
    segments,
  });
}

export function makeTableSection(title, rows) {
  return normalizeSection({
    type: "table",
    title,
    rows,
  });
}

export function makeKeywordRowSection(entries, title = null) {
  return normalizeSection({
    type: "keywordRow",
    title,
    entries,
  });
}

export function makeMeterSection({
  label,
  value,
  max,
  accentColor = null,
  text = null,
} = {}) {
  return normalizeSection({
    type: "meter",
    label,
    value,
    max,
    accentColor,
    text,
  });
}

function coerceLegacyLinesToSections(lines) {
  const out = [];
  for (const line of asArray(lines)) {
    if (line == null) continue;
    const text = String(line);
    if (!text.length) continue;
    out.push({
      type: "paragraph",
      segments: [makeTextSegment(text)],
    });
  }
  return out;
}

export function normalizeTooltipSpec(spec) {
  const input = spec && typeof spec === "object" ? spec : {};
  const sections =
    asArray(input.sections)
      .map((section) => normalizeSection(section))
      .filter(Boolean);
  const normalizedSections =
    sections.length > 0 ? sections : coerceLegacyLinesToSections(input.lines);
  const debugSections =
    asArray(input.debugSections)
      .map((section) => normalizeSection(section))
      .filter(Boolean);
  return {
    title: isNonEmptyString(input.title) ? input.title : "",
    subtitle: isNonEmptyString(input.subtitle) ? input.subtitle : "",
    accentColor: Number.isFinite(input.accentColor)
      ? input.accentColor
      : Number.isFinite(input.color)
      ? input.color
      : null,
    sections: normalizedSections,
    debugSections: debugSections.length > 0 ? debugSections : normalizedSections,
    sourceKind: isNonEmptyString(input.sourceKind) ? input.sourceKind : null,
    sourceId: input.sourceId ?? null,
    maxWidth: Number.isFinite(input.maxWidth) ? Math.max(120, Math.floor(input.maxWidth)) : 280,
    scale: Number.isFinite(input.scale) ? input.scale : 1,
    legacyLines: asArray(input.lines).map((line) => String(line ?? "")),
  };
}
