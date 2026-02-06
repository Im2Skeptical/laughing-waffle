# Process Framework – Locked Feature Goals

This document defines the **locked goals, constraints, and reference schemas** for promoting the existing generic `process` system into a first‑class, player‑visible framework. It is intended to be handed verbatim to an implementation agent with full source access.

Nothing in this document is optional unless explicitly marked as extensible.

---

## 1. Core Intent

* A **process** represents a deterministic transformation: inputs → time/work → outputs.
* Processes already exist and are authoritative, replayable, and data‑driven.
* The goal is **not** to replace the system, but to:

  * make transforms inspectable by the player
  * make input/output routing explicit, configurable, and serialized
  * unify farming, cooking, crafting, building, prestige, etc. under one mental model

Key principle:

> **Transform logic is fixed and data‑defined. Routing is player‑defined and first‑class.**

---

## 2. Determinism & Replay (Hard Constraints)

These are non‑negotiable invariants.

1. All routing decisions that affect outcomes **must live in authoritative state**.
2. All routing edits **must be actions** committed at a specific `tSec`.
3. No UI‑local or frame‑time logic may affect routing or selection.
4. Candidate discovery and selection order must be **fully deterministic**.
5. Replay, rebuild, and projection must produce byte‑identical results (excluding derived caches).
6. Editing routing in the past causes standard timeline truncation (no soft branching).

---

## 3. Conceptual Split

### 3.1 Transform (Read‑Only)

A transform defines *what* happens.

* requirements (items / tags / resources / systems)
* progress model (time or work, duration)
* outputs (items / resources / system deltas)
* optional completion policy

Transforms are:

* data‑defined
* inspectable in UI
* not directly modifiable by the player (except via recipe selection if supported)

### 3.2 Routing (Player‑Defined)

Routing defines *where* inputs come from and *where* outputs go.

Routing is:

* explicit
* serialized
* editable only while paused
* deterministic

---

## 4. Endpoint Model (Locked)

### 4.1 Endpoint ID Format

Endpoints are addressed by canonical string IDs.

```
inv:<ownerId>
inv:pawn:<pawnId>
inv:hub:<structureInstanceId>
res:state
sys:hub:<structureInstanceId>
sys:pawn:<pawnId>
sys:pool:<ownerKind>:<ownerId>:<systemId>:<poolKey>
spawn:tileOccupants
```

Rules:

* IDs must be derived only from authoritative state IDs.
* `inv:*`, `res:*`, and `sys:*` are distinct namespaces even if backed by similar data.
* Endpoint IDs are stable across replay and rebuild.

### 4.2 System Pool Endpoints

System pools are addressable endpoints that represent a tiered pool in a system state:

```
sys:pool:<ownerKind>:<ownerId>:<systemId>:<poolKey>
```

* `ownerKind` is one of `hub | env | pawn`.
* `ownerId` is the authoritative instance id for the owner.
* `systemId` and `poolKey` locate the pool object under `owner.systemState[systemId][poolKey]`.
* Pools are valid routing targets for both inputs and outputs.

---

## 5. Routing Slots

Processes expose **routing slots**, not raw endpoint lists.

A slot represents one logical input or output channel.

### 5.1 RoutingSlot Schema

```ts
type RoutingSlot = {
  slotId: string;              // stable identifier
  label: string;               // UI label
  locked: boolean;             // if true, endpoint is fixed (no expand arrow)
  mode: "consume" | "deposit" | "award" | "spawn";
  candidateRule: CandidateRule; // ignored if locked=true
  default: {
    ordered: string[];         // default endpointIds
  };
};
```

### 5.2 Locked vs Selectable

* **Locked slots**

  * exactly one valid endpoint
  * no UI expansion
  * examples:

    * construction output → finished building
    * prestige award → associated leader

* **Selectable slots**

  * multiple candidate endpoints
  * player may reorder and enable/disable

Locked slots still use routing state but cannot be edited.

---

## 6. Candidate Discovery Rules

Candidate lists are **computed**, not stored.

### 6.1 CandidateRule Schema

```ts
type CandidateRule =
  | { kind: "fixed"; endpointId: string }
  | { kind: "selfInv" }
  | { kind: "selfSys" }
  | { kind: "selfPool"; systemId: string; poolKey: string }
  | { kind: "ownerInv" }
  | {
      kind: "adjacentDistributors";
      range: number;
      tag: "distributor";
      store: "sys" | "inv";
      includePool?: { systemId: string; poolKey: string } | Array<{ systemId: string; poolKey: string }>;
    }
  | {
      kind: "adjacentStructures";
      range: number;
      tag?: string;
      store: "sys" | "inv";
      includePool?: { systemId: string; poolKey: string } | Array<{ systemId: string; poolKey: string }>;
    }
  | { kind: "tileOccupantsSpawn" };
```

### 6.2 Deterministic Ordering

When generating candidates, order must be stable:

1. increasing Manhattan distance
2. stable tile / anchor index
3. stable instanceId

No iteration over unordered maps.

