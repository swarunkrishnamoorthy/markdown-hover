import { mountGlossary, UiTerm, UiOptions } from "./glossary-ui";

interface DocData {
  contentHtml: string;
  terms: UiTerm[];
  options?: UiOptions;
  filename?: string;
  path?: string;
  error?: string;
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

function setStatus(text: string, isError = false) {
  if (!statusEl) {
    return;
  }
  statusEl.textContent = text;
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

function renderDoc(data: DocData) {
  if (!container) {
    return;
  }
  const errorHtml = data.error
    ? `<div class="mhg-error">${data.error}</div>`
    : "";
  container.innerHTML = errorHtml + (data.contentHtml || "");
  mountGlossary(container, data.terms || [], data.options || {});
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
    liveSource.onmessage = () => {
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
      container.innerHTML = `<div class="mhg-error">Could not reach the server: ${String(
        err
      )}</div>`;
    }
    return;
  }

  const resolved = data.path || p;
  currentPath = resolved;
  if (pathInput) {
    pathInput.value = resolved;
  }

  if (data.error && !data.contentHtml) {
    setStatus(data.error, true);
    if (container) {
      container.innerHTML = `<div class="mhg-error">${data.error}</div>`;
    }
    return;
  }

  renderDoc(data);
  window.scrollTo(0, scrollY);

  const count = (data.terms || []).length;
  setStatus(`${data.filename || resolved} · ${count} term${count === 1 ? "" : "s"}`);
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
}

async function boot() {
  container = document.getElementById("mhg-content");
  pathInput = document.getElementById("mhg-path") as HTMLInputElement | null;
  statusEl = document.getElementById("mhg-status");
  recentsEl = document.getElementById("mhg-recents") as HTMLDataListElement | null;

  // Standalone export: data is inlined, hide the bar and just render.
  if (window.__MHG_DATA__) {
    const topbar = document.querySelector(".mhg-topbar");
    if (topbar instanceof HTMLElement) {
      topbar.style.display = "none";
    }
    renderDoc(window.__MHG_DATA__);
    return;
  }

  renderRecents();
  wireBar();

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
