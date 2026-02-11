import { build } from "esbuild";

const entryPoint = "src/views/ui-root-pixi.js";

try {
  await build({
    entryPoints: [entryPoint],
    bundle: true,
    write: false,
    platform: "browser",
    format: "esm",
    target: ["es2020"],
    logLevel: "silent",
  });

  console.log(`[build] OK: bundled ${entryPoint}`);
} catch (error) {
  console.error("[build] Failed");
  if (error?.errors?.length) {
    for (const err of error.errors) {
      const file = err?.location?.file ?? "<unknown>";
      const line = err?.location?.line ?? 0;
      const column = err?.location?.column ?? 0;
      console.error(`- ${file}:${line}:${column} ${err.text}`);
    }
  } else if (error?.message) {
    console.error(error.message);
  }
  process.exit(1);
}
