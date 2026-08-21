import { mountGlossary, UiTerm, UiOptions } from "./glossary-ui";
import { renderDiagrams } from "./mermaid-ui";
import { rewriteDocLinks } from "./doc-links";
import { mountCopyButtons } from "./copy-ui";

interface DocData {
  contentHtml: string;
  terms: UiTerm[];
  termSource?: "block" | "derived" | "none";
  diagrams?: number;
  hidden?: number;
  options?: UiOptions;
  filename?: string;
  path?: string;
  error?: string;
}

interface DismissedEntry {
  term: string;
  dismissedAt?: string;
  from?: string;
}

declare global {
  interface Window {
    __MHG_DATA__?: DocData;
  }
}

const RECENTS_KEY = "mhg-recents";
const RECENTS_MAX = 25;

/** Learned from the server so absolute paths can be shown as ~/…. */
let homeDir = "";
let container: HTMLElement | null = null;
let pathInput: HTMLInputElement | null = null;
let statusEl: HTMLElement | null = null;
let recentsEl: HTMLDataListElement | null = null;
let liveSource: EventSource | null = null;
let currentPath: string | null = null;
let hiddenBtn: HTMLButtonElement | null = null;
let hiddenPanel: HTMLElement | null = null;
/** Standalone exports have no server, so hiding cannot be persisted there. */
let hasServer = true;

function setStatus(text: string, isError = false) {
  if (!statusEl) {
    return;
  }
  statusEl.textContent = text;
  // The bar is narrow and ellipsises; keep the full text reachable on hover.
  statusEl.title = text;
  statusEl.classList.toggle("mhg-status-error", isError);
}

function loadRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function saveRecent(p: string) {
  try {
    const list = loadRecents().filter((x) => x !== p);
    list.unshift(p);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, RECENTS_MAX)));
    renderRecents();
  } catch {
    /* ignore storage errors */
  }
}

function renderRecents() {
  if (!recentsEl) {
    return;
  }
  recentsEl.innerHTML = loadRecents()
    .map((p) => `<option value="${p.replace(/"/g, "&quot;")}"></option>`)
    .join("");
}

async function fetchDismissed(): Promise<DismissedEntry[]> {
  try {
    const data = (await fetch("/api/dismissed").then((r) => r.json())) as {
      terms?: DismissedEntry[];
    };
    return data.terms || [];
  } catch {
    return [];
  }
}

function refreshHiddenButton(entries: DismissedEntry[]) {
  if (!hiddenBtn) {
    return;
  }
  hiddenBtn.hidden = !hasServer;
  hiddenBtn.textContent = `Hidden ${entries.length}`;
  hiddenBtn.disabled = entries.length === 0;
  hiddenBtn.title = entries.length
    ? "Review the terms you have hidden"
    : "Terms you hide from a card are listed here";
}

function reloadCurrent() {
  if (currentPath) {
    void loadPath(currentPath, { push: false, silent: true });
  }
}

async function dismissTerm(term: string) {
  try {
    const res = await fetch("/api/dismissed", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ term, from: currentPath || undefined }),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
  } catch (err) {
    setStatus(`Could not hide "${term}": ${String(err)}`, true);
    return;
  }
  closeHiddenPanel();
  void fetchDismissed().then(refreshHiddenButton);
  reloadCurrent();
}

async function restoreTerm(term: string) {
  try {
    await fetch(`/api/dismissed?term=${encodeURIComponent(term)}`, { method: "DELETE" });
  } catch (err) {
    setStatus(`Could not restore "${term}": ${String(err)}`, true);
    return;
  }
  await openHiddenPanel();
  reloadCurrent();
}

function closeHiddenPanel() {
  if (hiddenPanel) {
    hiddenPanel.remove();
    hiddenPanel = null;
  }
}

