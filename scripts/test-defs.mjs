import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

import { envEventDefs } from "../src/defs/gamepieces/env-events-defs.js";
import { envTileDefs } from "../src/defs/gamepieces/env-tiles-defs.js";
import { envSystemDefs } from "../src/defs/gamesystems/env-systems-defs.js";
import { envTagDefs } from "../src/defs/gamesystems/env-tags-defs.js";
import { itemDefs } from "../src/defs/gamepieces/item-defs.js";
import { INTENT_AP_COSTS } from "../src/defs/gamesettings/action-costs-defs.js";
import { LEADER_EQUIPMENT_SLOT_ORDER } from "../src/defs/gamesystems/equipment-slot-defs.js";
import { validateEnvDefs } from "../src/defs/validate-env-defs.js";

async function collectJsFiles(rootDir) {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectJsFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

async function checkDefsBundleability() {
  const defsRoot = path.resolve("src/defs");
  const files = await collectJsFiles(defsRoot);
  const entryPoints = files.map((file) =>
    path.relative(process.cwd(), file).replace(/\\/g, "/")
  );

  try {
    await build({
      entryPoints,
      bundle: true,
      write: false,
      outdir: ".tmp-defs-check",
      platform: "browser",
      format: "esm",
      target: ["es2020"],
      logLevel: "silent",
    });
  } catch (error) {
    const lines = [];
    if (error?.errors?.length) {
      for (const err of error.errors) {
        const file = err?.location?.file ?? "<unknown>";
        const line = err?.location?.line ?? 0;
        const column = err?.location?.column ?? 0;
        lines.push(`${file}:${line}:${column} ${err.text}`);
      }
    } else if (error?.message) {
      lines.push(error.message);
    }
    assert.fail(`[test] Defs bundling failed:\n${lines.join("\n")}`);
  }

  console.log(`[test] Bundled ${files.length} defs modules`);
}

function validateCoreDefinitions() {
  assert.ok(Object.keys(envTagDefs).length > 0, "[test] envTagDefs is empty");
  assert.ok(
    Object.keys(envSystemDefs).length > 0,
    "[test] envSystemDefs is empty"
  );
  assert.ok(Object.keys(envTileDefs).length > 0, "[test] envTileDefs is empty");
  assert.ok(
    Object.keys(envEventDefs).length > 0,
    "[test] envEventDefs is empty"
  );
  assert.ok(Object.keys(itemDefs).length > 0, "[test] itemDefs is empty");
  assert.ok(
    Object.keys(INTENT_AP_COSTS).length > 0,
    "[test] INTENT_AP_COSTS is empty"
  );
  assert.ok(
    LEADER_EQUIPMENT_SLOT_ORDER.length > 0,
    "[test] LEADER_EQUIPMENT_SLOT_ORDER is empty"
  );
  console.log("[test] Core defs exports OK");
}

function validateEnvironmentDefsSoft() {
  const result = validateEnvDefs({
    tags: envTagDefs,
    systems: envSystemDefs,
    tiles: envTileDefs,
    events: envEventDefs,
  });

  const strict = process.env.STRICT_ENV_DEFS === "1";
  if (!result.ok && strict) {
    assert.fail(`[test] Env defs validation failed:\n${result.errors.join("\n")}`);
  }

  if (!result.ok) {
    console.warn(
      `[test] Env defs validation warnings (non-blocking):\n${result.errors.join("\n")}`
    );
  }
  if (result.warnings.length > 0) {
    console.warn(`[test] Env defs warnings:\n${result.warnings.join("\n")}`);
  }

  console.log("[test] Env defs validation check complete");
}

await checkDefsBundleability();
validateCoreDefinitions();
validateEnvironmentDefsSoft();
