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

## How it works

- `src/glossary.ts` + `src/term-index.ts` — parse the embedded glossary and build
  the term matcher.
- `src/render.ts` — render Markdown to HTML (glossary stripped) and pre-render each
  definition/example blurb to HTML. Bundled to `dist/core.node.mjs`.
- `src/browser/*` — underline terms in the rendered DOM and show hover cards.
  Bundled to `web/dist/app.js`.
- `scripts/serve.mjs` — dev server: renders on request, serves the viewer, pushes
  live-reload events over SSE.
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
