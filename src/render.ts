import MarkdownIt from "markdown-it";
import { extractGlossary } from "./glossary";
import { deriveTerms } from "./derive-terms";
import { GlossaryTerm } from "./term-index";

// Blurb renderer for definition/example Markdown -> HTML. html:false so any raw
// HTML in a definition is escaped (safe to inject into the card).
const blurbMd = new MarkdownIt({ html: false, linkify: true, breaks: false });

export type TermSource = "block" | "derived" | "none";

const MERMAID_INFO_RE = /^\s*mermaid\s*$/i;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Render ```mermaid fences as a placeholder holding the diagram source as text.
 *
 * Keeping the source in a `<pre>` does double duty: the glossary pass already
 * skips `pre`, so term-wrapping can't corrupt the diagram, and a document still
 * reads fine if mermaid never loads.
 */
function installMermaidFence(md: MarkdownIt): () => number {
  const fallback = md.renderer.rules.fence;
  let count = 0;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    if (!MERMAID_INFO_RE.test(token.info || "")) {
      return fallback
        ? fallback(tokens, idx, options, env, self)
        : self.renderToken(tokens, idx, options);
    }
    count++;
    return (
      `<div class="mhg-mermaid" data-mhg-state="pending">` +
      `<pre class="mhg-mermaid-src">${escapeHtml(token.content)}</pre>` +
      `</div>\n`
    );
  };
  return () => count;
}

export interface PayloadTerm {
  term: string;
  aliases: string[];
  defHtml: string;
  exampleHtml?: string;
  link?: string;
}

export interface RenderedDoc {
  contentHtml: string;
  terms: PayloadTerm[];
  /** Where the terms came from, so the viewer can say so. */
  termSource: TermSource;
  /** Number of ```mermaid fences found, for the status line. */
  diagrams: number;
  error?: string;
}

const ABBR_TAG_RE = /<abbr\s+[^>]*?title\s*=\s*(?:"[^"]*"|'[^']*')[^>]*>([\s\S]*?)<\/abbr>/gi;

/**
 * Drop `title` from any `<abbr>` whose surface is a glossary term. The browser's
 * native tooltip would otherwise fire alongside our hover card.
 */
function dropCoveredAbbrTitles(html: string, surfaces: Set<string>): string {
  ABBR_TAG_RE.lastIndex = 0;
  return html.replace(ABBR_TAG_RE, (whole, inner: string) => {
    const surface = inner.replace(/<[^>]+>/g, "").trim().toLowerCase();
    return surfaces.has(surface) ? `<abbr>${inner}</abbr>` : whole;
  });
}

export function renderDocument(src: string): RenderedDoc {
  const { found, glossary, strippedSrc } = extractGlossary(src);

  const blockTerms = glossary?.terms || [];
  const useBlock = found && blockTerms.length > 0;
  const sourceTerms: GlossaryTerm[] = useBlock ? blockTerms : deriveTerms(src);
  let termSource: TermSource = "none";
  if (sourceTerms.length) {
    termSource = useBlock ? "block" : "derived";
  }

  const contentMd = new MarkdownIt({ html: true, linkify: true, typographer: false });
  const diagramCount = installMermaidFence(contentMd);
  let contentHtml = contentMd.render(strippedSrc);

  const surfaces = new Set<string>();
  for (const t of sourceTerms) {
    surfaces.add(t.term.toLowerCase());
    for (const a of t.aliases || []) {
      surfaces.add(a.toLowerCase());
    }
  }
  if (surfaces.size) {
    contentHtml = dropCoveredAbbrTitles(contentHtml, surfaces);
  }

  const terms: PayloadTerm[] = sourceTerms.map((t) => ({
    term: t.term,
    aliases: t.aliases,
    defHtml: blurbMd.render(t.definition || ""),
    exampleHtml: t.example ? blurbMd.render(t.example) : undefined,
    link: t.link,
  }));

  return { contentHtml, terms, termSource, diagrams: diagramCount(), error: glossary?.error };
}
