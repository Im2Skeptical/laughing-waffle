const DISCOVERY_ALWAYS_VISIBLE_ENV_TAG_ID_SET = new Set(["explore", "delve"]);

export function isDiscoveryAlwaysVisibleEnvTag(tagId) {
  if (typeof tagId !== "string" || tagId.length <= 0) return false;
  return DISCOVERY_ALWAYS_VISIBLE_ENV_TAG_ID_SET.has(tagId);
}
