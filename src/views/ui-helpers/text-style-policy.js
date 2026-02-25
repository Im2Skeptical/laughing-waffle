const PATCH_SENTINEL = "__lwTextTypographyPatched";
const ORIGINAL_TEXT_CTOR = "__lwOriginalTextCtor";

export const TEXT_STYLE_POLICY_FLAGS = Object.freeze({
  preserveFontFamily: "__preserveFontFamily",
  skipPolicy: "__skipTypographyPolicy",
  forceTitleSmallCaps: "__forceTitleSmallCaps",
  disableTitleSmallCaps: "__disableTitleSmallCaps",
});

function toFiniteNumber(value) {
  if (Number.isFinite(value)) return Number(value);
  if (typeof value === "string") {
    const parsed = Number(value.replace(/px$/i, "").trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toFontWeightNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return 400;
  const normalized = value.trim().toLowerCase();
  if (normalized === "bold" || normalized === "bolder") return 700;
  if (normalized === "normal" || normalized === "lighter") return 400;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 400;
}

function normalizeTextValue(rawText) {
  if (typeof rawText === "string") return rawText;
  if (rawText == null) return "";
  return String(rawText);
}

function shouldApplyTitleVariant(rawText, style, config, flags) {
  if (flags.disableTitleSmallCaps) return false;
  if (flags.forceTitleSmallCaps) return true;

  const size = toFiniteNumber(style?.fontSize);
  if (size != null && size >= config.titleMinSize) return true;

  const weight = toFontWeightNumber(style?.fontWeight);
  if (size == null || size < config.titleWeightMinSize || weight < config.titleWeightMin) {
    return false;
  }

  const text = normalizeTextValue(rawText).trim().replace(/\s+/g, " ");
  if (!text) return false;
  if (text.length > config.titleMaxChars) return false;
  if (text.split(" ").length > config.titleMaxWords) return false;
  return true;
}

function normalizeStyle(style, rawText, config) {
  const next = style && typeof style === "object" ? { ...style } : {};
  const flags = {
    preserveFontFamily: next[TEXT_STYLE_POLICY_FLAGS.preserveFontFamily] === true,
    skipPolicy: next[TEXT_STYLE_POLICY_FLAGS.skipPolicy] === true,
    forceTitleSmallCaps: next[TEXT_STYLE_POLICY_FLAGS.forceTitleSmallCaps] === true,
    disableTitleSmallCaps:
      next[TEXT_STYLE_POLICY_FLAGS.disableTitleSmallCaps] === true,
  };

  delete next[TEXT_STYLE_POLICY_FLAGS.preserveFontFamily];
  delete next[TEXT_STYLE_POLICY_FLAGS.skipPolicy];
  delete next[TEXT_STYLE_POLICY_FLAGS.forceTitleSmallCaps];
  delete next[TEXT_STYLE_POLICY_FLAGS.disableTitleSmallCaps];

  if (flags.skipPolicy) return next;

  if (!flags.preserveFontFamily) {
    next.fontFamily = config.fontFamily;
  }

  if (shouldApplyTitleVariant(rawText, next, config, flags)) {
    next.fontVariant = config.titleVariant;
  }

  return next;
}

function isTextOptionsObject(value) {
  return (
    value != null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.prototype.hasOwnProperty.call(value, "text")
  );
}

export function installGlobalTextStylePolicy(PIXI, options = {}) {
  if (!PIXI || typeof PIXI.Text !== "function") return false;
  if (PIXI.Text[PATCH_SENTINEL]) return false;

  const config = {
    fontFamily: typeof options.fontFamily === "string" ? options.fontFamily : "Georgia",
    titleVariant:
      typeof options.titleVariant === "string" ? options.titleVariant : "small-caps",
    titleMinSize: Number.isFinite(options.titleMinSize) ? Number(options.titleMinSize) : 20,
    titleWeightMinSize: Number.isFinite(options.titleWeightMinSize)
      ? Number(options.titleWeightMinSize)
      : 16,
    titleWeightMin: Number.isFinite(options.titleWeightMin)
      ? Number(options.titleWeightMin)
      : 700,
    titleMaxChars: Number.isFinite(options.titleMaxChars) ? Number(options.titleMaxChars) : 52,
    titleMaxWords: Number.isFinite(options.titleMaxWords) ? Number(options.titleMaxWords) : 7,
  };

  const OriginalText = PIXI.Text;
  class PatchedText extends OriginalText {
    constructor(textOrOptions, style, canvas) {
      if (isTextOptionsObject(textOrOptions) && style === undefined && canvas === undefined) {
        const normalizedStyle = normalizeStyle(textOrOptions.style, textOrOptions.text, config);
        super({ ...textOrOptions, style: normalizedStyle });
        return;
      }
      const normalizedStyle = normalizeStyle(style, textOrOptions, config);
      super(textOrOptions, normalizedStyle, canvas);
    }
  }

  PatchedText[PATCH_SENTINEL] = true;
  PatchedText[ORIGINAL_TEXT_CTOR] = OriginalText;
  Object.setPrototypeOf(PatchedText, OriginalText);
  PIXI.Text = PatchedText;
  return true;
}
