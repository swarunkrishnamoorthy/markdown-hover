import MarkdownIt from "markdown-it";
import { extractGlossary } from "./glossary";
import { deriveTerms } from "./derive-terms";
import { partitionDismissed, surfacesOf } from "./dismissed";
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

/**
 * GitHub's heading slug: lowercase, drop anything that is not a word character,
 * hyphen or space, then one hyphen per remaining space. Runs of spaces are kept
 * as runs, which is why a heading with an em dash slugs to a double hyphen.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\- ]+/g, "")
    .trim()
    .replace(/ /g, "-");
}

/**
 * Give headings ids so in-document links work. Authors write these anchors to
 * match GitHub, so the slugs have to agree with it rather than be merely unique.
 */
function installHeadingIds(md: MarkdownIt): void {
  const fallback = md.renderer.rules.heading_open;
  const seen = new Map<string, number>();
  md.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
    const inline = tokens[idx + 1];
    if (inline && inline.type === "inline") {
      // Emphasis and link markup are structure, not part of the visible text.
      const text = inline.children
        ? inline.children
            .filter((t) => t.type === "text" || t.type === "code_inline")
            .map((t) => t.content)
            .join("")
        : inline.content;
      const base = slugify(text);
      if (base) {
        const count = seen.get(base) || 0;
        seen.set(base, count + 1);
        tokens[idx].attrSet("id", count ? `${base}-${count}` : base);
      }
    }
    return fallback
      ? fallback(tokens, idx, options, env, self)
      : self.renderToken(tokens, idx, options);
  };
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
  /** Terms this document defines that the reader has permanently hidden. */
  hidden: number;
  error?: string;
}

export interface RenderOptions {
  /** Canonical terms the reader has hidden, from the on-disk blacklist. */
  dismissed?: readonly string[];
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

export function renderDocument(src: string, options: RenderOptions = {}): RenderedDoc {
  const { found, glossary, strippedSrc } = extractGlossary(src);

  const blockTerms = glossary?.terms || [];
  const useBlock = found && blockTerms.length > 0;
  const definedTerms: GlossaryTerm[] = useBlock ? blockTerms : deriveTerms(src);
  // The blacklist applies whatever the source: a term you know is a term you
  // know, whether the document defined it or the viewer derived it.
  const { kept: sourceTerms, hidden } = partitionDismissed(definedTerms, options.dismissed);
  let termSource: TermSource = "none";
  if (definedTerms.length) {
    termSource = useBlock ? "block" : "derived";
  }

  const contentMd = new MarkdownIt({ html: true, linkify: true, typographer: false });
  const diagramCount = installMermaidFence(contentMd);
  installHeadingIds(contentMd);
  let contentHtml = contentMd.render(strippedSrc);

  // Hidden terms are stripped too. Leaving their `title` in place would swap our
  // card for the browser's native tooltip, which is the opposite of hiding them.
  const surfaces = surfacesOf(definedTerms);
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

  return {
    contentHtml,
    terms,
    termSource,
    diagrams: diagramCount(),
    hidden: hidden.length,
    error: glossary?.error,
  };
}
