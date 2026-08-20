# Markdown Hover Glossary (browser)

A local browser viewer for Markdown documents with a **per-document glossary**.
Hover a term to see a rich definition and example in a little card — so the prose
stays lean and the detail is available on demand.

Each document carries its own glossary, embedded at the bottom of the file inside
an HTML comment. The file renders clean everywhere (GitHub, editors); the hovers
appear only in this viewer.

## Quick start

Run one persistent server, then paste file paths into the box at the top of the
page — like a little local dashboard.

```bash
npm install
npm run build
npm run serve          # opens http://localhost:4321
```

At the top of the page, paste a path to a Markdown file (absolute or `~/…`) and
press **Open**. The doc renders with its glossary terms hoverable. The path is
kept in the URL (`?path=…`) so reloads and bookmarks work, recent files
autocomplete in the box, and the view live-reloads when the file changes.

Options: `npm run serve -- --port 5000`, `npm run serve -- --no-open`. You can also
preload a file: `npm run serve -- ~/swarun/notes/plan.md`.

Export a standalone, shareable HTML file (works over `file://`, no server):

```bash
npm run export -- samples/sample.md sample.html
```

## The glossary format

Put this at (or near) the end of the document. Because it's an HTML comment, it's
invisible in every other Markdown renderer.

````markdown
<!-- glossary
terms:
  - term: oracle strength
    aliases: [oracle, weak oracle]
    definition: |
      Given that a test reached the code, would it notice if the code were wrong?
    example: |
      Weak — reached but unchecked:

      ```csharp
      result.Should().NotBeNull();
      ```

      Strong — checks the outcome:

      ```csharp
      result.Status.Should().Be(Eligible);
      ```
  - term: patch coverage
    definition: |
      The fraction of newly changed lines exercised by tests in a PR.
-->
````

### Fields

| Field        | Required | Notes                                                        |
| ------------ | -------- | ------------------------------------------------------------ |
| `term`       | yes      | The canonical phrase. Multi-word phrases are supported.      |
| `definition` | yes      | Markdown. Rendered in the hover card.                        |
| `aliases`    | no       | Other surfaces that trigger the same card (plurals, etc.).   |
| `example`    | no       | Markdown, shown in a separate "Example" section. Code works. |
| `link`       | no       | A URL shown as a "More →" link in the card.                  |

Matching is whole-word and case-insensitive by default. Longer phrases win over
shorter ones they contain. Terms inside code spans, code blocks, and links are
never marked.

The `terms:` key is optional — a bare list of entries at the top level works too.

### YAML gotchas

The block is YAML, so a value that starts with a backtick has to be quoted.
This is the single most common way to break a block, because writing an example
as inline code is the natural instinct in a Markdown file:

```yaml
example: `foo --bar`      # breaks: backtick is a reserved YAML indicator
example: "`foo --bar`"    # fine
example: |                # fine, and better for anything multi-line
  `foo --bar`
```

When a block fails to parse, the viewer shows the document line and column of
the offending line and still renders the rest of the document.

### When there's no glossary block

Plenty of documents were written before this viewer existed and carry their
definitions some other way. Rather than showing them with zero terms, the viewer
falls back to two common conventions:

1. **Inline `<abbr>` tags** — `<abbr title="Definition here">TERM</abbr>`. The
   title becomes the definition. The `title` is then stripped from the rendered
   HTML so you get the hover card instead of the browser's native tooltip.
2. **A Markdown table under a "Glossary" heading** — first column is the term,
   second is the definition. Both are read; table entries win on conflict, since
   they're usually the fuller write-up.

Term cells are parsed forgivingly: `**PGW / Public Gateway**` yields an alias,
as does `**Elasticsearch (ES)**`. Only a slash *with spaces around it* separates
surfaces, so `go/911, go/912` survives. A parenthetical naming another defined
term is treated as a disambiguator and dropped, so `**tier** (DAG)` doesn't
hijack `DAG`.

These fallbacks are lossy — no examples, no links — and apply only when no
`glossary` block is present. The status bar says which source was used. To take
full control of a document, add a real block.

## Hiding terms you already know

Every hover card has a **Hide this term** button. Pressing it stops that term
being highlighted — not just in the current document, but in every document you
open afterwards. Knowing what Nomad is once means knowing it everywhere.

The list lives at `~/.config/markdown-hover/dismissed-terms.json` (or under
`$XDG_CONFIG_HOME`), and every render consults it, including `npm run export`.
Set `MHG_DISMISSED_FILE` to point somewhere else.

```json
{
  "version": 1,
  "terms": [
    { "term": "Nomad", "dismissedAt": "2026-08-10T19:50:33.500Z", "from": "/Users/me/primer.md" }
  ]
}
```

The file is read fresh on every render, so you can edit it by hand and just
reload. A bare `["Nomad", "Envoy"]` array works too, and a file that is missing
or malformed is treated as empty rather than breaking the page.

