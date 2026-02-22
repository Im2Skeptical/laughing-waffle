import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function run() {
  const indexHtml = await readFile("index.html", "utf8");
  const sunMoonView = await readFile(
    "src/views/sunandmoon-disks-pixi.js",
    "utf8"
  );

  const hasAbsoluteModulePath =
    /<script[^>]*type=["']module["'][^>]*src=["']\/src\//i.test(indexHtml) ||
    /<script[^>]*src=["']\/src\/views\/ui-root-pixi\.js["']/i.test(indexHtml);

  assert.equal(
    hasAbsoluteModulePath,
    false,
    "[test] index.html contains an absolute /src module path; use relative ./src for GitHub Pages."
  );

  const hasAbsoluteImagePath = /texturePath:\s*["']\/images\//.test(sunMoonView);
  assert.equal(
    hasAbsoluteImagePath,
    false,
    "[test] sunandmoon-disks-pixi.js contains absolute /images texturePath; use relative images/ for GitHub Pages."
  );

  console.log("[test] Hosting path checks passed");
}

await run();
