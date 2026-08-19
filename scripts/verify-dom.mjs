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

const PAGE = `<!DOCTYPE html><html><body>
    <header class="mhg-topbar"><input id="mhg-path"/><span id="mhg-status"></span>
    <button id="mhg-hidden" hidden>Hidden 0</button><datalist id="mhg-recents"></datalist></header>
    <main id="mhg-content" class="mhg-content"></main>
  </body></html>`;

async function mount(markdown, filename, setup) {
  const dom = new JSDOM(PAGE, { runScripts: "outside-only", pretendToBeVisual: true });
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
check("content injected", /<h1\b/.test(doc.getElementById("mhg-content").innerHTML));
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
check("python fence gets a copy button", !!sDoc.querySelector(".mhg-code .mhg-copy"));
check("mermaid source is not treated as a code block", !sDoc.querySelector(".mhg-mermaid .mhg-copy"));

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

// Zooming must resize the SVG itself, not CSS-scale a rasterised layer, or the
// vector goes blurry the moment you zoom in.
const stage = zoom.querySelector(".mhg-zoom-stage");
const zoomIn = [...zoom.querySelectorAll(".mhg-zoom-bar button")].find((b) => b.textContent === "+");
zoomIn.dispatchEvent(new mWindow.MouseEvent("click", { bubbles: true }));
check("zoom grows the svg's own box", clone.style.width === "500px" && clone.style.height === "250px");
check("zoom never css-scales the layer", !/scale\(/.test(stage.style.transform));

[...zoom.querySelectorAll("button")].find((b) => b.textContent === "Close").dispatchEvent(
  new mWindow.MouseEvent("click", { bubbles: true })
);
await new Promise((r) => setTimeout(r, 20));
check("close removes the overlay", !mDoc.querySelector(".mhg-zoom"));
check("page scroll restored", !mDoc.body.classList.contains("mhg-zoom-open"));

// Hiding a term, driven through the same code path the real viewer uses: no
// inlined data, a stubbed server, and a click on the card's Hide button.
function jsonResponse(body) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body });
}

async function mountServed(markdown, filename, dir = "/tmp") {
  const dismissed = [];
  const posts = [];
  const rendered = [];
  const dom = new JSDOM(PAGE, {
    runScripts: "outside-only",
    pretendToBeVisual: true,
    url: `http://localhost/?path=${dir}/${filename}`,
  });
  const { window } = dom;
  window.console = console;
  window.scrollTo = () => {}; // jsdom has no layout; the real viewer restores scroll here
  window.fetch = (input, init = {}) => {
    const url = new URL(String(input), "http://localhost");
    const entries = () => dismissed.map((term) => ({ term }));
    if (url.pathname === "/api/render") {
      // The server echoes back the path it resolved, so the stub does too.
      const requested = url.searchParams.get("path") || `${dir}/${filename}`;
      rendered.push(requested);
      return jsonResponse({
        ...renderDocument(markdown, { dismissed }),
        path: requested,
        filename: requested.slice(requested.lastIndexOf("/") + 1),
        options: { matchAllOccurrences: true, caseSensitive: false },
      });
    }
    if (url.pathname === "/api/dismissed") {
      if (init.method === "POST") {
        const body = JSON.parse(init.body);
        posts.push(body);
        dismissed.push(body.term);
      } else if (init.method === "DELETE") {
        const term = (url.searchParams.get("term") || "").toLowerCase();
        const at = dismissed.findIndex((t) => t.toLowerCase() === term);
        if (at >= 0) {
          dismissed.splice(at, 1);
        }
      }
      return jsonResponse({ terms: entries() });
    }
    return jsonResponse({});
  };
  window.eval(appJs);
  await new Promise((r) => setTimeout(r, 60));
  return { window, posts, dismissed, rendered };
}

const hideMd = [
  "# H",
  "",
  "Nomad schedules the work and Envoy proxies it.",
  "",
  "<!-- glossary",
  "terms:",
  "  - term: Nomad",
  "    definition: A scheduler.",
  "  - term: Envoy",
  "    definition: A proxy.",
  "-->",
  "",
].join("\n");

const served = await mountServed(hideMd, "hide.md");
const hDoc = served.window.document;
const termFor = (name) =>
  [...hDoc.querySelectorAll(".mhg-term")].find((t) => t.textContent === name);

check("served doc underlines its terms", !!termFor("Nomad") && !!termFor("Envoy"));

