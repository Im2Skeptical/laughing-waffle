import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

import { envEventDefs } from "../src/defs/gamepieces/env-events-defs.js";
import { envTileDefs } from "../src/defs/gamepieces/env-tiles-defs.js";
import { envStructureDefs } from "../src/defs/gamepieces/env-structures-defs.js";
import { envSystemDefs } from "../src/defs/gamesystems/env-systems-defs.js";
import { envTagDefs } from "../src/defs/gamesystems/env-tags-defs.js";
import { itemDefs } from "../src/defs/gamepieces/item-defs.js";
import { recipeDefs } from "../src/defs/gamepieces/recipes-defs.js";
import { hubStructureDefs } from "../src/defs/gamepieces/hub-structure-defs.js";
import { hubSystemDefs } from "../src/defs/gamesystems/hub-system-defs.js";
import { hubTagDefs } from "../src/defs/gamesystems/hub-tag-defs.js";
import { itemSystemDefs } from "../src/defs/gamesystems/item-system-defs.js";
import { itemTagDefs } from "../src/defs/gamesystems/item-tag-defs.js";
import { pawnSystemDefs } from "../src/defs/gamesystems/pawn-systems-defs.js";
import { keywordDefs } from "../src/defs/gamesystems/keyword-defs.js";
import {
  skillTrees,
  skillNodes,
} from "../src/defs/gamepieces/skill-tree-defs.js";
import { INTENT_AP_COSTS } from "../src/defs/gamesettings/action-costs-defs.js";
import { eventLogTypeDefs } from "../src/defs/gamesettings/event-log-types-defs.js";
import { skillFeatureUnlockDefs } from "../src/defs/gamesettings/skill-feature-unlocks-defs.js";
import { LEADER_EQUIPMENT_SLOT_ORDER } from "../src/defs/gamesystems/equipment-slot-defs.js";
import { validateEnvDefs } from "../src/defs/validate-env-defs.js";
import { validateSkillDefs } from "../src/defs/validate-skill-defs.js";

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
  assert.ok(
    Object.keys(envStructureDefs).length > 0,
    "[test] envStructureDefs is empty"
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
  assert.ok(
    Object.keys(eventLogTypeDefs).length > 0,
    "[test] eventLogTypeDefs is empty"
  );
  console.log("[test] Core defs exports OK");
}

function validateEventLogTypeDefs() {
  for (const [typeId, def] of Object.entries(eventLogTypeDefs)) {
    assert.ok(def && typeof def === "object", `[test] eventLog type "${typeId}" missing def`);
    const hasGlyph = Object.prototype.hasOwnProperty.call(def, "glyph");
    if (!hasGlyph) continue;

    const glyph = typeof def.glyph === "string" ? def.glyph.trim() : "";
    assert.ok(glyph.length > 0, `[test] eventLog type "${typeId}" has empty glyph`);
    assert.ok(
      glyph.length <= 2,
      `[test] eventLog type "${typeId}" glyph must be 1-2 chars, got "${glyph}"`
    );
  }
  console.log("[test] Event log type glyph validation complete");
}

function validateKeywordDefs() {
  assert.ok(Object.keys(keywordDefs).length > 0, "[test] keywordDefs is empty");
  for (const [keywordId, def] of Object.entries(keywordDefs)) {
    assert.ok(def && typeof def === "object", `[test] keyword "${keywordId}" missing def`);
    assert.equal(def.id, keywordId, `[test] keyword "${keywordId}" should preserve its id`);
    assert.equal(typeof def.label, "string", `[test] keyword "${keywordId}" missing label`);
    assert.ok(def.label.length > 0, `[test] keyword "${keywordId}" has empty label`);
    assert.equal(
      typeof def.description,
      "string",
      `[test] keyword "${keywordId}" missing description`
    );
    assert.ok(
      Number.isFinite(def.accentColor),
      `[test] keyword "${keywordId}" missing accent color`
    );
  }
  console.log("[test] Keyword registry validation complete");
}

