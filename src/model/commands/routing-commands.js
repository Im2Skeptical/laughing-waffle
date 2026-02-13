import {
  ensureProcessRoutingState,
  ensureSystemRoutingTemplate,
  getDropEndpointId,
  getProcessDefForInstance,
  getTemplateProcessForSystem,
  isDropEndpoint,
  listCandidateEndpoints,
  syncRoutingTemplateFromProcess,
} from "../process-framework.js";
import { cmdMoveItemBetweenOwners } from "./inventory-commands.js";

function normalizeSlotKind(value) {
  return value === "outputs" ? "outputs" : "inputs";
}

function findProcessInTarget(target, processId) {
  if (!target?.systemState || !processId) return null;
  const systems = target.systemState;
  for (const [systemId, sysState] of Object.entries(systems)) {
    const list = Array.isArray(sysState?.processes) ? sysState.processes : [];
    if (!list.length) continue;
    for (const proc of list) {
      if (proc?.id === processId) {
        return { process: proc, systemId, processList: list };
      }
    }
  }
  return null;
}

function findProcessById(state, processId) {
  if (!state || !processId) return null;
  const hubAnchors = Array.isArray(state?.hub?.anchors) ? state.hub.anchors : [];
  for (const anchor of hubAnchors) {
    if (!anchor) continue;
    const res = findProcessInTarget(anchor, processId);
    if (res) return { ...res, target: anchor, targetKind: "hub" };
  }
  const hubSlots = Array.isArray(state?.hub?.slots) ? state.hub.slots : [];
  for (const slot of hubSlots) {
    const structure = slot?.structure;
    if (!structure) continue;
    const res = findProcessInTarget(structure, processId);
    if (res) return { ...res, target: structure, targetKind: "hub" };
  }
  const tileAnchors = Array.isArray(state?.board?.layers?.tile?.anchors)
    ? state.board.layers.tile.anchors
    : [];
  for (const anchor of tileAnchors) {
    if (!anchor) continue;
    const res = findProcessInTarget(anchor, processId);
    if (res) return { ...res, target: anchor, targetKind: "env" };
  }
  return null;
}

function findTargetByRef(state, targetRef) {
  if (!state || !targetRef) return null;
  const kind = targetRef.kind;
  const id = targetRef.id ?? targetRef.instanceId ?? null;
  if (id == null) return null;
  if (kind === "hub") {
    const anchors = Array.isArray(state?.hub?.anchors) ? state.hub.anchors : [];
    for (const anchor of anchors) {
      if (!anchor) continue;
      if (String(anchor.instanceId) === String(id)) return anchor;
    }
    const slots = Array.isArray(state?.hub?.slots) ? state.hub.slots : [];
    for (const slot of slots) {
      const structure = slot?.structure;
      if (!structure) continue;
      if (String(structure.instanceId) === String(id)) return structure;
    }
    return null;
  }
  if (kind === "env") {
    const anchors = Array.isArray(state?.board?.layers?.tile?.anchors)
      ? state.board.layers.tile.anchors
      : [];
    for (const anchor of anchors) {
      if (!anchor) continue;
      if (String(anchor.instanceId) === String(id)) return anchor;
    }
    return null;
  }
  return null;
}

function resolveRoutingSlotDef(processDef, slotKind, slotId) {
  const kind = normalizeSlotKind(slotKind);
  const slots = processDef?.routingSlots?.[kind] || [];
  if (!Array.isArray(slots) || slots.length === 0) return null;
  if (slotId) {
    const match = slots.find((slot) => slot?.slotId === slotId);
    if (match) return match;
  }
  return null;
}

function applyRoutingPatchToSlot(slotState, patch) {
  if (!slotState || typeof slotState !== "object" || !patch) return false;
  let changed = false;
  if (Array.isArray(patch.ordered)) {
    slotState.ordered = patch.ordered.filter(
      (entry) => typeof entry === "string" && entry.length
    );
    changed = true;
  }
  if (patch.enabled && typeof patch.enabled === "object") {
    for (const [endpointId, enabled] of Object.entries(patch.enabled)) {
      slotState.enabled[endpointId] = enabled === true;
      changed = true;
    }
  }
  return changed;
}