termFor("Nomad").dispatchEvent(new served.window.MouseEvent("mouseover", { bubbles: true }));
const hideBtn = hDoc.querySelector(".mhg-card-hide");
check("card offers a hide button", !!hideBtn);

hideBtn.dispatchEvent(new served.window.MouseEvent("click", { bubbles: true }));
await new Promise((r) => setTimeout(r, 60));

check("hiding posts the canonical term", served.posts.length === 1 && served.posts[0].term === "Nomad");
check("hiding records the document", served.posts[0].from === "/tmp/hide.md");
check("hidden term stops being underlined", !termFor("Nomad"));
check("other terms keep working", !!termFor("Envoy"));
check("card is dismissed after hiding", hDoc.querySelector(".mhg-card").style.display === "none");
check("status reports the hidden count", /1 hidden/.test(hDoc.getElementById("mhg-status").textContent));

const hiddenButton = hDoc.getElementById("mhg-hidden");
check("hidden button becomes usable", !hiddenButton.hidden && !hiddenButton.disabled);
check("hidden button shows the count", hiddenButton.textContent === "Hidden 1");

hiddenButton.dispatchEvent(new served.window.MouseEvent("click", { bubbles: true }));
await new Promise((r) => setTimeout(r, 40));
const panel = hDoc.querySelector(".mhg-hidden-panel");
check("panel lists hidden terms", !!panel && /Nomad/.test(panel.textContent));

panel.querySelector(".mhg-hidden-restore").dispatchEvent(
  new served.window.MouseEvent("click", { bubbles: true })
);
await new Promise((r) => setTimeout(r, 60));
check("restoring clears the blacklist", served.dismissed.length === 0);
check("restored term is underlined again", !!termFor("Nomad"));

// The standalone export has no server, so it must not offer to hide anything.
const exported = await mount(hideMd, "hide.md");
exported.document
  .querySelector(".mhg-term")
  .dispatchEvent(new exported.MouseEvent("mouseover", { bubbles: true }));
check(
  "no hide button without a server",
  !exported.document.querySelector(".mhg-card-hide")
);

// A glossary block that fails to parse must still show the doc, and must say so
// accurately -- reporting "no glossary block found" sends the author looking in
// the wrong place. The excerpt is preformatted and never interpreted as HTML.
const badYamlMd = [
  "# Bad",
  "",
  "Body text.",
  "",
  "<!-- glossary",
  "- term: A",
  "  definition: <img src=x onerror=alert(1)>",
  "  example: `x`",
  "-->",
].join("\n");
const bad = await mountServed(badYamlMd, "bad.md");
const errorEl = bad.window.document.querySelector(".mhg-error");
check("parse error is shown", !!errorEl);
check("parse error uses a pre", errorEl?.tagName === "PRE");
check("parse error keeps its line breaks", (errorEl?.textContent.match(/\n/g) || []).length > 3);
check("parse error names the document line", /\(line 8, column \d+\)/.test(errorEl?.textContent));
check("document text cannot inject markup", !errorEl?.querySelector("img"));
check("prose still renders alongside the error", /Body text/.test(bad.window.document.body.textContent));
check(
  "status blames the parse, not a missing block",
  /failed to parse/.test(bad.window.document.querySelector("#mhg-status").textContent)
);
check("parse-error excerpt has no copy button", !bad.window.document.querySelector(".mhg-error .mhg-copy, .mhg-code .mhg-error"));

// Relative links are written for a file tree. Left alone the browser resolves
// them against the origin and asks the viewer's server for a file it does not
// serve, so every viewable one is pointed back into the viewer.
const linksMd = [
  "# Links",
  "",
  "- [sibling](01-guide.md)",
  "- [up and over](../other/notes.md)",
  "- [absolute](/var/docs/spec.md)",
  "- [a folder](../sibling-project/)",
  "- [with anchor](02-tables.md#engines)",
  "- [spaces](my%20notes.md)",
  "- [external](https://example.com/x.md)",
  "- [mail](mailto:me@example.com)",
  "- [in page](#links)",
  "- [an image](chart.png)",
  "",
].join("\n");
const linked = await mountServed(linksMd, "README.md", "/docs/proj");
const hrefOf = (text) =>
  Array.from(linked.window.document.querySelectorAll("#mhg-content a")).find(
    (a) => a.textContent === text
  );

