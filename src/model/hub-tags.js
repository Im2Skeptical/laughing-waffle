import { hubTagDefs } from "../defs/gamesystems/hub-tag-defs.js";

const HUB_TAG_PLAYER_ROLE_ACTIVE = "active";
const HUB_TAG_PLAYER_ROLE_PASSIVE = "passive";

export function getHubTagPlayerRole(tagId) {
  if (typeof tagId !== "string" || tagId.length <= 0) {
    return HUB_TAG_PLAYER_ROLE_PASSIVE;
  }
  const explicitRole = hubTagDefs?.[tagId]?.ui?.playerRole;
  return explicitRole === HUB_TAG_PLAYER_ROLE_ACTIVE
    ? HUB_TAG_PLAYER_ROLE_ACTIVE
    : HUB_TAG_PLAYER_ROLE_PASSIVE;
}

export function isHubTagPlayerActive(tagId) {
  return getHubTagPlayerRole(tagId) === HUB_TAG_PLAYER_ROLE_ACTIVE;
}

export function normalizeVisibleHubTagOrder(tagIds) {
  const ids = Array.isArray(tagIds) ? tagIds : [];
  const activeIds = [];
  const passiveIds = [];
  for (const tagId of ids) {
    if (isHubTagPlayerActive(tagId)) {
      activeIds.push(tagId);
      continue;
    }
    passiveIds.push(tagId);
  }
  return activeIds.concat(passiveIds);
}
