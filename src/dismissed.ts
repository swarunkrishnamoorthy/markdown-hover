// Terms the reader has permanently hidden ("I already know what Nomad is").
//
// The list is global rather than per-document: knowing a word in one document
// means knowing it in the next one. Matching is on the canonical term, so
// hiding an entry hides every alias that pointed at it too.

export interface TermNameLike {
  term: string;
  aliases?: string[];
}

export function dismissKey(term: string): string {
  return term.trim().toLowerCase();
}

export function dismissedSet(dismissed: readonly string[] | undefined): Set<string> {
  const out = new Set<string>();
  for (const term of dismissed || []) {
    const key = dismissKey(term);
    if (key) {
      out.add(key);
    }
  }
  return out;
}

/** Split terms into the ones still shown and the ones the reader has hidden. */
export function partitionDismissed<T extends TermNameLike>(
  terms: readonly T[],
  dismissed: readonly string[] | undefined
): { kept: T[]; hidden: T[] } {
  const keys = dismissedSet(dismissed);
  if (!keys.size) {
    return { kept: [...terms], hidden: [] };
  }
  const kept: T[] = [];
  const hidden: T[] = [];
  for (const term of terms) {
    (keys.has(dismissKey(term.term)) ? hidden : kept).push(term);
  }
  return { kept, hidden };
}

/** Every surface an entry can match on, lowercased. */
export function surfacesOf(terms: readonly TermNameLike[]): Set<string> {
  const out = new Set<string>();
  for (const term of terms) {
    out.add(dismissKey(term.term));
    for (const alias of term.aliases || []) {
      const key = dismissKey(alias);
      if (key) {
        out.add(key);
      }
    }
  }
  out.delete("");
  return out;
}
