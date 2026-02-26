const PROCESS_DROPBOX_OWNER_PREFIX = "inv:dropbox:process:";
const HUB_DROPBOX_OWNER_PREFIX = "inv:dropbox:hub:";

export {
  PROCESS_DROPBOX_OWNER_PREFIX,
  HUB_DROPBOX_OWNER_PREFIX,
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

export function isAnyDropboxOwnerId(ownerId) {
  return isProcessDropboxOwnerId(ownerId) || isHubDropboxOwnerId(ownerId);
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

