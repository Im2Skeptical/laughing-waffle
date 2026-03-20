// env-structures-defs.js
// Definitions for environment structures (board-level, separate from hub structures).

import { ensureTooltipCardUi } from "../tooltip-ui-utils.js";

export const envStructureDefs = {
  hubPortal: {
    id: "hubPortal",
    kind: "envStructure",
    name: "Hub Portal",
    defaultSpan: 1,
    ui: {
      title: "Hub",
      description: "Old ruins make for a convenient hub",
      color: 0x5e5c58,
    },
    // Schema-ready; systems can be attached here later.
    systems: {},
  },
  ancientRuins: {
    id: "ancientRuins",
    kind: "envStructure",
    name: "Ancient Ruins",
    defaultSpan: 1,
    ui: {
      title: (_structure, def, state) => {
        const raw = state?.locationNames?.hub;
        const name =
          typeof raw === "string" && raw.trim().length > 0
            ? raw.trim()
            : def?.name || "Ancient Ruins";
        return name;
      },
      description: "Weathered ruins hint at a buried settlement below.",
      color: 0x5e5c58,
    },
    systems: {},
  },
};

ensureTooltipCardUi(envStructureDefs);
