// skill-defs-dev.js
// Dev-only validation hook for skill tree defs.

import { recipeDefs } from "./gamepieces/recipes-defs.js";
import { hubStructureDefs } from "./gamepieces/hub-structure-defs.js";
import { skillTrees, skillNodes } from "./gamepieces/skill-tree-defs.js";
import { skillFeatureUnlockDefs } from "./gamesettings/skill-feature-unlocks-defs.js";
import { validateSkillDefs } from "./validate-skill-defs.js";

const DEV =
  (typeof globalThis !== "undefined" && globalThis.__DEV__ === true) ||
  (typeof process !== "undefined" &&
    process.env &&
    process.env.NODE_ENV !== "production");

const result = validateSkillDefs({
  skillTrees,
  skillNodes,
  recipeDefs,
  hubStructureDefs,
  skillFeatureUnlockDefs,
});

if (!result.ok) {
  const message = result.errors.join("\n");
  if (DEV) {
    throw new Error(message);
  }
  if (message) {
    console.warn(`[skill-defs] ${message}`);
  }
}

if (result.warnings.length > 0) {
  console.warn(`[skill-defs] ${result.warnings.join("\n")}`);
}
