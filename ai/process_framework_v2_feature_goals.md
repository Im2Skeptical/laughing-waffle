# Process Framework v2 - Widget UX Expansion Goals

This document defines the v2 user experience goals for the Process Widget, building on the v1 locked process framework. It focuses on layout and interaction changes that move the widget closer to the mockups while keeping simulation determinism unchanged.

v1 remains the authoritative rules for process transforms, routing, determinism, and actions. v2 only expands UI behavior, layout, and visual structure.

---

## 1. Core Intent

- Keep v1 authoritative data and routing behavior intact.
- Improve the Process Widget so it more closely matches the mockups.
- Support multiple process "variants" as modular layouts built from the same base structure.
- Enable a back-and-forth refinement workflow after an initial implementation pass.

---

## 2. Widget Model

### 2.1 Base Widget Structure (Always Present)

- Header with process title and close/pin affordance.
- Central panel directly under the header (always visible).
- Left and right drawers for routing endpoints that can be expanded or collapsed.
- Optional buffer slot column on the left side of the widget if supported by the process.

### 2.2 Modular Layout

Each process type is a variant composed from a shared base layout with optional modules enabled or disabled.

Modules:
- Progress module
- Requirements module
- Output module
- Buffer slot module
- Input routing drawer
- Output routing drawer

Modules can be turned on or off per process variant. Swapping module order and size is allowed when it improves clarity and matches the mockups.

---

## 3. Process Variants (v2 Target)

The widget must support these variant categories as modular configurations:

1. Growing
- Time mode progress uses a vertical progress bar.
- Buffer slot module hidden.
- Output routing drawer may be hidden if output is locked.

2. Depositing
- Time mode progress uses a vertical progress bar.
- Buffer slot module hidden by default.
- Output routing drawer hidden if outputs are locked.

3. Crafting
- Work mode progress uses a horizontal progress bar.
- Buffer slot module shown if supported by the process.

4. Cooking
- Work mode progress uses a horizontal progress bar.
- Buffer slot module shown if supported by the process.

5. Building
- Work mode progress uses a horizontal progress bar.
- Output routing drawer hidden when output is locked to spawn.
- Buffer slot module shown only if the process supports dropslot.

Notes:
- Cooking and crafting are layout-identical except for the process title and data.
- Vertical progress is intended to be stylable as an hourglass later, but v2 only requires a vertical bar.

---

## 4. Widget Multiplicity and Pinning

- The player can open one widget per selected process and pin it.
- Multiple widgets can be open at once for different processes on the same structure.
- Most of the time a single widget is expected, but multi-widget behavior must not break layout or routing interactions.

---

## 5. Visibility Rules

Always visible:
- Header
- Central panel beneath header
- Buffer slot column if supported by process

Collapsible:
- Input routing drawer (left side)
- Output routing drawer (right side)

Routing drawers are shown only when the corresponding slot set is selectable. If a slot set is fully locked, the drawer is hidden.

---

## 6. Interaction Rules

- Expand and collapse only the routing drawers.
- Drag-reorder and click-toggle behaviors reuse the existing pill interaction model.
- Dropslot behavior remains v1 compliant.
- UI state never changes authoritative outcomes directly.

---

## 7. Visual Targets

- Match mockup proportions roughly. Pixel-perfect accuracy is not required.
- Maintain clear containers for modules and drawers as in the mockups.
- Ensure that module boundaries are visually distinct.

---

## 8. Iteration Workflow

v2 should be written to enable a rapid revision loop:

- v2.0 initial implementation focuses on layout and module swapping.
- v2.1+ can adjust proportions, spacing, and module ordering based on feedback.
- The document should be updated only when layout intent changes, not for every pixel tweak.

---

## 9. Explicit Non-Goals

- No new simulation logic.
- No changes to routing rules or determinism.
- No new hotkeys or modal behavior.
- No animation polish beyond basic layout updates.

---

## 10. Acceptance Criteria

Implementation is acceptable when:

1. The widget supports the five variants with modular module visibility and ordering.
2. Time mode uses vertical progress, work mode uses horizontal progress.
3. Routing drawers are hidden when all slots are locked or not applicable.
4. Buffer slot only appears when dropslot is supported.
5. The layout reads clearly as the mockup structure even if the exact styling differs.

---

End of v2 document.