async function openHiddenPanel() {
  const entries = await fetchDismissed();
  refreshHiddenButton(entries);
  closeHiddenPanel();
  if (!entries.length) {
    return;
  }

  const panel = document.createElement("div");
  panel.className = "mhg-hidden-panel";

  const heading = document.createElement("div");
  heading.className = "mhg-hidden-heading";
  heading.textContent = `${entries.length} hidden term${entries.length === 1 ? "" : "s"}`;
  panel.appendChild(heading);

  const list = document.createElement("ul");
  list.className = "mhg-hidden-list";
  for (const entry of entries) {
    const row = document.createElement("li");

    const name = document.createElement("span");
    name.className = "mhg-hidden-term";
    name.textContent = entry.term;
    if (entry.from) {
      name.title = `Hidden from ${entry.from}`;
    }

    const restore = document.createElement("button");
    restore.type = "button";
    restore.className = "mhg-hidden-restore";
    restore.textContent = "Restore";
    restore.addEventListener("click", (e) => {
      e.stopPropagation();
      void restoreTerm(entry.term);
    });

    row.appendChild(name);
    row.appendChild(restore);
    list.appendChild(row);
  }
  panel.appendChild(list);

  panel.addEventListener("click", (e) => e.stopPropagation());
  document.body.appendChild(panel);
  hiddenPanel = panel;

  if (hiddenBtn) {
    const rect = hiddenBtn.getBoundingClientRect();
    panel.style.top = `${rect.bottom + window.scrollY + 6}px`;
    const right = Math.max(8, document.documentElement.clientWidth - rect.right);
    panel.style.right = `${right}px`;
  }
}

// Parse errors carry an indented excerpt with a caret, so they need <pre> to
// stay legible, and textContent so document text can never inject markup.
function errorBlock(message: string): HTMLElement {
  const box = document.createElement("pre");
  box.className = "mhg-error";
  box.textContent = message;
  return box;
}

function renderDoc(data: DocData) {
  if (!container) {
    return;
  }
  container.innerHTML = data.contentHtml || "";
  if (data.error) {
    container.prepend(errorBlock(data.error));
  }
  // A standalone export is a single file with no viewer behind it, so its links
  // stay exactly as the author wrote them.
  if (hasServer && data.path) {
    rewriteDocLinks(container, data.path);
  }
  mountGlossary(container, data.terms || [], {
    ...(data.options || {}),
    onDismiss: hasServer ? (term) => void dismissTerm(term) : undefined,
  });
  mountCopyButtons(container);
  // Diagrams draw asynchronously; the prose is already usable before they land.
  void renderDiagrams(container);
}

function baseName(p: string): string {
  const trimmed = p.replace(/\/+$/, "");
  const at = trimmed.lastIndexOf("/");
  return at < 0 ? trimmed : trimmed.slice(at + 1);
}

function dirName(p: string): string {
  const trimmed = p.replace(/\/+$/, "");
  const at = trimmed.lastIndexOf("/");
  return at <= 0 ? "/" : trimmed.slice(0, at);
}

/** Collapse the home directory to ~ so the listing reads like a shell path. */
function tildify(p: string): string {
  if (homeDir && (p === homeDir || p.startsWith(homeDir + "/"))) {
    return "~" + p.slice(homeDir.length);
  }
  return p;
}

function timeAgo(ms: number): string {
  const secs = Math.max(0, (Date.now() - ms) / 1000);
  if (secs < 45) return "just now";
  const mins = secs / 60;
  if (mins < 60) return `${Math.round(mins)}m ago`;
  const hours = mins / 60;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  const days = hours / 24;
  if (days < 30) return `${Math.round(days)}d ago`;
  return new Date(ms).toLocaleDateString();
}

// Home links carry data-mhg-doc so the container's delegated handler opens them
// in place, exactly like a resolved relative link inside a document.
function fileItem(absPath: string, when?: number): HTMLLIElement {
  const li = document.createElement("li");
  const a = document.createElement("a");
  a.className = "mhg-home-link";
  a.href = `/?path=${encodeURIComponent(absPath)}`;
  a.dataset.mhgDoc = absPath;

  const name = document.createElement("span");
  name.className = "mhg-home-name";
  name.textContent = baseName(absPath);
  a.appendChild(name);

  const meta = document.createElement("span");
  meta.className = "mhg-home-meta";
  meta.textContent = tildify(dirName(absPath));
  a.appendChild(meta);

  if (typeof when === "number") {
    const time = document.createElement("time");
    time.className = "mhg-home-time";
    time.dateTime = new Date(when).toISOString();
    time.textContent = timeAgo(when);
    a.appendChild(time);
  }

  li.appendChild(a);
  return li;
}

function homeSection(title: string): { section: HTMLElement; list: HTMLUListElement } {
  const section = document.createElement("section");
  section.className = "mhg-home-section";
  const heading = document.createElement("h2");
  heading.className = "mhg-home-heading";
  heading.textContent = title;
  const list = document.createElement("ul");
  list.className = "mhg-home-list";
  section.appendChild(heading);
  section.appendChild(list);
  return { section, list };
}

