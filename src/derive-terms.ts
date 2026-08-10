// Fallback term sources for documents that never got a `<!-- glossary -->` block.
//
// Two conventions show up often enough in hand-written docs to be worth reading:
// inline `<abbr title="…">` tags, and a Markdown table under a "Glossary" heading.
// Both are lossy compared to the real block (no examples, no links), but they turn
// an otherwise term-less document into a usable one.

import { GlossaryTerm } from "./term-index";

const ABBR_RE = /<abbr\s+[^>]*?title\s*=\s*("([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/abbr>/gi;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const TABLE_ROW_RE = /^\s*\|(.*)\|\s*$/;
const SEPARATOR_ROW_RE = /^\s*\|[\s:|-]+\|\s*$/;

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

/** Strip the inline Markdown that decorates a term cell: `**x**`, `_x_`, `` `x` ``. */
function stripInlineMarkup(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/\*\*([\s\S]*?)\*\*/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(^|\s)[*_]([^*_]+)[*_](?=\s|$|[.,)])/g, "$1$2")
    .trim();
}

/**
 * Split a term cell into a canonical surface plus aliases.
 *
 * Handles the shapes that occur in practice:
 *   `**ACC**`                      -> ACC
 *   `**PGW / Public Gateway**`     -> PGW, alias "Public Gateway"
 *   `**Elasticsearch (ES)**`       -> Elasticsearch, alias "ES"
 *   `**go/911, go/912**`           -> go/911, alias "go/912"
 *
 * Only a slash with surrounding whitespace separates surfaces, so paths and
 * shortlinks survive intact.
 */
function parseTermCell(cell: string): { term: string; aliases: string[] } | null {
  const text = stripInlineMarkup(cell);
  if (!text) {
    return null;
  }

  const parentheticals: string[] = [];
  const withoutParens = text
    .replace(/\(([^)]*)\)/g, (_, inner: string) => {
      const cleaned = stripInlineMarkup(inner);
      if (cleaned) {
        parentheticals.push(cleaned);
      }
      return " ";
    })
    .trim();

  const surfaces = (withoutParens || text)
    .split(/\s+\/\s+|\s*,\s*|\s+or\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!surfaces.length) {
    return null;
  }

  return { term: surfaces[0], aliases: [...surfaces.slice(1), ...parentheticals] };
}

function splitRow(line: string): string[] {
  const inner = TABLE_ROW_RE.exec(line);
  if (!inner) {
    return [];
  }
  // Respect `\|` escapes; code spans in these cells never contain raw pipes.
  return inner[1]
    .split(/(?<!\\)\|/)
    .map((c) => c.replace(/\\\|/g, "|").trim());
}

/** Term/definition pairs from the first two-column table under a "Glossary" heading. */
export function harvestGlossaryTable(src: string): GlossaryTerm[] {
  const lines = src.split(/\r?\n/);
  const out: GlossaryTerm[] = [];

  let inGlossarySection = false;
  let sectionDepth = 0;
  let sawHeaderRow = false;

  for (const line of lines) {
    const heading = HEADING_RE.exec(line);
    if (heading) {
      const depth = heading[1].length;
      if (inGlossarySection && depth <= sectionDepth) {
        break;
      }
      if (!inGlossarySection && /\bglossar(y|ies)\b/i.test(heading[2])) {
        inGlossarySection = true;
        sectionDepth = depth;
      }
      continue;
    }
    if (!inGlossarySection || !TABLE_ROW_RE.test(line)) {
      continue;
    }
    if (SEPARATOR_ROW_RE.test(line)) {
      continue;
    }

    const cells = splitRow(line);
    if (cells.length < 2) {
      continue;
    }
    // First row of the table is its header.
    if (!sawHeaderRow) {
      sawHeaderRow = true;
      continue;
    }

    const parsed = parseTermCell(cells[0]);
    const definition = cells[1].trim();
    if (!parsed || !definition) {
      continue;
    }
    out.push({ term: parsed.term, aliases: parsed.aliases, definition });
  }

  // A parenthetical that names another term is a disambiguator, not an alias:
  // "**tier** (DAG)" must not make "DAG" point at "tier".
  const canonical = new Set(out.map((t) => t.term.toLowerCase()));
  for (const t of out) {
    t.aliases = t.aliases.filter((a) => !canonical.has(a.toLowerCase()));
  }
  return out;
}

/** Term/definition pairs from inline `<abbr title="…">surface</abbr>` tags. */
export function harvestAbbrTags(src: string): GlossaryTerm[] {
  const out: GlossaryTerm[] = [];
  const seen = new Set<string>();
  ABBR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ABBR_RE.exec(src)) !== null) {
    const definition = decodeEntities(m[2] ?? m[3] ?? "").trim();
    const term = stripInlineMarkup(decodeEntities(m[4] || ""));
    if (!term || !definition) {
      continue;
    }
    const key = term.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push({ term, aliases: [], definition });
  }
  return out;
}

/**
 * Best-effort glossary for a document with no `<!-- glossary -->` block.
 * Table entries win over `<abbr>` ones: they are usually the fuller write-up.
 */
export function deriveTerms(src: string): GlossaryTerm[] {
  const merged: GlossaryTerm[] = [];
  const seen = new Set<string>();
  for (const t of [...harvestGlossaryTable(src), ...harvestAbbrTags(src)]) {
    const key = t.term.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(t);
  }
  return merged;
}