Notes:

- Hiding is keyed on the canonical term and takes that entry's aliases with it,
  so hiding `ash1` also stops `ash2` from matching.
- It applies whatever the source, whether the document defined the term in a
  `glossary` block or the viewer derived it from an `<abbr>` or table.
- A hidden `<abbr>` also loses its `title`, so it doesn't fall back to the
  browser's native tooltip.
- The topbar shows a **Hidden N** button listing what you've hidden, with a
  **Restore** next to each. Nothing is permanent in the unrecoverable sense.
- Standalone exports have no server to write to, so they show no Hide button.
  They do respect the blacklist as it stood when the file was exported.

## Diagrams

A ```` ```mermaid ```` fence is drawn as a diagram — flowcharts, sequence
diagrams, state charts, ER diagrams, and anything else Mermaid supports.

````markdown
```mermaid
flowchart LR
    C[Client] -->|write| L[Leader]
    L -->|commit once a quorum acks| C
```
````

Hovering a diagram reveals an **Expand** button that opens it full screen, where
the scroll wheel zooms and dragging pans. `Esc`, the **Close** button, or a click
on the backdrop dismisses it.

Notes:

- Mermaid is ~3.5MB, so it is fetched only when a document actually has a
  diagram. `npm run build` vendors it to `web/vendor/`, and the server serves it
  locally — no CDN on the normal path. Exported HTML falls back to a CDN, since
  there is no server to serve it from.
- Diagram text is never treated as prose, so glossary terms inside a diagram are
  left alone. They still hover normally in the surrounding text.
- If a diagram fails to parse, the viewer shows Mermaid's error above the
  original source rather than swallowing it.
- Diagrams follow the light/dark colour scheme and redraw when it changes.

## Links between documents

Relative links are written for a file tree, not for a web server, so
`[guide](01-guide.md)` in a doc would otherwise send the browser to
`localhost:4321/01-guide.md`. The viewer resolves them against the directory of
the document you are reading and points them back at itself, so a folder of docs
browses like a small site.

- Markdown files open in the viewer. Following one swaps the content in place,
  and Back returns to the previous document.
- A link to a folder opens its `README.md` or `index.md`.
- Anything else — images, PDFs, external URLs, `mailto:` — is left alone.
- Cmd-click, middle-click and **Open in new tab** still work, because the `href`
  is rewritten rather than merely intercepted.

Headings get GitHub-compatible ids, so a table of contents written as
`[Read this first](#read-this-first)` jumps to the right section.

## Home page

Clicking the **Glossary Viewer** title (top left) opens a home page with two
lists:

- The 25 most recently viewed files, from this browser's history.
- The 25 most recently modified Markdown files under `~/agent-artifacts`.

Either list opens a file in place. Back returns to the home page.

## Copying a code block

Every fenced or indented code block gets a **Copy** button in the top-right
corner. It copies the whole block, including a trailing newline if the fence
had one. Diagram source and parse-error excerpts are left alone.

## How it works

- `src/glossary.ts` + `src/term-index.ts` — parse the embedded glossary and build
  the term matcher.
- `src/derive-terms.ts` — fallback harvesting of `<abbr>` tags and Glossary tables
  for documents with no block.
- `src/dismissed.ts` + `src/dismissed-store.ts` — filter out terms the reader has
  hidden, and read/write the blacklist file.
- `src/render.ts` — render Markdown to HTML (glossary stripped) and pre-render each
  definition/example blurb to HTML. Also turns ```` ```mermaid ```` fences into
  placeholders. Bundled to `dist/core.node.mjs`.
- `src/browser/glossary-ui.ts` — underline terms in the rendered DOM and show
  hover cards.
- `src/browser/mermaid-ui.ts` — lazy-load Mermaid, draw the placeholders, and run
  the full-screen zoom/pan viewer. Bundled with the above to `web/dist/app.js`.
- `src/browser/doc-links.ts` — resolve relative links against the document's own
  directory so they open in the viewer.
- `src/browser/copy-ui.ts` — add a Copy button to each rendered code block.
- `scripts/serve.mjs` — dev server: renders on request, serves the viewer, pushes
  live-reload events over SSE. It re-imports the renderer whenever
  `dist/core.node.mjs` changes, so `npm run watch` and `npm run serve` can run
  side by side without restarts.
- `scripts/build-html.mjs` — inlines CSS + JS + data into one standalone HTML file.

## Develop

```bash
npm run typecheck
npm run verify      # Node parser/render checks + a headless (jsdom) run of the real bundle
```

## For agents authoring docs

When creating a new Markdown artifact, append a `glossary` block defining the
non-obvious terms you introduce. Keep definitions to a couple of sentences and add
an `example` for anything worth seeing used. Don't retrofit glossaries onto
existing documents unless asked.