function emptyNote(list: HTMLElement, text: string) {
  list.textContent = "";
  const li = document.createElement("li");
  li.className = "mhg-home-empty";
  li.textContent = text;
  list.appendChild(li);
}

async function showHome() {
  if (!container) {
    return;
  }
  setStatus("");
  document.title = "Glossary Viewer";
  container.textContent = "";

  const home = document.createElement("div");
  home.className = "mhg-home";

  const viewed = homeSection("Recently viewed");
  const recents = loadRecents().slice(0, RECENTS_MAX);
  if (recents.length) {
    for (const p of recents) {
      viewed.list.appendChild(fileItem(p));
    }
  } else {
    emptyNote(viewed.list, "Open a Markdown file and it will show up here.");
  }
  home.appendChild(viewed.section);

  const modified = homeSection("Recently modified in agent-artifacts");
  emptyNote(modified.list, "Loading…");
  home.appendChild(modified.section);

  container.appendChild(home);

  if (!hasServer) {
    emptyNote(modified.list, "Only available in the live viewer.");
    return;
  }
  try {
    const data = (await fetch("/api/recent-artifacts").then((r) => r.json())) as {
      home?: string;
      files?: { path: string; mtimeMs: number }[];
    };
    if (data.home) {
      homeDir = data.home;
    }
    const files = data.files || [];
    if (files.length) {
      modified.list.textContent = "";
      for (const f of files) {
        modified.list.appendChild(fileItem(f.path, f.mtimeMs));
      }
    } else {
      emptyNote(modified.list, "No Markdown files found in ~/agent-artifacts.");
    }
  } catch {
    emptyNote(modified.list, "Could not reach the server.");
  }
}

function goHome(push = true) {
  currentPath = null;
  if (pathInput) {
    pathInput.value = "";
  }
  if (push) {
    history.pushState({}, "", "/");
  }
  // Keep the dev bundle's hard-reload working on the home page too.
  setupLiveReload("");
  void showHome();
}

function setupLiveReload(p: string) {
  if (liveSource) {
    liveSource.close();
    liveSource = null;
  }
  if (typeof EventSource === "undefined") {
    return;
  }
  try {
    liveSource = new EventSource("/api/events?path=" + encodeURIComponent(p));
    liveSource.onmessage = (e) => {
      // A rebuilt browser bundle can only take effect on a full page load.
      if (e.data === "hard-reload") {
        location.reload();
        return;
      }
      if (currentPath) {
        void loadPath(currentPath, { push: false, silent: true });
      }
    };
  } catch {
    /* SSE unavailable */
  }
}

