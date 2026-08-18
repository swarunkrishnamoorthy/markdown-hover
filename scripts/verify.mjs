// Node-side checks for the parser + renderer. Run with `npm run verify`.
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  extractGlossary,
  buildTermIndex,
  renderDocument,
  slugify,
  harvestGlossaryTable,
  harvestAbbrTags,
  partitionDismissed,
  readDismissed,
  readDismissedTerms,
  addDismissed,
  removeDismissed,
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
check("content rendered", /<h1\b/.test(doc.contentHtml));
check("glossary comment removed", !doc.contentHtml.includes("<!-- glossary"));
check("terms payload present", doc.terms.length >= 5);
check("definition rendered to HTML", /<p>/.test(doc.terms[0].defHtml));
const withExample = doc.terms.find((t) => t.exampleHtml);
check("example code rendered", withExample && /<pre>/.test(withExample.exampleHtml));
check("term source is the block", doc.termSource === "block");

// a bare top-level list is shorthand for `terms:`
const bareList = extractGlossary("# T\n\n<!-- glossary\n- term: Nomad\n  definition: Scheduler.\n-->\n");
check("bare list parses", bareList.found && !bareList.glossary.error);
check("bare list yields terms", bareList.glossary.terms.length === 1);
check("bare list term is read", bareList.glossary.terms[0].term === "Nomad");

// parse errors report the document's line numbers, not the block's
const brokenSrc = [
  "# Title",
  "",
  "text",
  "",
  "<!-- glossary",
  "- term: A",
  "  definition: A thing.",
  "  example: `x`",
  "-->",
].join("\n");
const broken = extractGlossary(brokenSrc);
check("broken block still detected", broken.found);
check("broken block reports an error", !!broken.glossary.error);
// The offending value sits on document line 8; js-yaml alone would say 4.
check("error uses document line numbers", /\(line 8, column \d+\)/.test(broken.glossary.error));
check("error excerpt is renumbered", /^\s*8 \|\s+example: `x`$/m.test(broken.glossary.error));
check("caret survives renumbering", /^-+\^/m.test(broken.glossary.error));
check("backtick hint is offered", /YAML reserves "`"/.test(broken.glossary.error));
const brokenDoc = renderDocument(brokenSrc);
check("broken block still renders prose", /<p>text<\/p>/.test(brokenDoc.contentHtml));
check("broken block surfaces the error", !!brokenDoc.error);
// quoting is the fix the hint recommends, so it has to actually work
const quoted = extractGlossary(brokenSrc.replace("example: `x`", 'example: "`x`"'));
check("quoted backtick value parses", !quoted.glossary.error);
check("quoted backtick value yields the term", quoted.glossary.terms.length === 1);

// the other common YAML trap: ": " inside an unquoted value
const colonSrc = brokenSrc.replace("example: `x`", "example: set `debugMode: true` first");
const colon = extractGlossary(colonSrc);
check("colon in value is an error", !!colon.glossary.error);
check("colon hint explains the cause", /cannot contain ": "/.test(colon.glossary.error));
check("colon hint suggests a block scalar", /block scalar/.test(colon.glossary.error));
const blockScalar = extractGlossary(
  brokenSrc.replace("  example: `x`", "  example: |\n    set `debugMode: true` first")
);
check("block scalar sidesteps both traps", !blockScalar.glossary.error);
check("block scalar keeps the value", /debugMode: true/.test(blockScalar.glossary.terms[0].example));