function enforceDropslotPriority(process, processDef) {
  if (!processDef?.supportsDropslot) return false;
  const dropId = getDropEndpointId(process?.id);
  if (!dropId) return false;
  let changed = false;
  const inputSlots = process?.routing?.inputs || {};
  for (const slotState of Object.values(inputSlots)) {
    if (!slotState || !Array.isArray(slotState.ordered)) continue;
    const idx = slotState.ordered.indexOf(dropId);
    if (idx === 0) {
      slotState.enabled[dropId] = true;
      continue;
    }
    if (idx > 0) {
      slotState.ordered.splice(idx, 1);
      slotState.ordered.unshift(dropId);
      slotState.enabled[dropId] = true;
      changed = true;
      continue;
    }
    slotState.ordered.unshift(dropId);
    slotState.enabled[dropId] = true;
    changed = true;
  }
  return changed;
}

export function cmdSetProcessRouting(state, { processId, routingPatch } = {}) {
  if (!processId || typeof processId !== "string") {
    return { ok: false, reason: "badProcessId" };
  }
  const found = findProcessById(state, processId);
  if (!found?.process) return { ok: false, reason: "noProcess" };
  const context = {
    target: found.target,
    systemId: found.systemId,
    leaderId: found.process?.leaderId ?? null,
  };
  const processDef = getProcessDefForInstance(found.process, found.target, context);
  if (!processDef) return { ok: false, reason: "noProcessDef" };
  ensureProcessRoutingState(found.process, processDef, context);

  const patch = routingPatch && typeof routingPatch === "object" ? routingPatch : {};
  let changed = false;

  for (const kind of ["inputs", "outputs"]) {
    const groupPatch = patch[kind];
    if (!groupPatch || typeof groupPatch !== "object") continue;
    const slots = found.process.routing?.[kind] || {};
    for (const [slotId, slotPatch] of Object.entries(groupPatch)) {
      if (!slots[slotId]) slots[slotId] = { ordered: [], enabled: {} };
      if (applyRoutingPatchToSlot(slots[slotId], slotPatch)) changed = true;
    }
  }

  if (enforceDropslotPriority(found.process, processDef)) changed = true;
  if (syncRoutingTemplateFromProcess(found.process, found.target, found.systemId, processDef)) {
    changed = true;
  }

  return { ok: true, changed };
}

export function cmdReorderProcessRoutingEndpoint(
  state,
  { processId, slotKind, slotId, fromIndex, toIndex } = {}
) {
  if (!processId || typeof processId !== "string") {
    return { ok: false, reason: "badProcessId" };
  }
  const found = findProcessById(state, processId);
  if (!found?.process) return { ok: false, reason: "noProcess" };
  const context = {
    target: found.target,
    systemId: found.systemId,
    leaderId: found.process?.leaderId ?? null,
  };
  const processDef = getProcessDefForInstance(found.process, found.target, context);
  if (!processDef) return { ok: false, reason: "noProcessDef" };
  ensureProcessRoutingState(found.process, processDef, context);

  const kind = normalizeSlotKind(slotKind);
  const slotState = found.process.routing?.[kind]?.[slotId];
  if (!slotState || !Array.isArray(slotState.ordered)) {
    return { ok: false, reason: "noSlot" };
  }

  const max = slotState.ordered.length - 1;
  const from = Number.isFinite(fromIndex) ? Math.floor(fromIndex) : -1;
  const to = Number.isFinite(toIndex) ? Math.floor(toIndex) : -1;
  if (from < 0 || from > max || to < 0 || to > max) {
    return { ok: false, reason: "badIndex" };
  }

  const dropId = processDef.supportsDropslot ? getDropEndpointId(processId) : null;
  const moving = slotState.ordered[from];
  if (dropId && moving === dropId) {
    return { ok: false, reason: "dropLocked" };
  }
  if (dropId && to === 0 && slotState.ordered[0] === dropId) {
    return { ok: false, reason: "dropLocked" };
  }

  const [moved] = slotState.ordered.splice(from, 1);
  slotState.ordered.splice(to, 0, moved);

  enforceDropslotPriority(found.process, processDef);
  syncRoutingTemplateFromProcess(found.process, found.target, found.systemId, processDef);

  return { ok: true, result: "reordered" };
}

