// Runs the real browser bundle (web/dist/app.js) in jsdom against the rendered
// sample and verifies wrapping + hover-card behavior. Run with `npm run verify:dom`.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { JSDOM } from "jsdom";
import { renderDocument } from "../dist/core.node.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const src = readFileSync(join(root, "samples", "sample.md"), "utf8");
const appJs = readFileSync(join(root, "web", "dist", "app.js"), "utf8");

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) {
    failures++;
  }
}

const data = {
  ...renderDocument(src),
  filename: "sample.md",
  options: { matchAllOccurrences: true, caseSensitive: false },
};

const dom = new JSDOM(
  `<!DOCTYPE html><html><body>
    <header class="mhg-topbar"><input id="mhg-path"/><span id="mhg-status"></span><datalist id="mhg-recents"></datalist></header>
    <main id="mhg-content" class="mhg-content"></main>
  </body></html>`,
  { runScripts: "outside-only", pretendToBeVisual: true }
);
const { window } = dom;
window.console = console;
window.__MHG_DATA__ = data;

window.eval(appJs);

// boot() runs on DOMContentLoaded if loading; readyState is "complete" here so it
// already ran synchronously during eval. Give any microtasks a tick anyway.
await new Promise((r) => setTimeout(r, 20));

const doc = window.document;
const terms = doc.querySelectorAll(".mhg-term");
check("topbar hidden in standalone", doc.querySelector(".mhg-topbar").style.display === "none");
check("content injected", /<h1>/.test(doc.getElementById("mhg-content").innerHTML));
check("terms underlined (>=5)", terms.length >= 5);

const multi = Array.from(terms).find(
  (t) => t.textContent.toLowerCase() === "state assertions per test"
);
check("multi-word term wrapped whole", !!multi);
check(
  "no terms inside code",
  doc.querySelectorAll("code .mhg-term, pre .mhg-term").length === 0
);

// hover -> card populates
const evt = new window.MouseEvent("mouseover", { bubbles: true });
terms[0].dispatchEvent(evt);
const card = doc.querySelector(".mhg-card");
check("hover card created", !!card);
check("card has title", !!card && !!card.querySelector(".mhg-card-title"));
check("card has body", !!card && !!card.querySelector(".mhg-card-body"));
check("card visible", !!card && card.style.display !== "none");

// regression: card must stay open (no MutationObserver to hide it)
await new Promise((r) => setTimeout(r, 350));
check(
  "card stays open after delay",
  !!doc.querySelector(".mhg-card") && doc.querySelector(".mhg-card").style.display !== "none"
);

console.log(failures === 0 ? "\nDOM checks passed." : `\n${failures} DOM check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