If `includePool` is specified, pool endpoints are discovered with the same
deterministic ordering rules and are appended ahead of non-pool store endpoints.

---

## 7. Process Definition Shape

```ts
type ProcessDef = {
  processKind: string;
  displayName: string;
  transform: {
    mode: "time" | "work";
    durationSec: number;
    requirements: RequirementSpec[];
    outputs: OutputSpec[];
    completionPolicy?: string;
  };
  routingSlots: {
    inputs: RoutingSlot[];
    outputs: RoutingSlot[];
  };
};
```

This aligns with existing process instance fields (`mode`, `durationSec`, `requirements`, `outputs`, etc.).

---

## 8. Process Instance Shape (Authoritative)

```ts
type ProcessInstance = {
  id: string;
  // existing fields (progress, requirements, etc.)
  routing: {
    inputs: Record<string, SlotRoutingState>;
    outputs: Record<string, SlotRoutingState>;
  };
};


type SlotRoutingState = {
  ordered: string[];                  // endpointIds
  enabled: Record<string, boolean>;   // endpointId → enabled
};
```

Notes:

* Routing state stores **player intent only**.
* Candidate validity is checked at runtime.
* Invalid endpoints are skipped but not silently removed.

---

## 9. Selection Algorithm (Locked)

For each unit of requirement spending:

1. Iterate `ordered` endpoints in order.
2. Skip disabled or invalid endpoints.
3. Select the first endpoint that can afford the unit.
4. Apply the cost.
5. Repeat until requirements satisfied or budget exhausted.

No randomness. No batching shortcuts.

Outputs follow the same logic (first enabled endpoint).

---

## 9.1 Manual Input Buffer (Dropslot) – Locked

Some processes may expose a **manual dropslot** allowing the player to directly drag items into the process.

### Semantics

* The dropslot is a **real, authoritative buffer**, not a visual ghost.
* It is represented as a locked input endpoint with highest priority.
* Canonical endpoint ID:

```
inv:process:<processId>
```

### Behavior Rules

* Items dragged into the dropslot are moved immediately via an action into this buffer endpoint.
* The buffer endpoint is always evaluated **before all other input endpoints**.
* Items in the buffer satisfy normal item/tag requirements with no special casing.
* The buffer is always enabled and cannot be reordered or disabled.

### Temporal Rules

* Dropslot interactions are paused-only actions.
* The move action is recorded at the current `tSec`.
* On rebuild/replay, the item resides in the buffer at the start of that second.
* No reservation or ghost system is used.

### Cancellation / Removal

* If a process is canceled or removed, items in the buffer remain until explicitly moved out by the player (no automatic return in v1).

### Scope

* Dropslots are item-only in v1 (no direct resource or system dragging).
* Capacity is unbounded unless explicitly restricted by future rules.

---

## 10. Distributor Feature (Locked Semantics)

* A building with tag `distributor` exposes its store (inventory or system) as a **candidate endpoint** to nearby processes.
* Range defaults to adjacency (`range = 1`).
* Range upgrades extend discovery distance only.
* Distributors do not push; consumers pull via routing priority.

Distributors are not special‑case logic; they are just candidate rules.

---

## 11. Prestige as a Process (Locked)

* Prestige awards are outputs of a process.
* Output slot is locked.
* Endpoint is `sys:pawn:<leaderId>`.
* Implemented via existing `system` cost/output machinery.

No bespoke prestige pipeline.

---

## 12. UI Expectations (Non‑Authoritative)

* A single Process Widget view module renders:

  * collapsed summary
  * expanded tabs:

    * Transform (read‑only)
    * Inputs (routing editor)
    * Outputs (routing editor)
* Expand arrow shown only for selectable slots.
* Drag‑reorder pills determine priority.
* Click toggles enable/disable.

#### **UI Interaction Reuse (Locked Guidance)**

* Routing pills (priority + enable/disable) must use the **same interaction model** as the existing tag pill system:

  * drag to reorder
  * click to toggle enabled/disabled
* The implementation should **reuse or extract** existing pill/drag logic rather than duplicating bespoke drag code per widget.
* If pill behavior is not already centralized, extracting a shared component/module is encouraged.

UI state never mutates outcomes directly.



---

## 13. Required New Actions / Commands

At minimum:

* `setProcessRouting(processId, routingPatch)`
* `reorderProcessRoutingEndpoint(processId, slotKind, slotId, fromIndex, toIndex)`
* `toggleProcessRoutingEndpoint(processId, slotKind, slotId, endpointId, enabled)`

All are paused‑only player actions.

---

## 14. Explicit Non‑Goals (for v1)

* No output splitting across multiple endpoints.
* No stochastic routing.
* No automatic re‑balancing.
* No implicit global inventory access.

---

## 15. Acceptance Criteria Summary

An implementation is valid if:

1. Routing is inspectable, editable, serialized, and replay‑safe.
2. Distributor buildings function purely through candidate discovery.
3. Locked endpoints behave as non‑expandable slots.
4. Replay, rebuild, and projection remain deterministic.
5. No existing process behavior is broken or special‑cased.

---

**End of locked reference document.**
