// env-defs-dev.js
// Dev-only validation hook for env defs.

import { envTagDefs } from "./gamesystems/env-tags-defs.js";
import { envSystemDefs } from "./gamesystems/env-systems-defs.js";
import { envTileDefs } from "./gamepieces/env-tiles-defs.js";
import { envEventDefs } from "./gamepieces/env-events-defs.js";
import { envStructureDefs } from "./gamepieces/env-structures-defs.js";
import { validateEnvDefs } from "./validate-env-defs.js";

const DEV =
  (typeof globalThis !== "undefined" && globalThis.__DEV__ === true) ||
  (typeof process !== "undefined" &&
    process.env &&
    process.env.NODE_ENV !== "production");

const result = validateEnvDefs({
  tags: envTagDefs,
  systems: envSystemDefs,
  tiles: envTileDefs,
  events: envEventDefs,
  structures: envStructureDefs,
});

if (!result.ok) {
  const message = result.errors.join("\n");
  if (DEV) {
    throw new Error(message);
  }
  if (message) {
    console.warn(`[env-defs] ${message}`);
  }
}

if (result.warnings.length > 0) {
  console.warn(`[env-defs] ${result.warnings.join("\n")}`);
}
