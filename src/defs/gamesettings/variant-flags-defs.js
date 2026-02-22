// variant-flags-defs.js
// Scenario-level gameplay/UI variant switches.

export const DEFAULT_VARIANT_FLAGS = Object.freeze({
  actionPointCostsEnabled: false,
  actionLogEnabled: false,
  inventoryTransferPlannerEnabled: false,
  inventoryTransferGhostPreviewEnabled: false,
  showApHud: false,
});

export function normalizeVariantFlags(value) {
  const raw = value && typeof value === "object" ? value : {};
  return {
    actionPointCostsEnabled: raw.actionPointCostsEnabled !== false,
    actionLogEnabled: raw.actionLogEnabled !== false,
    inventoryTransferPlannerEnabled: raw.inventoryTransferPlannerEnabled !== false,
    inventoryTransferGhostPreviewEnabled:
      raw.inventoryTransferGhostPreviewEnabled !== false,
    showApHud: raw.showApHud !== false,
  };
}
