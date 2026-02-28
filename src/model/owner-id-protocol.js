const PROCESS_DROPBOX_OWNER_PREFIX = "inv:dropbox:process:";
const HUB_DROPBOX_OWNER_PREFIX = "inv:dropbox:hub:";
const BASKET_DROPBOX_OWNER_PREFIX = "inv:dropbox:basket:";

export {
  PROCESS_DROPBOX_OWNER_PREFIX,
  HUB_DROPBOX_OWNER_PREFIX,
  BASKET_DROPBOX_OWNER_PREFIX,
};

export function isProcessDropboxOwnerId(ownerId) {
  return (
    typeof ownerId === "string" &&
    ownerId.startsWith(PROCESS_DROPBOX_OWNER_PREFIX)
  );
}

export function isHubDropboxOwnerId(ownerId) {
  return (
    typeof ownerId === "string" &&
    ownerId.startsWith(HUB_DROPBOX_OWNER_PREFIX)
  );
}

export function isBasketDropboxOwnerId(ownerId) {
  return (
    typeof ownerId === "string" &&
    ownerId.startsWith(BASKET_DROPBOX_OWNER_PREFIX)
  );
}

export function isAnyDropboxOwnerId(ownerId) {
  return (
    isProcessDropboxOwnerId(ownerId) ||
    isHubDropboxOwnerId(ownerId) ||
    isBasketDropboxOwnerId(ownerId)
  );
}

export function parseProcessDropboxOwnerId(ownerId) {
  if (!isProcessDropboxOwnerId(ownerId)) return null;
  const processId = ownerId.slice(PROCESS_DROPBOX_OWNER_PREFIX.length);
  return processId.length > 0 ? processId : null;
}

export function parseHubDropboxOwnerId(ownerId) {
  if (!isHubDropboxOwnerId(ownerId)) return null;
  const structureId = ownerId.slice(HUB_DROPBOX_OWNER_PREFIX.length);
  return structureId.length > 0 ? structureId : null;
}

export function parseBasketDropboxOwnerId(ownerId) {
  if (!isBasketDropboxOwnerId(ownerId)) return null;
  const raw = ownerId.slice(BASKET_DROPBOX_OWNER_PREFIX.length);
  if (raw.length <= 0) return null;
  const split = raw.split(":");
  const ownerPart = split[0];
  if (!ownerPart || ownerPart.length <= 0) return null;
  const slotId =
    split.length > 1 && split[1] && split[1].length > 0 ? split[1] : null;
  return { ownerId: ownerPart, slotId };
}

export function buildProcessDropboxOwnerId(processId) {
  if (processId == null) return null;
  const id = String(processId);
  return id.length > 0 ? `${PROCESS_DROPBOX_OWNER_PREFIX}${id}` : null;
}

export function buildHubDropboxOwnerId(ownerId) {
  if (ownerId == null) return null;
  const id = String(ownerId);
  return id.length > 0 ? `${HUB_DROPBOX_OWNER_PREFIX}${id}` : null;
}

export function buildBasketDropboxOwnerId(ownerId, slotId = null) {
  if (ownerId == null) return null;
  const id = String(ownerId);
  if (id.length <= 0) return null;
  const slot =
    typeof slotId === "string" && slotId.length > 0 ? `:${slotId}` : "";
  return `${BASKET_DROPBOX_OWNER_PREFIX}${id}${slot}`;
}

