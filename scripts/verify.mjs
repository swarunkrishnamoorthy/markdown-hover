// Node-side checks for the parser + renderer. Run with `npm run verify`.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  extractGlossary,
  buildTermIndex,
  renderDocument,
} from "../dist/core.node.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "samples", "sample.md"), "utf8");

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) {
    failures++;
  }
}

// extraction
const extracted = extractGlossary(src);
check("glossary block found", extracted.found);
check("terms parsed (>=5)", extracted.glossary && extracted.glossary.terms.length >= 5);
check("no parse error", extracted.glossary && !extracted.glossary.error);
check("length preserved after strip", extracted.strippedSrc.length === src.length);

// matcher
const index = buildTermIndex(extracted.glossary.terms, false);
const probe = "We rely on oracle strength, wildcard matchers, and state assertions per test.";
const found = new Set();
let m;
index.regex.lastIndex = 0;
while ((m = index.regex.exec(probe)) !== null) {
  found.add(m[0].toLowerCase());
}
check("matches multi-word term", found.has("oracle strength"));
check("matches alias (plural)", found.has("wildcard matchers"));
check("matches longest phrase", found.has("state assertions per test"));

// render
const doc = renderDocument(src);
check("content rendered", /<h1>/.test(doc.contentHtml));
check("glossary comment removed", !doc.contentHtml.includes("<!-- glossary"));
check("terms payload present", doc.terms.length >= 5);
check("definition rendered to HTML", /<p>/.test(doc.terms[0].defHtml));
const withExample = doc.terms.find((t) => t.exampleHtml);
check("example code rendered", withExample && /<pre>/.test(withExample.exampleHtml));

console.log(failures === 0 ? "\nParser/render checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