export function cmdToggleProcessRoutingEndpoint(
  state,
  { processId, slotKind, slotId, endpointId, enabled } = {}
) {
  if (!processId || typeof processId !== "string") {
    return { ok: false, reason: "badProcessId" };
  }
  if (!endpointId || typeof endpointId !== "string") {
    return { ok: false, reason: "badEndpoint" };
  }
  const found = findProcessById(state, processId);
  if (!found?.process) return { ok: false, reason: "noProcess" };
  const context = {
    target: found.target,
    systemId: found.systemId,
    leaderId: found.process?.leaderId ?? null,
  };
  const processDef = getProcessDefForInstance(found.process, found.target, context);
  if (!processDef) return { ok: false, reason: "noProcessDef" };
  ensureProcessRoutingState(found.process, processDef, context);

  if (processDef.supportsDropslot && isDropEndpoint(endpointId)) {
    return { ok: false, reason: "dropLocked" };
  }

  const kind = normalizeSlotKind(slotKind);
  const slotState = found.process.routing?.[kind]?.[slotId];
  if (!slotState || typeof slotState !== "object") {
    return { ok: false, reason: "noSlot" };
  }
  if (!slotState.enabled || typeof slotState.enabled !== "object") {
    slotState.enabled = {};
  }
  slotState.enabled[endpointId] = enabled === true;
  syncRoutingTemplateFromProcess(found.process, found.target, found.systemId, processDef);
  return { ok: true, result: "toggled" };
}

function ensureTemplateSlotState(template, kind, slotId) {
  if (!template) return null;
  if (!template[kind] || typeof template[kind] !== "object") {
    template[kind] = {};
  }
  if (!template[kind][slotId] || typeof template[kind][slotId] !== "object") {
    template[kind][slotId] = { ordered: [], enabled: {} };
  }
  const slotState = template[kind][slotId];
  if (!Array.isArray(slotState.ordered)) slotState.ordered = [];
  if (!slotState.enabled || typeof slotState.enabled !== "object") {
    slotState.enabled = {};
  }
  return slotState;
}

function seedTemplateSlotWithCandidates(slotState, candidates) {
  if (!slotState) return false;
  const ordered = Array.isArray(slotState.ordered) ? slotState.ordered : [];
  const list = Array.isArray(candidates) ? candidates : [];
  let changed = false;
  if (ordered.length === 0 && list.length > 0) {
    slotState.ordered = list.slice();
    changed = true;
  }
  for (const endpointId of slotState.ordered) {
    if (slotState.enabled[endpointId] === undefined) {
      slotState.enabled[endpointId] = true;
      changed = true;
    }
  }
  return changed;
}

export function cmdSetRoutingTemplate(state, { targetRef, systemId, routingPatch } = {}) {
  if (!targetRef || !systemId) {
    return { ok: false, reason: "badTarget" };
  }
  const target = findTargetByRef(state, targetRef);
  if (!target) return { ok: false, reason: "noTarget" };

  const process = getTemplateProcessForSystem(target, systemId, { state });
  if (!process) return { ok: false, reason: "noTemplateProcess" };
  const processDef = getProcessDefForInstance(process, target, {});
  if (!processDef) return { ok: false, reason: "noProcessDef" };

  const template = ensureSystemRoutingTemplate(target, systemId, processDef);
  if (!template) return { ok: false, reason: "noTemplate" };

  const patch = routingPatch && typeof routingPatch === "object" ? routingPatch : {};
  let changed = false;

  for (const kind of ["inputs", "outputs"]) {
    const groupPatch = patch[kind];
    if (!groupPatch || typeof groupPatch !== "object") continue;
    for (const [slotId, slotPatch] of Object.entries(groupPatch)) {
      const slotDef = resolveRoutingSlotDef(processDef, kind, slotId);
      if (!slotDef) return { ok: false, reason: "noSlot" };
      if (slotDef.locked) return { ok: false, reason: "slotLocked" };
      const slotState = ensureTemplateSlotState(template, kind, slotId);
      if (applyRoutingPatchToSlot(slotState, slotPatch)) changed = true;
      slotState.ordered = slotState.ordered.filter((endpointId) => !isDropEndpoint(endpointId));
      for (const key of Object.keys(slotState.enabled)) {
        if (isDropEndpoint(key)) delete slotState.enabled[key];
      }
    }
  }

  return { ok: true, changed };
}

