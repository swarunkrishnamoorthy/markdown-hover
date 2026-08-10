// Renders ```mermaid fences that `src/render.ts` left as placeholders.
//
// Mermaid is ~3.5MB, so it is loaded on demand: documents without diagrams never
// pay for it. The local copy is tried first (the dev server vendors it) and a CDN
// is the fallback, which is what standalone exports opened over file:// use.

const LOCAL_SRC = "/vendor/mermaid.min.js";
const CDN_SRC = "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js";

interface MermaidApi {
  initialize(config: Record<string, unknown>): void;
  render(id: string, text: string): Promise<{ svg: string }>;
}

declare global {
  interface Window {
    mermaid?: MermaidApi;
  }
}

let loader: Promise<MermaidApi> | null = null;
let renderSeq = 0;
let overlay: HTMLDivElement | null = null;

const FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif';

function prefersDark(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

function cssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/** [r, g, b] from `#rgb`, `#rrggbb`, or `rgb()/rgba()`. Null for `none` and keywords. */
function parseColor(input: string): [number, number, number] | null {
  const s = input.trim().toLowerCase();
  if (!s || s === "none" || s === "transparent") {
    return null;
  }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s);
  if (hex) {
    const h = hex[1];
    const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
    return [
      parseInt(full.slice(0, 2), 16),
      parseInt(full.slice(2, 4), 16),
      parseInt(full.slice(4, 6), 16),
    ];
  }
  const rgb = /^rgba?\(([^)]+)\)$/.exec(s);
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (parts.length >= 3 && parts.slice(0, 3).every((n) => !Number.isNaN(n))) {
      return [parts[0], parts[1], parts[2]];
    }
  }
  return null;
}

function toHex([r, g, b]: [number, number, number]): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return "#" + [r, g, b].map((n) => clamp(n).toString(16).padStart(2, "0")).join("");
}

/** Blend two colours. Mermaid does its own colour maths, so it needs a literal. */
function mix(a: string, b: string, t: number): string {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) {
    return a;
  }
  return toHex([
    ca[0] + (cb[0] - ca[0]) * t,
    ca[1] + (cb[1] - ca[1]) * t,
    ca[2] + (cb[2] - ca[2]) * t,
  ]);
}

/** WCAG relative luminance, used to pick readable ink for a given fill. */
function luminance([r, g, b]: [number, number, number]): number {
  const channel = (v: number) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function applyTheme(api: MermaidApi) {
  const dark = prefersDark();
  const bg = cssVar("--bg", dark ? "#0d1117" : "#ffffff");
  const fg = cssVar("--fg", dark ? "#e6edf3" : "#1f2328");
  const muted = cssVar("--muted", dark ? "#9198a1" : "#656d76");

  // Mermaid's stock themes clash with the viewer's palette, so drive the `base`
  // theme from the same CSS variables the rest of the page uses. Everything is
  // mixed from the page's own background and foreground, which keeps a readable
  // depth order in both schemes: page < subgraph panel < node.
  const panel = mix(bg, fg, 0.045);
  const node = mix(bg, fg, 0.13);
  const raised = mix(bg, fg, 0.18);
  const outline = mix(bg, fg, 0.3);

  api.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    fontFamily: FONT,
    themeVariables: {
      darkMode: dark,
      background: bg,
      fontFamily: FONT,
      fontSize: "14px",
      primaryColor: node,
      primaryTextColor: fg,
      primaryBorderColor: outline,
      secondaryColor: raised,
      tertiaryColor: panel,
      mainBkg: node,
      nodeBorder: outline,
      nodeTextColor: fg,
      textColor: fg,
      titleColor: fg,
      lineColor: muted,
      edgeLabelBackground: bg,
      clusterBkg: panel,
      clusterBorder: outline,
      actorBkg: node,
      actorBorder: outline,
      actorTextColor: fg,
      actorLineColor: muted,
      signalColor: fg,
      signalTextColor: fg,
      labelBoxBkgColor: node,
      labelBoxBorderColor: outline,
      labelTextColor: fg,
      loopTextColor: fg,
      noteBkgColor: raised,
      noteTextColor: fg,
      noteBorderColor: outline,
      activationBkgColor: raised,
      activationBorderColor: outline,
    },
  });
}