function validateTooltipUiRegistry(name, registry) {
  for (const [defId, def] of Object.entries(registry)) {
    assert.ok(def && typeof def === "object", `[test] ${name} "${defId}" missing def`);
    assert.ok(def.ui && typeof def.ui === "object", `[test] ${name} "${defId}" missing ui`);
    assert.ok(
      def.ui.tooltipCard && typeof def.ui.tooltipCard === "object",
      `[test] ${name} "${defId}" missing ui.tooltipCard`
    );
    assert.ok(
      Array.isArray(def.ui.keywords),
      `[test] ${name} "${defId}" missing ui.keywords array`
    );
    for (const keywordId of def.ui.keywords) {
      assert.ok(
        keywordDefs[keywordId],
        `[test] ${name} "${defId}" references unknown keyword "${keywordId}"`
      );
    }
  }
}

function validateTooltipUiCoverage() {
  validateTooltipUiRegistry("envEvent", envEventDefs);
  validateTooltipUiRegistry("envTile", envTileDefs);
  validateTooltipUiRegistry("envStructure", envStructureDefs);
  validateTooltipUiRegistry("envSystem", envSystemDefs);
  validateTooltipUiRegistry("envTag", envTagDefs);
  validateTooltipUiRegistry("hubStructure", hubStructureDefs);
  validateTooltipUiRegistry("hubSystem", hubSystemDefs);
  validateTooltipUiRegistry("hubTag", hubTagDefs);
  validateTooltipUiRegistry("item", itemDefs);
  validateTooltipUiRegistry("itemSystem", itemSystemDefs);
  validateTooltipUiRegistry("itemTag", itemTagDefs);
  validateTooltipUiRegistry("pawnSystem", pawnSystemDefs);
  console.log("[test] Tooltip UI coverage validation complete");
}

function validateEnvironmentDefsSoft() {
  const result = validateEnvDefs({
    tags: envTagDefs,
    systems: envSystemDefs,
    tiles: envTileDefs,
    events: envEventDefs,
    structures: envStructureDefs,
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

function validateSkillDefsHard() {
  const result = validateSkillDefs({
    skillTrees,
    skillNodes,
    recipeDefs,
    hubStructureDefs,
    skillFeatureUnlockDefs,
  });

  if (!result.ok) {
    assert.fail(
      `[test] Skill defs validation failed:\n${result.errors.join("\n")}`
    );
  }

  if (result.warnings.length > 0) {
    console.warn(`[test] Skill defs warnings:\n${result.warnings.join("\n")}`);
  }

  console.log("[test] Skill defs validation check complete");
}

function validateSkillFeatureUnlockIds() {
  const valid = validateSkillDefs({
    skillTrees: {
      testTree: {
        id: "testTree",
        name: "Test",
        startNodeId: "start",
      },
    },
    skillNodes: {
      start: {
        id: "start",
        treeId: "testTree",
        name: "Start",
        desc: "",
        cost: 0,
        adjacent: [],
        onUnlock: [
          {
            op: "GrantUnlock",
            unlockType: "feature",
            unlockId: "ui.disk.moon",
          },
        ],
      },
    },
    recipeDefs: {},
    hubStructureDefs: {},
    skillFeatureUnlockDefs,
  });
  assert.equal(valid.ok, true, "[test] feature unlock id should validate when known");

  const invalid = validateSkillDefs({
    skillTrees: {
      testTree: {
        id: "testTree",
        name: "Test",
        startNodeId: "start",
      },
    },
    skillNodes: {
      start: {
        id: "start",
        treeId: "testTree",
        name: "Start",
        desc: "",
        cost: 0,
        adjacent: [],
        onUnlock: [
          {
            op: "GrantUnlock",
            unlockType: "feature",
            unlockId: "ui.disk.not-real",
          },
        ],
      },
    },
    recipeDefs: {},
    hubStructureDefs: {},
    skillFeatureUnlockDefs,
  });
  assert.equal(
    invalid.ok,
    false,
    "[test] unknown feature unlock id should fail validation"
  );
  console.log("[test] Skill feature unlock validation checks complete");
}

await checkDefsBundleability();
validateCoreDefinitions();
validateEventLogTypeDefs();
validateKeywordDefs();
validateTooltipUiCoverage();
validateEnvironmentDefsSoft();
validateSkillDefsHard();
validateSkillFeatureUnlockIds();
