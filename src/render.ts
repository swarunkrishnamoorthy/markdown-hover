import MarkdownIt from "markdown-it";
import { extractGlossary } from "./glossary";

// Blurb renderer for definition/example Markdown -> HTML. html:false so any raw
// HTML in a definition is escaped (safe to inject into the card).
const blurbMd = new MarkdownIt({ html: false, linkify: true, breaks: false });

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
  error?: string;
}

export function renderDocument(src: string): RenderedDoc {
  const { glossary, strippedSrc } = extractGlossary(src);
  const contentMd = new MarkdownIt({ html: true, linkify: true, typographer: false });
  const contentHtml = contentMd.render(strippedSrc);

  const terms: PayloadTerm[] = (glossary?.terms || []).map((t) => ({
    term: t.term,
    aliases: t.aliases,
    defHtml: blurbMd.render(t.definition || ""),
    exampleHtml: t.example ? blurbMd.render(t.example) : undefined,
    link: t.link,
  }));

  return { contentHtml, terms, error: glossary?.error };
}