/**
 * Give every label ink that contrasts with the shape behind it.
 *
 * Documents routinely carry `style X fill:#ffe0e0` chosen against GitHub's white
 * page. In dark mode the theme's light label text lands on those pale fills and
 * becomes unreadable, so pick the ink from the fill's own luminance instead of
 * trusting the theme.
 */
function fixLabelContrast(host: HTMLElement) {
  const groups = host.querySelectorAll<SVGGElement>("g.node, g.cluster, g.actor, .actor");
  for (const group of groups) {
    const shape = group.querySelector<SVGGraphicsElement>("rect, polygon, circle, ellipse, path");
    if (!shape) {
      continue;
    }
    const fill = parseColor(getComputedStyle(shape).fill || "");
    if (!fill) {
      continue;
    }
    // WCAG's black-vs-white crossover point.
    const ink = luminance(fill) > 0.179 ? "#0f141a" : "#eaf0f7";
    const labels = group.querySelectorAll<SVGElement | HTMLElement>(
      "text, tspan, .nodeLabel, .label span, foreignObject span, foreignObject p"
    );
    for (const label of labels) {
      label.style.fill = ink;
      label.style.color = ink;
    }
  }
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`could not load ${src}`));
    document.head.appendChild(el);
  });
}

async function loadMermaid(): Promise<MermaidApi> {
  if (loader) {
    return loader;
  }
  loader = (async () => {
    if (!window.mermaid) {
      try {
        await loadScript(LOCAL_SRC);
      } catch {
        await loadScript(CDN_SRC);
      }
    }
    const api = window.mermaid;
    if (!api) {
      throw new Error("mermaid loaded but did not register itself");
    }
    applyTheme(api);
    return api;
  })();
  // A failed load must not poison later attempts (e.g. after a live reload).
  loader.catch(() => {
    loader = null;
  });
  return loader;
}

function sourceOf(host: HTMLElement): string {
  const pre = host.querySelector(".mhg-mermaid-src");
  return pre ? pre.textContent || "" : "";
}

function showFailure(host: HTMLElement, message: string, source: string) {
  host.dataset.mhgState = "error";
  host.textContent = "";

  const note = document.createElement("div");
  note.className = "mhg-mermaid-error";
  note.textContent = `Diagram failed to render: ${message}`;

  const pre = document.createElement("pre");
  pre.className = "mhg-mermaid-src";
  pre.textContent = source;

  host.appendChild(note);
  host.appendChild(pre);
}

function addExpandButton(host: HTMLElement) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "mhg-mermaid-expand";
  button.textContent = "Expand";
  button.title = "Open the diagram full screen (zoom and pan)";
  button.addEventListener("click", (e) => {
    e.stopPropagation();
    const svg = host.querySelector("svg");
    if (svg) {
      openOverlay(svg);
    }
  });
  host.appendChild(button);
}

async function renderOne(host: HTMLElement, api: MermaidApi) {
  const source = sourceOf(host);
  if (!source.trim()) {
    host.dataset.mhgState = "empty";
    return;
  }
  try {
    const { svg } = await api.render(`mhg-diagram-${++renderSeq}`, source);
    host.innerHTML = svg;
    host.dataset.mhgState = "done";
    host.dataset.mhgSource = source;
    fixLabelContrast(host);
    addExpandButton(host);
  } catch (err) {
    // Mermaid appends a scratch node when parsing fails; clear it so the page
    // does not accumulate stray half-rendered diagrams.
    document.getElementById(`dmhg-diagram-${renderSeq}`)?.remove();
    showFailure(host, err instanceof Error ? err.message : String(err), source);
  }
}

/** Render every pending diagram inside `container`. Safe to call on every load. */
export async function renderDiagrams(container: HTMLElement): Promise<void> {
  const hosts = Array.from(
    container.querySelectorAll<HTMLElement>('.mhg-mermaid[data-mhg-state="pending"]')
  );
  if (!hosts.length) {
    return;
  }

  let api: MermaidApi;
  try {
    api = await loadMermaid();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    for (const host of hosts) {
      showFailure(host, message, sourceOf(host));
    }
    return;
  }

  for (const host of hosts) {
    await renderOne(host, api);
  }
}

