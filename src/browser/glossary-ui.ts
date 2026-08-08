import { buildTermIndex } from "../term-index";

export interface UiTerm {
  term: string;
  aliases?: string[];
  defHtml: string;
  exampleHtml?: string;
  link?: string;
}

export interface UiOptions {
  matchAllOccurrences?: boolean;
  caseSensitive?: boolean;
}

const SKIP_SELECTOR = "code, pre, a, .mhg-term";
const HIDE_DELAY = 200;

let currentTerms: UiTerm[] = [];
let caseSensitive = false;
let card: HTMLDivElement | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let pinned = false;
let listenersAttached = false;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function collectTextNodes(root: Node): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) {
        return NodeFilter.FILTER_REJECT;
      }
      const parent = (node as Text).parentElement;
      if (!parent || parent.closest(SKIP_SELECTOR)) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let n: Node | null;
  while ((n = walker.nextNode())) {
    nodes.push(n as Text);
  }
  return nodes;
}

function wrapTerms(container: HTMLElement, options: UiOptions) {
  const index = buildTermIndex(currentTerms, caseSensitive);
  if (!index) {
    return;
  }
  const matchAll = options.matchAllOccurrences !== false;
  const wrappedOnce = new Set<number>();
  const textNodes = collectTextNodes(container);

  for (const node of textNodes) {
    const text = node.nodeValue as string;
    index.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    let lastIndex = 0;
    let frag: DocumentFragment | null = null;

    while ((match = index.regex.exec(text)) !== null) {
      const surface = match[0];
      const key = caseSensitive ? surface : surface.toLowerCase();
      const idx = index.lookup.get(key);
      if (idx === undefined) {
        continue;
      }
      if (!matchAll && wrappedOnce.has(idx)) {
        continue;
      }
      if (!frag) {
        frag = document.createDocumentFragment();
      }
      wrappedOnce.add(idx);
      if (match.index > lastIndex) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      }
      const span = document.createElement("span");
      span.className = "mhg-term";
      span.setAttribute("data-mhg-idx", String(idx));
      span.setAttribute("tabindex", "0");
      span.textContent = surface;
      frag.appendChild(span);
      lastIndex = match.index + surface.length;
    }

    if (frag) {
      if (lastIndex < text.length) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex)));
      }
      node.parentNode?.replaceChild(frag, node);
    }
  }
}

function ensureCard(): HTMLDivElement {
  if (card && card.isConnected) {
    return card;
  }
  card = document.createElement("div");
  card.className = "mhg-card";
  card.setAttribute("role", "tooltip");
  card.addEventListener("mouseenter", cancelHide);
  card.addEventListener("mouseleave", scheduleHide);
  document.body.appendChild(card);
  return card;
}

function renderCard(term: UiTerm) {
  const c = ensureCard();
  let html = `<div class="mhg-card-title">${escapeHtml(term.term)}</div>`;
  html += `<div class="mhg-card-body">${term.defHtml || ""}</div>`;
  if (term.exampleHtml) {
    html +=
      `<div class="mhg-card-example"><div class="mhg-card-example-label">Example</div>` +
      term.exampleHtml +
      `</div>`;
  }
  if (term.link) {
    html += `<div class="mhg-card-link"><a href="${escapeHtml(term.link)}" target="_blank" rel="noopener">More &rarr;</a></div>`;
  }
  c.innerHTML = html;
}

function positionCard(anchor: HTMLElement) {
  const c = ensureCard();
  c.style.visibility = "hidden";
  c.style.display = "block";
  const rect = anchor.getBoundingClientRect();
  const cw = c.offsetWidth;
  const ch = c.offsetHeight;
  const margin = 8;
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;

  let left = rect.left;
  if (left + cw + margin > vw) {
    left = Math.max(margin, vw - cw - margin);
  }
  left = Math.max(margin, left);

  let top = rect.bottom + 6;
  if (top + ch + margin > vh && rect.top - ch - 6 > margin) {
    top = rect.top - ch - 6;
  }

  c.style.left = left + window.scrollX + "px";
  c.style.top = top + window.scrollY + "px";
  c.style.visibility = "visible";
}

function showCardFor(anchor: HTMLElement) {
  const idxAttr = anchor.getAttribute("data-mhg-idx");
  if (idxAttr === null) {
    return;
  }
  const term = currentTerms[parseInt(idxAttr, 10)];
  if (!term) {
    return;
  }
  cancelHide();
  renderCard(term);
  positionCard(anchor);
}

function hideCard() {
  if (pinned) {
    return;
  }
  if (card) {
    card.style.display = "none";
  }
}

function scheduleHide() {
  cancelHide();
  hideTimer = setTimeout(hideCard, HIDE_DELAY);
}

function cancelHide() {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

function termFrom(e: Event): HTMLElement | null {
  const target = e.target as HTMLElement | null;
  return target && target.closest ? (target.closest(".mhg-term") as HTMLElement | null) : null;
}

function attachGlobalListeners() {
  if (listenersAttached) {
    return;
  }
  listenersAttached = true;

  document.addEventListener(
    "mouseover",
    (e) => {
      const t = termFrom(e);
      if (t) {
        showCardFor(t);
      }
    },
    true
  );
  document.addEventListener(
    "mouseout",
    (e) => {
      if (termFrom(e)) {
        scheduleHide();
      }
    },
    true
  );
  document.addEventListener(
    "focusin",
    (e) => {
      const t = termFrom(e);
      if (t) {
        showCardFor(t);
      }
    },
    true
  );
  document.addEventListener(
    "focusout",
    (e) => {
      if (termFrom(e)) {
        scheduleHide();
      }
    },
    true
  );
  document.addEventListener(
    "click",
    (e) => {
      const t = termFrom(e);
      if (t) {
        pinned = false;
        showCardFor(t);
        pinned = true;
        e.stopPropagation();
        return;
      }
      if (card && card.contains(e.target as Node)) {
        return;
      }
      pinned = false;
      hideCard();
    },
    true
  );
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      pinned = false;
      hideCard();
    }
  });
}

/**
 * Underline glossary terms in `container` and wire up hover cards. Safe to call
 * again after replacing the container's content (e.g. on live reload).
 */
export function mountGlossary(container: HTMLElement, terms: UiTerm[], options: UiOptions = {}) {
  currentTerms = terms || [];
  caseSensitive = !!options.caseSensitive;
  pinned = false;
  hideCard();
  wrapTerms(container, options);
  ensureCard();
  attachGlobalListeners();
}