function scrollToAnchor(hash: string): boolean {
  const raw = hash.replace(/^#/, "");
  if (!raw) {
    return false;
  }
  let id = raw;
  try {
    id = decodeURIComponent(raw);
  } catch {
    /* a malformed escape is still a usable literal id */
  }
  const target = document.getElementById(id) || document.getElementById(raw);
  if (!target) {
    return false;
  }
  target.scrollIntoView();
  return true;
}

async function loadPath(
  rawPath: string,
  opts: { push?: boolean; silent?: boolean; hash?: string } = {}
) {
  const p = rawPath.trim();
  if (!p) {
    return;
  }
  if (!opts.silent) {
    setStatus("Loading…");
  }
  const scrollY = opts.silent ? window.scrollY : 0;

  let data: DocData;
  try {
    data = (await fetch("/api/render?path=" + encodeURIComponent(p)).then((r) =>
      r.json()
    )) as DocData;
  } catch (err) {
    setStatus("Request failed", true);
    if (container) {
      container.textContent = "";
      container.append(errorBlock(`Could not reach the server: ${String(err)}`));
    }
    return;
  }

  const resolved = data.path || p;
  currentPath = resolved;
  if (pathInput) {
    pathInput.value = resolved;
  }

  if (data.error && !data.contentHtml) {
    setStatus(data.error.split("\n")[0], true);
    if (container) {
      container.textContent = "";
      container.append(errorBlock(data.error));
    }
    return;
  }

  renderDoc(data);
  // A live-reload keeps your place; anything else honours the anchor if there is
  // one, so a link into a section lands on that section.
  const anchor = opts.hash || (opts.silent ? "" : location.hash);
  if (!anchor || !scrollToAnchor(anchor)) {
    window.scrollTo(0, scrollY);
  }

  const count = (data.terms || []).length;
  const parts = [data.filename || resolved, `${count} term${count === 1 ? "" : "s"}`];
  if (data.error) {
    parts.push("glossary block failed to parse");
  } else if (data.termSource === "derived") {
    parts.push("from <abbr>/table (no glossary block)");
  } else if (!count) {
    parts.push("no glossary block found");
  }
  const diagrams = data.diagrams || 0;
  if (diagrams) {
    parts.push(`${diagrams} diagram${diagrams === 1 ? "" : "s"}`);
  }
  if (data.hidden) {
    parts.push(`${data.hidden} hidden`);
  }
  setStatus(parts.join(" · "));
  saveRecent(resolved);

  if (opts.push !== false) {
    const q = "?path=" + encodeURIComponent(resolved) + (opts.hash || "");
    history.pushState({ path: resolved }, "", q);
  }
  setupLiveReload(resolved);
}

function wireBar() {
  const form = document.getElementById("mhg-path-form") as HTMLFormElement | null;
  if (form && pathInput) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      void loadPath(pathInput!.value, { push: true });
    });
  }
  const brand = document.getElementById("mhg-brand");
  brand?.addEventListener("click", (e) => {
    const me = e as MouseEvent;
    // Let modified clicks open the home page in a new tab like any other link.
    if (me.button !== 0 || me.metaKey || me.ctrlKey || me.shiftKey || me.altKey) {
      return;
    }
    e.preventDefault();
    goHome(true);
  });

  window.addEventListener("popstate", (e) => {
    const st = e.state as { path?: string } | null;
    const p = st?.path || new URLSearchParams(location.search).get("path");
    if (p) {
      void loadPath(p, { push: false });
    } else {
      goHome(false);
    }
  });

  // Following a link to a sibling document swaps the content in place. The href
  // is already correct, so modified clicks fall through to the browser and open
  // a real tab or window.
  container?.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }
    const link = (e.target as Element | null)?.closest?.("a[data-mhg-doc]");
    if (!(link instanceof HTMLAnchorElement) || (link.target && link.target !== "_self")) {
      return;
    }
    e.preventDefault();
    void loadPath(link.dataset.mhgDoc || "", { push: true, hash: link.hash });
  });

  if (hiddenBtn) {
    hiddenBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (hiddenPanel) {
        closeHiddenPanel();
      } else {
        void openHiddenPanel();
      }
    });
  }
  document.addEventListener("click", () => closeHiddenPanel());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeHiddenPanel();
      return;
    }
    // Cmd+/ (Ctrl+/ off the Mac) jumps to the path bar from anywhere on the
    // page. The path is selected so the next keystroke replaces it.
    if (e.key === "/" && (e.metaKey || e.ctrlKey) && !e.altKey && pathInput) {
      e.preventDefault();
      pathInput.focus();
      pathInput.select();
    }
  });
}

async function boot() {
  container = document.getElementById("mhg-content");
  pathInput = document.getElementById("mhg-path") as HTMLInputElement | null;
  statusEl = document.getElementById("mhg-status");
  recentsEl = document.getElementById("mhg-recents") as HTMLDataListElement | null;
  hiddenBtn = document.getElementById("mhg-hidden") as HTMLButtonElement | null;

  // Standalone export: data is inlined, hide the bar and just render. There is
  // no server, so terms can only be hidden before the export is generated.
  if (window.__MHG_DATA__) {
    hasServer = false;
    const topbar = document.querySelector(".mhg-topbar");
    if (topbar instanceof HTMLElement) {
      topbar.style.display = "none";
    }
    renderDoc(window.__MHG_DATA__);
    return;
  }

  renderRecents();
  wireBar();
  void fetchDismissed().then(refreshHiddenButton);

  // One config fetch: it carries the home dir (for ~ display) and any default file.
  let cfg: { defaultPath?: string; home?: string } | undefined;
  try {
    cfg = (await fetch("/api/config").then((r) => r.json())) as {
      defaultPath?: string;
      home?: string;
    };
  } catch {
    /* no config endpoint */
  }
  if (cfg?.home) {
    homeDir = cfg.home;
  }

  const fromUrl = new URLSearchParams(location.search).get("path");
  if (fromUrl) {
    await loadPath(fromUrl, { push: false });
    return;
  }
  if (cfg?.defaultPath) {
    await loadPath(cfg.defaultPath, { push: false });
    return;
  }

  setupLiveReload("");
  void showHome();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