export function cmdReorderRoutingTemplateEndpoint(
  state,
  { targetRef, systemId, slotKind, slotId, fromIndex, toIndex } = {}
) {
  if (!targetRef || !systemId) return { ok: false, reason: "badTarget" };
  const target = findTargetByRef(state, targetRef);
  if (!target) return { ok: false, reason: "noTarget" };

  const process = getTemplateProcessForSystem(target, systemId, { state });
  if (!process) return { ok: false, reason: "noTemplateProcess" };
  const processDef = getProcessDefForInstance(process, target, {});
  if (!processDef) return { ok: false, reason: "noProcessDef" };

  const slotDef = resolveRoutingSlotDef(processDef, slotKind, slotId);
  if (!slotDef) return { ok: false, reason: "noSlot" };
  if (slotDef.locked) return { ok: false, reason: "slotLocked" };

  const template = ensureSystemRoutingTemplate(target, systemId, processDef);
  if (!template) return { ok: false, reason: "noTemplate" };
  const kind = normalizeSlotKind(slotKind);
  const slotState = ensureTemplateSlotState(template, kind, slotId);

  if (slotState.ordered.length === 0) {
    const candidates = listCandidateEndpoints(state, process, slotDef, target, {});
    seedTemplateSlotWithCandidates(slotState, candidates);
  }

  const max = slotState.ordered.length - 1;
  const from = Number.isFinite(fromIndex) ? Math.floor(fromIndex) : -1;
  const to = Number.isFinite(toIndex) ? Math.floor(toIndex) : -1;
  if (from < 0 || from > max || to < 0 || to > max) {
    return { ok: false, reason: "badIndex" };
  }

  const [moved] = slotState.ordered.splice(from, 1);
  slotState.ordered.splice(to, 0, moved);

  return { ok: true, result: "reordered" };
}

export function cmdToggleRoutingTemplateEndpoint(
  state,
  { targetRef, systemId, slotKind, slotId, endpointId, enabled } = {}
) {
  if (!targetRef || !systemId) return { ok: false, reason: "badTarget" };
  if (!endpointId || typeof endpointId !== "string") {
    return { ok: false, reason: "badEndpoint" };
  }
  const target = findTargetByRef(state, targetRef);
  if (!target) return { ok: false, reason: "noTarget" };

  const process = getTemplateProcessForSystem(target, systemId, { state });
  if (!process) return { ok: false, reason: "noTemplateProcess" };
  const processDef = getProcessDefForInstance(process, target, {});
  if (!processDef) return { ok: false, reason: "noProcessDef" };

  const slotDef = resolveRoutingSlotDef(processDef, slotKind, slotId);
  if (!slotDef) return { ok: false, reason: "noSlot" };
  if (slotDef.locked) return { ok: false, reason: "slotLocked" };

  const template = ensureSystemRoutingTemplate(target, systemId, processDef);
  if (!template) return { ok: false, reason: "noTemplate" };
  const kind = normalizeSlotKind(slotKind);
  const slotState = ensureTemplateSlotState(template, kind, slotId);

  if (slotState.ordered.length === 0) {
    const candidates = listCandidateEndpoints(state, process, slotDef, target, {});
    seedTemplateSlotWithCandidates(slotState, candidates);
  }

  if (!slotState.enabled || typeof slotState.enabled !== "object") {
    slotState.enabled = {};
  }
  if (!isDropEndpoint(endpointId)) {
    slotState.enabled[endpointId] = enabled === true;
  }
  return { ok: true, result: "toggled" };
}
