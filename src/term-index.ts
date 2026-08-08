// Pure term-matching helpers shared by the Node renderer and the browser UI.
// No dependency on js-yaml or markdown-it, so it bundles small for the browser.

export interface GlossaryTerm {
  term: string;
  aliases: string[];
  definition: string;
  example?: string;
  link?: string;
}

export interface TermLike {
  term: string;
  aliases?: string[];
}

export interface TermIndex {
  /** Global regex matching any term or alias on word-ish boundaries. */
  regex: RegExp;
  /** Lowercased (or exact, if case sensitive) matched string -> index into the input array. */
  lookup: Map<string, number>;
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a matcher over all terms + aliases. Longer phrases are ordered first so a
 * multi-word term wins over a shorter one it contains.
 */
export function buildTermIndex(items: TermLike[], caseSensitive = false): TermIndex | null {
  const lookup = new Map<string, number>();
  const surfaces: string[] = [];
  items.forEach((t, i) => {
    const forms = [t.term, ...(t.aliases || [])];
    for (const form of forms) {
      if (!form) {
        continue;
      }
      const key = caseSensitive ? form : form.toLowerCase();
      if (!lookup.has(key)) {
        lookup.set(key, i);
        surfaces.push(form);
      }
    }
  });
  if (!surfaces.length) {
    return null;
  }
  surfaces.sort((a, b) => b.length - a.length);
  const alternation = surfaces.map(escapeRegExp).join("|");
  const pattern = `(?<![A-Za-z0-9_])(?:${alternation})(?![A-Za-z0-9_])`;
  const flags = caseSensitive ? "g" : "gi";
  return { regex: new RegExp(pattern, flags), lookup };
}
