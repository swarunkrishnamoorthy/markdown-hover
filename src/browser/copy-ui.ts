// Copy buttons on rendered code blocks.
//
// A fenced block becomes `<pre><code>…</code></pre>`. Left alone, the only way
// to copy it is to drag-select, which is miserable on a 60-line SQL dump. The
// button sits on a wrapper so it stays put when the block scrolls sideways.

const SKIP = ".mhg-mermaid, .mhg-error, .mhg-card, .mhg-code";
const COPIED_MS = 1400;

function sourceOf(pre: HTMLElement): string {
  const code = pre.querySelector("code");
  return (code ?? pre).textContent || "";
}

async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // file:// exports and older browsers have no Clipboard API.
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  ta.remove();
}

function flash(button: HTMLButtonElement, label: string) {
  const previous = button.textContent || "Copy";
  button.textContent = label;
  button.disabled = true;
  window.setTimeout(() => {
    button.textContent = previous;
    button.disabled = false;
  }, COPIED_MS);
}

function wrap(pre: HTMLElement) {
  const host = document.createElement("div");
  host.className = "mhg-code";
  pre.replaceWith(host);
  host.appendChild(pre);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "mhg-copy";
  button.textContent = "Copy";
  button.title = "Copy the code block";
  button.addEventListener("click", (e) => {
    e.stopPropagation();
    void writeClipboard(sourceOf(pre)).then(
      () => flash(button, "Copied"),
      () => flash(button, "Failed")
    );
  });
  host.appendChild(button);
}

/** Add a Copy button to every code block under `root`. Safe to call on every load. */
export function mountCopyButtons(root: ParentNode): number {
  let count = 0;
  for (const pre of Array.from(root.querySelectorAll("pre"))) {
    if (pre.closest(SKIP)) {
      continue;
    }
    wrap(pre);
    count++;
  }
  return count;
}
