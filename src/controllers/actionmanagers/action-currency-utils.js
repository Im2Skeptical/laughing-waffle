// src/controllers/actionmanagers/action-currency-utils.js
// Shared helpers for currency transfer grouping and quantities.

function getItemTags(item) {
  return Array.isArray(item?.tags) ? item.tags : [];
}

export function isCurrencyItem(item) {
  return getItemTags(item).includes("currency");
}

export function getItemQuantity(item) {
  return Math.max(1, Math.floor(item?.quantity ?? 1));
}

function compareOwnerIds(a, b) {
  const aNum = Number(a);
  const bNum = Number(b);
  const aIsNum = Number.isFinite(aNum);
  const bIsNum = Number.isFinite(bNum);
  if (aIsNum && bIsNum) return aNum - bNum;
  const aStr = String(a);
  const bStr = String(b);
  if (aStr < bStr) return -1;
  if (aStr > bStr) return 1;
  return 0;
}

export function getCurrencyGroupInfo({ item, kind, fromOwnerId, toOwnerId } = {}) {
  if (!item || !isCurrencyItem(item)) return null;
  if (fromOwnerId == null || toOwnerId == null) return null;
  if (fromOwnerId === toOwnerId) return null;

  const itemKind = item.kind ?? kind ?? null;
  if (!itemKind) return null;

  const cmp = compareOwnerIds(fromOwnerId, toOwnerId);
  const minId = cmp <= 0 ? fromOwnerId : toOwnerId;
  const maxId = cmp <= 0 ? toOwnerId : fromOwnerId;
  const dir = cmp <= 0 ? 1 : -1;
  const key = `${itemKind}|${String(minId)}|${String(maxId)}`;
  return { key, dir, minId, maxId, kind: itemKind };
}