check("sibling link resolves next to the doc", hrefOf("sibling").getAttribute("href") === "/?path=%2Fdocs%2Fproj%2F01-guide.md");
check("parent segments are resolved", hrefOf("up and over").getAttribute("href") === "/?path=%2Fdocs%2Fother%2Fnotes.md");
check("absolute path is left absolute", hrefOf("absolute").getAttribute("href") === "/?path=%2Fvar%2Fdocs%2Fspec.md");
check("directory link is rewritten", hrefOf("a folder").getAttribute("href") === "/?path=%2Fdocs%2Fsibling-project");
check("anchor is carried across", hrefOf("with anchor").getAttribute("href") === "/?path=%2Fdocs%2Fproj%2F02-tables.md#engines");
check("percent-encoded names decode to real paths", hrefOf("spaces").dataset.mhgDoc === "/docs/proj/my notes.md");
check("external links are untouched", hrefOf("external").getAttribute("href") === "https://example.com/x.md");
check("mailto is untouched", hrefOf("mail").getAttribute("href") === "mailto:me@example.com");
check("in-page anchors are untouched", hrefOf("in page").getAttribute("href") === "#links");
check("non-document files are left for the browser", hrefOf("an image").getAttribute("href") === "chart.png");
check("only rewritten links are marked", !hrefOf("an image").hasAttribute("data-mhg-doc"));

// Following one swaps the document in place rather than reloading the page.
const before = linked.rendered.length;
hrefOf("sibling").dispatchEvent(
  new linked.window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })
);
await new Promise((r) => setTimeout(r, 40));
check("clicking a doc link loads it", linked.rendered[linked.rendered.length - 1] === "/docs/proj/01-guide.md");
check("clicking issues exactly one render", linked.rendered.length === before + 1);
check("history follows the link", linked.window.location.search === "?path=%2Fdocs%2Fproj%2F01-guide.md");

// A modified click is the reader asking for a new tab, so it must reach the browser.
const openInTab = new linked.window.MouseEvent("click", {
  bubbles: true,
  cancelable: true,
  button: 0,
  metaKey: true,
});
hrefOf("sibling")?.dispatchEvent(openInTab);
await new Promise((r) => setTimeout(r, 20));
check("cmd-click is left to the browser", !openInTab.defaultPrevented);

// The standalone export has no viewer to link into, so links stay as written.
const exportedLinks = await mount(linksMd, "README.md");
check(
  "export leaves relative links alone",
  Array.from(exportedLinks.document.querySelectorAll("#mhg-content a")).every(
    (a) => !a.hasAttribute("data-mhg-doc")
  )
);

// A code block gets a Copy button that writes the whole fence, not a selection.
const copyMd = [
  "# SQL",
  "",
  "Inline `journal_raw` is not a block.",
  "",
  "```sql",
  "CREATE TABLE t (id String);",
  "```",
  "",
  "```",
  "plain fence",
  "```",
  "",
].join("\n");
const copied = [];
const copyWin = await mount(copyMd, "ddl.md", (w) => {
  w.navigator.clipboard = {
    writeText: (text) => {
      copied.push(text);
      return Promise.resolve();
    },
  };
});
const copyButtons = [...copyWin.document.querySelectorAll(".mhg-copy")];
check("one button per fence", copyButtons.length === 2);
check("inline code has no copy button", !copyWin.document.querySelector("p .mhg-copy"));

copyButtons[0].dispatchEvent(new copyWin.MouseEvent("click", { bubbles: true }));
await new Promise((r) => setTimeout(r, 20));
check("copy writes the fence text", copied[0] === "CREATE TABLE t (id String);\n");
check("button confirms the copy", copyButtons[0].textContent === "Copied");

copyButtons[1].dispatchEvent(new copyWin.MouseEvent("click", { bubbles: true }));
await new Promise((r) => setTimeout(r, 20));
check("unlabelled fence copies too", copied[1] === "plain fence\n");

// The fallback path is what a file:// export has to use.
const fallback = [];
const execWin = await mount("```\nfallback\n```\n", "f.md", (w) => {
  delete w.navigator.clipboard;
  w.document.execCommand = (cmd) => {
    if (cmd === "copy") {
      fallback.push(w.document.querySelector("textarea")?.value);
      return true;
    }
    return false;
  };
});
execWin.document.querySelector(".mhg-copy").dispatchEvent(
  new execWin.MouseEvent("click", { bubbles: true })
);
await new Promise((r) => setTimeout(r, 20));
check("clipboard fallback writes the fence", fallback[0] === "fallback\n");

console.log(failures === 0 ? "\nDOM checks passed." : `\n${failures} DOM check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
