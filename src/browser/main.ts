import { mountGlossary, UiTerm, UiOptions } from "./glossary-ui";
import { renderDiagrams } from "./mermaid-ui";

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
const RECENTS_MAX = 15;

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
  mountGlossary(container, data.terms || [], {
    ...(data.options || {}),
    onDismiss: hasServer ? (term) => void dismissTerm(term) : undefined,
  });
  // Diagrams draw asynchronously; the prose is already usable before they land.
  void renderDiagrams(container);
}

function showEmpty() {
  if (!container) {
    return;
  }
  container.innerHTML =
    `<div class="mhg-empty">Paste a path to a Markdown file above and press <b>Open</b>.` +
    `<br/><br/>Add a <code>&lt;!-- glossary … --&gt;</code> block to a doc and its terms become hoverable here.</div>`;
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

async function loadPath(
  rawPath: string,
  opts: { push?: boolean; silent?: boolean } = {}
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
  window.scrollTo(0, scrollY);

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
    const q = "?path=" + encodeURIComponent(resolved);
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
  window.addEventListener("popstate", (e) => {
    const st = e.state as { path?: string } | null;
    const p = st?.path || new URLSearchParams(location.search).get("path");
    if (p) {
      void loadPath(p, { push: false });
    }
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

  const fromUrl = new URLSearchParams(location.search).get("path");
  if (fromUrl) {
    await loadPath(fromUrl, { push: false });
    return;
  }

  // Optional server default (e.g. started with a file argument).
  try {
    const cfg = (await fetch("/api/config").then((r) => r.json())) as {
      defaultPath?: string;
    };
    if (cfg.defaultPath) {
      await loadPath(cfg.defaultPath, { push: false });
      return;
    }
  } catch {
    /* no config endpoint */
  }

  showEmpty();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
