import assert from "node:assert/strict";

import {
  getHubTagPlayerRole,
  isHubTagPlayerActive,
  normalizeVisibleHubTagOrder,
} from "../src/model/hub-tags.js";

function runRoleLookupChecks() {
  assert.equal(
    getHubTagPlayerRole("canRest"),
    "active",
    "[hubTagRoles] canRest should be active"
  );
  assert.equal(
    getHubTagPlayerRole("communal"),
    "passive",
    "[hubTagRoles] communal should be passive"
  );
  assert.equal(
    getHubTagPlayerRole("unknownTag"),
    "passive",
    "[hubTagRoles] unknown tags should default to passive"
  );
  assert.equal(
    isHubTagPlayerActive("canCook"),
    true,
    "[hubTagRoles] canCook should be recognized as active"
  );
  assert.equal(
    isHubTagPlayerActive("canHouse"),
    false,
    "[hubTagRoles] canHouse should not be recognized as active"
  );
}

function runNormalizationChecks() {
  assert.deepEqual(
    normalizeVisibleHubTagOrder(["communal", "depositable", "canPreserve"]),
    ["depositable", "communal", "canPreserve"],
    "[hubTagRoles] mixed visible hub tags should normalize to active-first order"
  );
  assert.deepEqual(
    normalizeVisibleHubTagOrder([
      "communal",
      "canCook",
      "canHouse",
      "canCraft",
      "build",
    ]),
    ["canCook", "canCraft", "communal", "canHouse", "build"],
    "[hubTagRoles] normalization should preserve relative order within active and passive groups"
  );
}

runRoleLookupChecks();
runNormalizationChecks();
console.log("[test] Hub tag player-role checks passed");
