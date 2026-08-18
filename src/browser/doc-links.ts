// Links between documents.
//
// A relative link in a Markdown file is written for a file tree, not for a web
// server: `[guide](01-guide.md)` next to a doc on disk. Left alone, the browser
// resolves it against the viewer's origin and asks for http://localhost/01-guide.md,
// which the server knows nothing about. Rewriting them against the directory of
// the document being viewed turns each one into a link back into the viewer.

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const MARKDOWN_RE = /\.(md|markdown|mdx)$/i;

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function dirOf(filePath: string): string {
  const at = filePath.lastIndexOf("/");
  return at <= 0 ? "/" : filePath.slice(0, at);
}

/** POSIX resolve. The viewer only ever handles absolute paths from the server. */
export function resolvePath(baseDir: string, target: string): string {
  const parts: string[] = [];
  const from = target.startsWith("/") ? target : `${baseDir}/${target}`;
  for (const segment of from.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  return `/${parts.join("/")}`;
}

/**
 * Only links the viewer can actually open: Markdown files, and paths with no
 * extension, which in a docs tree are directories. Anything else -- images,
 * PDFs, spreadsheets -- is left for the browser to deal with.
 */
export function isViewable(target: string): boolean {
  if (target.endsWith("/")) {
    return true;
  }
  const name = target.slice(target.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 || MARKDOWN_RE.test(name);
}

export function viewerUrl(absPath: string, hash = ""): string {
  return `/?path=${encodeURIComponent(absPath)}${hash}`;
}

/**
 * Point every viewable relative link at the viewer. The resolved path is kept in
 * `data-mhg-doc` so a click can be handled without re-parsing the URL, and the
 * href is rewritten too so copy-link and open-in-new-tab land in the right place.
 * Returns how many links were changed.
 */
export function rewriteDocLinks(root: ParentNode, docPath: string): number {
  const baseDir = dirOf(docPath);
  let changed = 0;
  for (const link of Array.from(root.querySelectorAll("a[href]"))) {
    const href = link.getAttribute("href") || "";
    // In-page anchors, absolute URLs and mailto: already work.
    if (!href || href.startsWith("#") || href.startsWith("//") || SCHEME_RE.test(href)) {
      continue;
    }
    const at = href.indexOf("#");
    const target = at < 0 ? href : href.slice(0, at);
    const hash = at < 0 ? "" : href.slice(at);
    if (!target || !isViewable(target)) {
      continue;
    }
    const resolved = resolvePath(baseDir, safeDecode(target));
    link.setAttribute("href", viewerUrl(resolved, hash));
    link.setAttribute("data-mhg-doc", resolved);
    changed++;
  }
  return changed;
}
