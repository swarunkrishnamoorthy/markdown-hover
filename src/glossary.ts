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
  // A bare top-level list is accepted as shorthand for `terms:`.
  const termsRaw = Array.isArray(raw) ? raw : (raw as Record<string, unknown>).terms;
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

// A line of js-yaml's error excerpt, e.g. "  7 |   example: ...".
const GUTTER_RE = /^(\s*)(\d+) \| (.*)$/;

/**
 * js-yaml numbers lines from the start of the block body. Shift them so they
 * match what the author sees in their editor.
 */
function retargetPositions(message: string, offset: number): string {
  const lines = message.split("\n");
  const shifted = lines.map((line) => {
    const m = GUTTER_RE.exec(line);
    return m ? Number(m[2]) + offset : null;
  });
  const numbers = shifted.filter((n): n is number => n !== null);
  if (!numbers.length) {
    return message.replace(
      /\((\d+):(\d+)\)/,
      (_full, l: string, c: string) => `(line ${Number(l) + offset}, column ${c})`,
    );
  }
  const width = Math.max(...numbers.map((n) => String(n).length));
  const oldWidth = Math.max(
    ...lines.map((line) => {
      const m = GUTTER_RE.exec(line);
      return m ? m[1].length + m[2].length : 0;
    }),
  );
  // The caret line carries no number, so it has to slide by however much the
  // gutter grew or it stops pointing at the offending column.
  const pad = "-".repeat(Math.max(0, width + 1 - oldWidth));
  return lines
    .map((line, i) => {
      const n = shifted[i];
      if (n === null) {
        return /^-+\^/.test(line) ? pad + line : line;
      }
      const m = GUTTER_RE.exec(line) as RegExpExecArray;
      return ` ${String(n).padStart(width)} | ${m[3]}`;
    })
    .join("\n")
    .replace(
      /\((\d+):(\d+)\)/,
      (_full, l: string, c: string) => `(line ${Number(l) + offset}, column ${c})`,
    );
}

const BLOCK_SCALAR_HINT = 'Use a block scalar, which needs no escaping at all:\n\n  example: |\n    your text here';

// The two ways a hand-written glossary value breaks YAML. Both are natural
// things to type in a Markdown file, and neither is named by js-yaml's error.
function hintFor(line: string | undefined): string | null {
  const m = line ? /^\s*[A-Za-z_][\w-]*:[ \t]+(.*)$/.exec(line) : null;
  const value = m?.[1];
  if (!value) {
    return null;
  }
  const quoted = /^(".*"|'.*')\s*$/.test(value);
  if (quoted) {
    return null;
  }
  if (/^[`@]/.test(value)) {
    return `Hint: YAML reserves "${value[0]}" as the first character of a value, so this line is not valid YAML.\n${BLOCK_SCALAR_HINT}`;
  }
  if (/: /.test(value)) {
    return `Hint: an unquoted value cannot contain ": " -- YAML reads it as another key.\n${BLOCK_SCALAR_HINT}`;
  }
  return null;
}

function describeParseError(err: unknown, body: string, offset: number): string {
  if (!(err instanceof Error)) {
    return String(err);
  }
  const message = retargetPositions(err.message, offset);
  const mark = (err as { mark?: { line?: number } }).mark;
  const hint = typeof mark?.line === "number" ? hintFor(body.split("\n")[mark.line]) : null;
  return hint ? `${message}\n\n${hint}` : message;
}

function lineAt(src: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < src.length; i++) {
    if (src.charCodeAt(i) === 10) {
      line++;
    }
  }
  return line;
}

/** `firstLine` is the document line the body starts on, for error reporting. */
export function parseGlossaryBody(body: string, firstLine = 1): ParsedGlossary {
  try {
    const data = yaml.load(body);
    return { terms: normalizeTerms(data) };
  } catch (err) {
    return { terms: [], error: describeParseError(err, body, firstLine - 1) };
  }
}

export function extractGlossary(src: string): ExtractResult {
  const match = GLOSSARY_RE.exec(src);
  if (!match) {
    return { found: false, glossary: null, strippedSrc: src };
  }
  const glossary = parseGlossaryBody(match[1], lineAt(src, match.index));
  const start = match.index;
  const end = start + match[0].length;
  const strippedSrc = src.slice(0, start) + " ".repeat(match[0].length) + src.slice(end);
  return { found: true, glossary, strippedSrc, range: { start, end } };
}
