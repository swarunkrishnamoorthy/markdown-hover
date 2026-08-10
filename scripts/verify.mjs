// Node-side checks for the parser + renderer. Run with `npm run verify`.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  extractGlossary,
  buildTermIndex,
  renderDocument,
  harvestGlossaryTable,
  harvestAbbrTags,
} from "../dist/core.node.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "samples", "sample.md"), "utf8");
const derivedSrc = readFileSync(join(here, "..", "samples", "derived.md"), "utf8");

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
check("term source is the block", doc.termSource === "block");

// fallback sources: a doc with no glossary block
const table = harvestGlossaryTable(derivedSrc);
const byTerm = (name) => table.find((t) => t.term === name);
check("no block in derived sample", !extractGlossary(derivedSrc).found);
check("table terms harvested", table.length === 8);
check("plain term", !!byTerm("ACC"));
check("parenthetical becomes alias", byTerm("ACP")?.aliases.join() === "API Control Plane");
check("spaced slashes split", byTerm("ash1")?.aliases.join() === "ash2,ash3,ash4");
check("unspaced slash kept, comma splits", byTerm("go/911")?.aliases.join() === "go/912");
check("abbreviation in parens is an alias", byTerm("Elasticsearch")?.aliases.join() === "ES");
// "**tier** (DAG)" disambiguates; DAG is its own entry and must not alias to tier.
check("parenthetical that names another term is dropped", byTerm("tier")?.aliases.length === 0);

const abbrs = harvestAbbrTags(derivedSrc);
check("abbr tags harvested", abbrs.length === 2);
check("abbr definition read from title", /Adaptive Concurrency/.test(abbrs[0].definition));

const derivedDoc = renderDocument(derivedSrc);
check("term source is derived", derivedDoc.termSource === "derived");
check("table and abbr merged, deduped", derivedDoc.terms.length === 9);
const acc = derivedDoc.terms.find((t) => t.term === "ACC");
check("table definition wins over abbr", /HTTP 503/.test(acc.defHtml));
check("native abbr tooltips suppressed", !/<abbr[^>]*title/i.test(derivedDoc.contentHtml));
check("abbr element preserved", /<abbr>/.test(derivedDoc.contentHtml));

// mermaid fences become diagram placeholders; other fences are untouched
const showcase = renderDocument(readFileSync(join(here, "..", "samples", "showcase.md"), "utf8"));
check("mermaid fences counted", showcase.diagrams === 2);
check(
  "placeholder emitted per diagram",
  (showcase.contentHtml.match(/class="mhg-mermaid"/g) || []).length === 2
);
check("diagram source kept as text", /flowchart LR/.test(showcase.contentHtml));
check("mermaid not left as a code block", !/language-mermaid/.test(showcase.contentHtml));
check("other fences still highlighted normally", /language-python/.test(showcase.contentHtml));
check("no diagrams reported for plain docs", renderDocument(src).diagrams === 0);

// A fence whose content would otherwise break out of the placeholder markup.
const risky = renderDocument('```mermaid\nflowchart TD\n  A["</pre><script>x</script>"] --> B\n```\n');
check("diagram source is escaped", !/<script>/.test(risky.contentHtml));
check("risky diagram still counted", risky.diagrams === 1);

console.log(failures === 0 ? "\nParser/render checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
