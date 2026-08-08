const esbuild = require("esbuild");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions[]} */
const builds = [
  {
    // Browser bundle for the viewer + standalone export.
    entryPoints: ["src/browser/main.ts"],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    outfile: "web/dist/app.js",
    sourcemap: !production,
    minify: production,
    logLevel: "info",
  },
  {
    // Node core (parser + renderer) for the server, exporter, and tests.
    entryPoints: ["src/node.ts"],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node18",
    outfile: "dist/core.node.mjs",
    sourcemap: !production,
    minify: false,
    logLevel: "info",
  },
];

async function main() {
  const contexts = await Promise.all(builds.map((b) => esbuild.context(b)));
  if (watch) {
    await Promise.all(contexts.map((c) => c.watch()));
    console.log("watching…");
  } else {
    await Promise.all(
      contexts.map(async (c) => {
        await c.rebuild();
        await c.dispose();
      })
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
