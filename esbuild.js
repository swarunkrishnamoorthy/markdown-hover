const esbuild = require("esbuild");
const fs = require("node:fs");
const path = require("node:path");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

// Mermaid is lazy-loaded at runtime, so it stays out of the app bundle and is
// only fetched for documents that actually contain a diagram. Its prebuilt UMD
// file is self-contained, so vendoring is a copy rather than a rebuild.
function vendorMermaid() {
  const from = require.resolve("mermaid/dist/mermaid.min.js");
  const toDir = path.join(__dirname, "web", "vendor");
  const to = path.join(toDir, "mermaid.min.js");
  fs.mkdirSync(toDir, { recursive: true });
  fs.copyFileSync(from, to);
  const version = require("mermaid/package.json").version;
  console.log(`vendored mermaid ${version} -> web/vendor/mermaid.min.js`);
}

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
  vendorMermaid();
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
