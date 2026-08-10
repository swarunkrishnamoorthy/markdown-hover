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

async function mount(markdown, filename, setup) {
  const dom = new JSDOM(
    `<!DOCTYPE html><html><body>
    <header class="mhg-topbar"><input id="mhg-path"/><span id="mhg-status"></span><datalist id="mhg-recents"></datalist></header>
    <main id="mhg-content" class="mhg-content"></main>
  </body></html>`,
    { runScripts: "outside-only", pretendToBeVisual: true }
  );
  const { window } = dom;
  window.console = console;
  if (setup) {
    setup(window);
  }
  window.__MHG_DATA__ = {
    ...renderDocument(markdown),
    filename,
    options: { matchAllOccurrences: true, caseSensitive: false },
  };
  window.eval(appJs);
  // boot() runs on DOMContentLoaded if loading; readyState is "complete" here so it
  // already ran synchronously during eval. Give any microtasks a tick anyway.
  await new Promise((r) => setTimeout(r, 20));
  return window;
}

const window = await mount(src, "sample.md");
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

// a doc whose terms were derived from <abbr> tags + a Glossary table
const derivedSrc = readFileSync(join(root, "samples", "derived.md"), "utf8");
const dWindow = await mount(derivedSrc, "derived.md");
const dDoc = dWindow.document;
const dTerms = Array.from(dDoc.querySelectorAll(".mhg-term"));
const surfaces = new Set(dTerms.map((t) => t.textContent));

check("derived terms underlined", dTerms.length >= 5);
check("term from abbr tag underlined", surfaces.has("ACC"));
check("term only in the table underlined", surfaces.has("ash1"));
check("alias underlined", surfaces.has("Public Gateway"));
check("no native tooltip left on abbr", !dDoc.querySelector("#mhg-content abbr[title]"));

dTerms.find((t) => t.textContent === "ACC").dispatchEvent(
  new dWindow.MouseEvent("mouseover", { bubbles: true })
);
const dCard = dDoc.querySelector(".mhg-card");
check("derived term shows a card", !!dCard && /HTTP 503/.test(dCard.innerHTML));

// Diagrams: jsdom cannot lay out SVG, so mermaid itself is not exercised here.
// What matters is that the placeholders survive the glossary pass intact.
const showcaseSrc = readFileSync(join(root, "samples", "showcase.md"), "utf8");
const sWindow = await mount(showcaseSrc, "showcase.md");
const sDoc = sWindow.document;
const diagrams = sDoc.querySelectorAll(".mhg-mermaid");
check("diagram placeholders in the DOM", diagrams.length === 2);
check(
  "diagram source preserved verbatim",
  /flowchart LR/.test(sDoc.querySelector(".mhg-mermaid .mhg-mermaid-src").textContent)
);
check("no glossary terms wrapped inside a diagram", !sDoc.querySelector(".mhg-mermaid .mhg-term"));
check("terms outside diagrams still wrapped", sDoc.querySelectorAll(".mhg-term").length >= 5);

// Diagram drawing, with mermaid stubbed out: jsdom cannot lay out SVG, but the
// wiring around mermaid is exactly where the bugs were.
const diagramMd = [
  "# D",
  "",
  "```mermaid",
  "flowchart LR",
  "  A[Alpha] --> B[Beta]",
  "  style A fill:#ffe0e0",
  "```",
  "",
].join("\n");

const mWindow = await mount(diagramMd, "d.md", (w) => {
  w.mermaid = {
    initialize() {},
    async render(id) {
      return {
        svg:
          `<svg id="${id}" width="400" height="200" viewBox="0 0 400 200">` +
          `<g class="node"><rect style="fill:#ffe0e0"/><text class="pale">Alpha</text></g>` +
          `<g class="node"><rect style="fill:#161b22"/><text class="dark">Beta</text></g></svg>`,
      };
    },
  };
});
const mDoc = mWindow.document;
const host = mDoc.querySelector(".mhg-mermaid");
check("diagram rendered to svg", !!mDoc.querySelector(".mhg-mermaid svg"));
check("diagram marked done", host.dataset.mhgState === "done");
check("source kept for redraw", /flowchart LR/.test(host.dataset.mhgSource || ""));

// A pale author fill must get dark ink, a dark fill light ink, whatever the theme.
const paleInk = mDoc.querySelector("text.pale").style.fill;
const darkInk = mDoc.querySelector("text.dark").style.fill;
check("dark ink on a pale author fill", paleInk === "#0f141a");
check("light ink on a dark fill", darkInk === "#eaf0f7");

const expand = mDoc.querySelector(".mhg-mermaid-expand");
check("expand button added", !!expand);
expand.dispatchEvent(new mWindow.MouseEvent("click", { bubbles: true }));
await new Promise((r) => setTimeout(r, 20));

const zoom = mDoc.querySelector(".mhg-zoom");
check("expand opens the overlay", !!zoom);
check("overlay contains the diagram", !!zoom?.querySelector("svg"));
// Regression: a clone with no dimensions collapses to zero height in a flex item.
const clone = zoom?.querySelector("svg");
check("overlay diagram has explicit size", clone?.getAttribute("width") === "400");
check(
  "overlay toolbar complete",
  [...(zoom?.querySelectorAll(".mhg-zoom-bar button") || [])].map((b) => b.textContent).join(",") ===
    "−,+,Reset,Close"
);
check("page scroll locked while open", mDoc.body.classList.contains("mhg-zoom-open"));

[...zoom.querySelectorAll("button")].find((b) => b.textContent === "Close").dispatchEvent(
  new mWindow.MouseEvent("click", { bubbles: true })
);
await new Promise((r) => setTimeout(r, 20));
check("close removes the overlay", !mDoc.querySelector(".mhg-zoom"));
check("page scroll restored", !mDoc.body.classList.contains("mhg-zoom-open"));

console.log(failures === 0 ? "\nDOM checks passed." : `\n${failures} DOM check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
