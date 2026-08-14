// Node-side persistence for hidden terms. The file is global to the machine, so
// hiding a term in one document hides it in every document opened afterwards.
//
// It is meant to be hand-editable, so reading is forgiving: a bare array of
// strings works as well as the full object form, and anything unparseable is
// treated as an empty list rather than breaking the viewer.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { dismissKey } from "./dismissed";

export interface DismissedEntry {
  term: string;
  /** ISO timestamp, so the file reads like a log of what you dismissed and when. */
  dismissedAt?: string;
  /** Document the term was hidden from, purely as a reminder of the context. */
  from?: string;
}

const FILE_VERSION = 1;

export function dismissedFilePath(): string {
  const override = process.env.MHG_DISMISSED_FILE;
  if (override) {
    return path.resolve(override);
  }
  const base = process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config");
  return path.join(base, "markdown-hover", "dismissed-terms.json");
}

function normalize(raw: unknown): DismissedEntry[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).terms)
      ? ((raw as Record<string, unknown>).terms as unknown[])
      : [];

  const out: DismissedEntry[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const entry =
      typeof item === "string"
        ? { term: item }
        : item && typeof item === "object"
          ? (item as DismissedEntry)
          : null;
    const term = entry && typeof entry.term === "string" ? entry.term.trim() : "";
    if (!term) {
      continue;
    }
    const key = dismissKey(term);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push({
      term,
      dismissedAt: typeof entry?.dismissedAt === "string" ? entry.dismissedAt : undefined,
      from: typeof entry?.from === "string" ? entry.from : undefined,
    });
  }
  return out;
}

export function readDismissed(): DismissedEntry[] {
  try {
    return normalize(JSON.parse(readFileSync(dismissedFilePath(), "utf8")));
  } catch {
    // Missing or malformed: an unreadable preferences file must never stop a
    // document from rendering.
    return [];
  }
}

export function readDismissedTerms(): string[] {
  return readDismissed().map((entry) => entry.term);
}

function write(entries: DismissedEntry[]): DismissedEntry[] {
  const file = dismissedFilePath();
  mkdirSync(path.dirname(file), { recursive: true });
  const body = { version: FILE_VERSION, terms: entries };
  writeFileSync(file, JSON.stringify(body, null, 2) + "\n", "utf8");
  return entries;
}

export function addDismissed(term: string, from?: string): DismissedEntry[] {
  const clean = term.trim();
  if (!clean) {
    return readDismissed();
  }
  const entries = readDismissed().filter((e) => dismissKey(e.term) !== dismissKey(clean));
  entries.push({ term: clean, dismissedAt: new Date().toISOString(), from });
  entries.sort((a, b) => a.term.localeCompare(b.term));
  return write(entries);
}

export function removeDismissed(term: string): DismissedEntry[] {
  const key = dismissKey(term);
  return write(readDismissed().filter((e) => dismissKey(e.term) !== key));
}
