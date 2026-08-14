// Export a Markdown file to a single self-contained HTML file that works over
// file:// with no server.
//   node scripts/build-html.mjs <file.md> [out.html]
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderDocument, readDismissedTerms } from "../dist/core.node.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const inArg = process.argv[2];
if (!inArg) {
  console.error("Usage: node scripts/build-html.mjs <file.md> [out.html]");
  process.exit(1);
}
const inFile = path.resolve(inArg);
const outFile = path.resolve(
  process.argv[3] || inFile.replace(/\.(md|markdown)$/i, "") + ".html"
);

function escapeForScript(json) {
  // Prevent </script> and HTML-comment sequences from breaking out of the tag.
  return json
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

async function main() {
  const [src, appJs, css] = await Promise.all([
    readFile(inFile, "utf8"),
    readFile(path.join(root, "web", "dist", "app.js"), "utf8"),
    readFile(path.join(root, "web", "styles.css"), "utf8"),
  ]);

  const rendered = renderDocument(src, { dismissed: readDismissedTerms() });
  const data = {
    ...rendered,
    filename: path.basename(inFile),
    options: { matchAllOccurrences: true, caseSensitive: false },
  };

  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${data.filename} — Glossary Viewer</title>
    <style>
${css}
    </style>
  </head>
  <body>
    <header class="mhg-topbar">
      <span class="mhg-brand">Glossary Viewer</span>
      <span id="mhg-filename" class="mhg-filename"></span>
      <span class="mhg-hint">hover a dotted term</span>
    </header>
    <main id="mhg-content" class="mhg-content"></main>
    <script>window.__MHG_DATA__ = ${escapeForScript(JSON.stringify(data))};</script>
    <script>
${appJs}
    </script>
  </body>
</html>
`;

  await writeFile(outFile, html, "utf8");
  console.log(`Wrote ${outFile}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