// heading ids, so in-document anchors resolve. Authors write these to match
// GitHub, so the slugs are checked against anchors from real documents.
check("plain heading slug", slugify("Read this first") === "read-this-first");
check("numbering punctuation is dropped", slugify("0. Read this first") === "0-read-this-first");
check("comma leaves one hyphen", slugify("Your rotation, and who you escalate to") === "your-rotation-and-who-you-escalate-to");
// An em dash is removed but its two spaces are not, which is why GitHub emits "--".
check(
  "em dash becomes a double hyphen",
  slugify("1.2 Category A — Transaction Records overload (81 alerts, 52%)") ===
    "12-category-a--transaction-records-overload-81-alerts-52"
);
check("colon is dropped", slugify("3.2 Batch: the Airflow DAG chain") === "32-batch-the-airflow-dag-chain");
const headed = renderDocument("# One\n\n## Two Words\n\n### `code` heading\n");
check("h1 gets an id", /<h1 id="one">/.test(headed.contentHtml));
check("h2 slug joins words", /<h2 id="two-words">/.test(headed.contentHtml));
check("code spans count as heading text", /<h3 id="code-heading">/.test(headed.contentHtml));
const dupes = renderDocument("## Notes\n\n## Notes\n\n## Notes\n").contentHtml;
check("first duplicate heading keeps the bare slug", /<h2 id="notes">/.test(dupes));
check("later duplicates are suffixed", /<h2 id="notes-1">/.test(dupes) && /<h2 id="notes-2">/.test(dupes));
check("headings with no slug are left alone", /<h2>!!!<\/h2>/.test(renderDocument("## !!!\n").contentHtml));

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

// Hidden terms. The store writes to a real file, so point it somewhere temporary
// rather than at the reader's actual preferences.
const storeFile = join(tmpdir(), `mhg-dismissed-${process.pid}.json`);
process.env.MHG_DISMISSED_FILE = storeFile;
rmSync(storeFile, { force: true });

const hiddenDoc = renderDocument(derivedSrc, { dismissed: ["ACC"] });
check("hidden term dropped from payload", !hiddenDoc.terms.some((t) => t.term === "ACC"));
check("hidden count reported", hiddenDoc.hidden === 1);
check("other terms survive", hiddenDoc.terms.length === derivedDoc.terms.length - 1);
check("term source unchanged by hiding", hiddenDoc.termSource === "derived");
check("matching is case-insensitive", renderDocument(derivedSrc, { dismissed: ["acc"] }).hidden === 1);
check("unknown term hides nothing", renderDocument(derivedSrc, { dismissed: ["nope"] }).hidden === 0);
check("no dismissals leaves the doc alone", renderDocument(derivedSrc).hidden === 0);
// A hidden <abbr> must not fall back to the browser's own tooltip.
check("hidden abbr keeps no title", !/<abbr[^>]*title/i.test(hiddenDoc.contentHtml));

// Hiding an entry takes its aliases with it: ash2 only matched via ash1.
const aliasHidden = renderDocument(derivedSrc, { dismissed: ["ash1"] });
check("alias goes with its entry", !aliasHidden.terms.some((t) => t.aliases.includes("ash2")));

const { kept, hidden: hiddenTerms } = partitionDismissed(
  [{ term: "Nomad" }, { term: "ACC" }],
  ["nomad"]
);
check("partition keeps the rest", kept.length === 1 && kept[0].term === "ACC");
check("partition returns what it hid", hiddenTerms.length === 1 && hiddenTerms[0].term === "Nomad");

check("store starts empty", readDismissedTerms().length === 0);
addDismissed("Nomad", "/tmp/doc.md");
check("store persists a term", readDismissedTerms().join() === "Nomad");
check("store records where it came from", readDismissed()[0].from === "/tmp/doc.md");
check("store timestamps the entry", !!Date.parse(readDismissed()[0].dismissedAt));
addDismissed("nomad");
check("re-hiding does not duplicate", readDismissedTerms().join() === "nomad");
addDismissed("Airflow");
check("entries are sorted", readDismissedTerms().join() === "Airflow,nomad");
removeDismissed("NOMAD");
check("restore is case-insensitive", readDismissedTerms().join() === "Airflow");

// The file is meant to be hand-editable, so a bare array has to work too.
writeFileSync(storeFile, '["Kafka", "Envoy"]', "utf8");
check("bare string array is accepted", readDismissedTerms().join() === "Kafka,Envoy");
writeFileSync(storeFile, "{ not json", "utf8");
check("unreadable file degrades to empty", readDismissedTerms().length === 0);
rmSync(storeFile, { force: true });
check("missing file degrades to empty", readDismissedTerms().length === 0);

console.log(failures === 0 ? "\nParser/render checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
