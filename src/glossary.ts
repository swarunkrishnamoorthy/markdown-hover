import * as yaml from "js-yaml";
import { GlossaryTerm } from "./term-index";

export { GlossaryTerm } from "./term-index";
export { buildTermIndex } from "./term-index";

export interface ParsedGlossary {
  terms: GlossaryTerm[];
  error?: string;
}

export interface ExtractResult {
  found: boolean;
  glossary: ParsedGlossary | null;
  /** Source with the glossary block blanked out (same length preserved). */
  strippedSrc: string;
  range?: { start: number; end: number };
}

// Matches an HTML comment whose first token is `glossary`.
const GLOSSARY_RE = /<!--\s*glossary\b([\s\S]*?)-->/i;

function asString(v: unknown): string {
  if (v === undefined || v === null) {
    return "";
  }
  return typeof v === "string" ? v : String(v);
}

function normalizeTerms(raw: unknown): GlossaryTerm[] {
  if (!raw || typeof raw !== "object") {
    return [];
  }
  const termsRaw = (raw as Record<string, unknown>).terms;
  if (!Array.isArray(termsRaw)) {
    return [];
  }
  const out: GlossaryTerm[] = [];
  for (const entry of termsRaw) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const e = entry as Record<string, unknown>;
    const term = asString(e.term ?? e.name).trim();
    const definition = asString(e.definition ?? e.def).trim();
    if (!term || !definition) {
      continue;
    }
    let aliases: string[] = [];
    if (Array.isArray(e.aliases)) {
      aliases = e.aliases.map((a) => asString(a).trim()).filter(Boolean);
    } else if (typeof e.aliases === "string") {
      aliases = [e.aliases.trim()].filter(Boolean);
    }
    const example = e.example !== undefined ? asString(e.example) : undefined;
    const link = e.link !== undefined ? asString(e.link).trim() : undefined;
    out.push({ term, aliases, definition, example, link });
  }
  return out;
}

export function parseGlossaryBody(body: string): ParsedGlossary {
  try {
    const data = yaml.load(body);
    return { terms: normalizeTerms(data) };
  } catch (err) {
    return { terms: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export function extractGlossary(src: string): ExtractResult {
  const match = GLOSSARY_RE.exec(src);
  if (!match) {
    return { found: false, glossary: null, strippedSrc: src };
  }
  const glossary = parseGlossaryBody(match[1]);
  const start = match.index;
  const end = start + match[0].length;
  const strippedSrc = src.slice(0, start) + " ".repeat(match[0].length) + src.slice(end);
  return { found: true, glossary, strippedSrc, range: { start, end } };
}