/** Redraw already-rendered diagrams, e.g. when the OS colour scheme flips. */
export function redrawDiagrams(container: HTMLElement) {
  const hosts = Array.from(
    container.querySelectorAll<HTMLElement>(".mhg-mermaid[data-mhg-source]")
  );
  if (!hosts.length || !window.mermaid) {
    return;
  }
  for (const host of hosts) {
    const source = host.dataset.mhgSource || "";
    host.textContent = "";
    const pre = document.createElement("pre");
    pre.className = "mhg-mermaid-src";
    pre.textContent = source;
    host.appendChild(pre);
    host.dataset.mhgState = "pending";
    delete host.dataset.mhgSource;
  }
  applyTheme(window.mermaid);
  void renderDiagrams(container);
}

// ---- Full-screen zoom / pan viewer ----

function openOverlay(svg: SVGElement) {
  closeOverlay();

  overlay = document.createElement("div");
  overlay.className = "mhg-zoom";

  const stage = document.createElement("div");
  stage.className = "mhg-zoom-stage";

  // Size the clone explicitly. Mermaid caps its SVG with an inline `max-width`,
  // and an SVG with no dimensions inside an auto-sized flex item resolves to
  // zero height — an overlay that opens onto nothing.
  const bounds = svg.getBoundingClientRect();
  const viewBox = (svg.getAttribute("viewBox") || "").split(/[\s,]+/).map(Number);
  const natural = viewBox.length === 4 && viewBox[2] > 0 ? { w: viewBox[2], h: viewBox[3] } : null;
  const width = bounds.width || natural?.w || 800;
  const height = bounds.height || natural?.h || 600;

  const clone = svg.cloneNode(true) as SVGElement;
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.style.width = `${width}px`;
  clone.style.height = `${height}px`;
  clone.style.maxWidth = "none";
  clone.style.maxHeight = "none";
  stage.appendChild(clone);

  // Open at whatever zoom shows the whole diagram, but never shrink a small one.
  const margin = 72;
  const fit = Math.min(
    (window.innerWidth - margin) / width,
    (window.innerHeight - margin) / height
  );
  const initialScale = Math.min(1, fit) || 1;
  let scale = initialScale;
  let x = 0;
  let y = 0;
  const apply = () => {
    stage.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  };
  const zoomBy = (factor: number) => {
    scale = Math.min(12, Math.max(0.2, scale * factor));
    apply();
  };
  const reset = () => {
    scale = initialScale;
    x = 0;
    y = 0;
    apply();
  };

  const bar = document.createElement("div");
  bar.className = "mhg-zoom-bar";
  const buttons: [string, string, () => void][] = [
    ["−", "Zoom out", () => zoomBy(1 / 1.25)],
    ["+", "Zoom in", () => zoomBy(1.25)],
    ["Reset", "Reset zoom", reset],
    ["Close", "Close (Esc)", closeOverlay],
  ];
  for (const [label, title, action] of buttons) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.title = title;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      action();
    });
    bar.appendChild(b);
  }

  overlay.appendChild(bar);
  overlay.appendChild(stage);

  overlay.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1);
    },
    { passive: false }
  );

  let dragging = false;
  let dragged = false;
  let fromBackdrop = false;
  let lastX = 0;
  let lastY = 0;
  overlay.addEventListener("pointerdown", (e) => {
    dragging = true;
    dragged = false;
    // Pointer capture retargets later events to the overlay, so whether this
    // gesture started on the backdrop has to be remembered now.
    fromBackdrop = e.target === overlay;
    lastX = e.clientX;
    lastY = e.clientY;
    overlay?.setPointerCapture(e.pointerId);
  });
  overlay.addEventListener("pointermove", (e) => {
    if (!dragging) {
      return;
    }
    dragged = true;
    x += e.clientX - lastX;
    y += e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    apply();
  });
  const endDrag = () => {
    // A click on the backdrop closes; a drag, or a click on the diagram, must not.
    if (dragging && !dragged && fromBackdrop) {
      closeOverlay();
    }
    dragging = false;
  };
  overlay.addEventListener("pointerup", endDrag);
  overlay.addEventListener("pointercancel", endDrag);

  document.body.appendChild(overlay);
  document.body.classList.add("mhg-zoom-open");
  apply();
}

function closeOverlay() {
  if (overlay) {
    overlay.remove();
    overlay = null;
  }
  document.body.classList.remove("mhg-zoom-open");
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && overlay) {
    closeOverlay();
  }
});

if (typeof window.matchMedia === "function") {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => {
    const content = document.getElementById("mhg-content");
    if (content) {
      redrawDiagrams(content);
    }
  };
  if (typeof media.addEventListener === "function") {
    media.addEventListener("change", onChange);
  }
}
