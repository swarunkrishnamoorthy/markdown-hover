// Persistent local Markdown-glossary viewer.
// Start it once, then paste file paths into the box at the top of the page.
//   node scripts/serve.mjs [defaultFile.md] [--port 4321] [--no-open]
import http from "node:http";
import os from "node:os";
import { readFile, readdir, stat } from "node:fs/promises";
import { watch } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { exec } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const webDir = path.join(root, "web");
const corePath = path.join(root, "dist", "core.node.mjs");
const appJsPath = path.join(webDir, "dist", "app.js");

// The renderer is re-imported whenever the bundle changes on disk. A static
// import would pin the build that existed when the server started, so a rebuild
// would silently keep serving the old renderer until someone restarted.
let corePromise = null;
let coreStamp = -1;

async function mtimeOf(p) {
  try {
    return (await stat(p)).mtimeMs;
  } catch {
    return -1;
  }
}

async function loadCore() {
  const stamp = await mtimeOf(corePath);
  if (!corePromise || stamp !== coreStamp) {
    coreStamp = stamp;
    corePromise = import(`${pathToFileURL(corePath).href}?v=${stamp}`);
  }
  return corePromise;
}

function parseArgs(argv) {
  const args = { port: Number(process.env.PORT) || 4321, open: true, file: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port") {
      args.port = Number(argv[++i]);
    } else if (a === "--no-open") {
      args.open = false;
    } else if (!a.startsWith("-") && !args.file) {
      args.file = a;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const defaultPath = args.file ? expandPath(args.file) : null;

function expandPath(p) {
  if (!p) {
    return p;
  }
  let s = p.trim();
  // Strip wrapping quotes people paste from a shell.
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  if (s === "~") {
    return os.homedir();
  }
  if (s.startsWith("~/")) {
    return path.join(os.homedir(), s.slice(2));
  }
  return path.resolve(s);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

async function serveStatic(res, rel) {
  const filePath = path.join(webDir, rel);
  if (!filePath.startsWith(webDir)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      "content-type": MIME[path.extname(filePath)] || "application/octet-stream",
    });
    res.end(body);
  } catch {
    res.writeHead(404).end("Not found");
  }
}

function sendJson(res, status, obj) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

async function renderPath(rawPath) {
  const resolved = expandPath(rawPath);
  let info;
  try {
    info = await stat(resolved);
  } catch {
    return { error: `File not found: ${resolved}`, contentHtml: "", terms: [], path: resolved };
  }
  if (info.isDirectory()) {
    return { error: `Path is a directory: ${resolved}`, contentHtml: "", terms: [], path: resolved };
  }
  const src = await readFile(resolved, "utf8");
  const { renderDocument } = await loadCore();
  const rendered = renderDocument(src);
  return {
    ...rendered,
    path: resolved,
    filename: path.basename(resolved),
    options: { matchAllOccurrences: true, caseSensitive: false },
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const pathname = url.pathname;

  if (pathname === "/" || pathname === "/index.html") {
    return serveStatic(res, "index.html");
  }
  if (pathname === "/styles.css") {
    return serveStatic(res, "styles.css");
  }
  if (pathname.startsWith("/dist/") || pathname.startsWith("/vendor/")) {
    return serveStatic(res, pathname.replace(/^\//, ""));
  }

  if (pathname === "/api/config") {
    return sendJson(res, 200, { defaultPath, cwd: process.cwd() });
  }

  if (pathname === "/api/render") {
    const p = url.searchParams.get("path");
    if (!p) {
      return sendJson(res, 400, { error: "Missing ?path", contentHtml: "", terms: [] });
    }
    try {
      return sendJson(res, 200, await renderPath(p));
    } catch (err) {
      return sendJson(res, 500, { error: String(err), contentHtml: "", terms: [] });
    }
  }

  if (pathname === "/api/events") {
    const p = url.searchParams.get("path");
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write("retry: 1000\n\n");

    const watchers = [];
    let debounce = null;
    const notify = (kind) => {
      if (debounce) {
        clearTimeout(debounce);
      }
      debounce = setTimeout(() => res.write(`data: ${kind}\n\n`), 120);
    };
    const addWatch = (target, kind) => {
      try {
        watchers.push(watch(target, () => notify(kind)));
      } catch {
        /* watch may fail on some filesystems; static view still works */
      }
    };

    if (p) {
      addWatch(expandPath(p), "reload");
    }
    // A rebuilt renderer only needs the content re-fetched; a rebuilt browser
    // bundle needs the whole page reloaded to pick up the new script.
    addWatch(corePath, "reload");
    addWatch(appJsPath, "hard-reload");

    req.on("close", () => {
      if (debounce) {
        clearTimeout(debounce);
      }
      for (const w of watchers) {
        w.close();
      }
    });
    return;
  }

  res.writeHead(404).end("Not found");
});

/** Newest mtime under a directory, so we can tell if a build is behind its sources. */
async function newestMtime(dir) {
  let newest = 0;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return newest;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? await newestMtime(full) : await mtimeOf(full));
  }
  return newest;
}

async function warnIfStale() {
  const [srcTime, coreTime, appTime] = await Promise.all([
    newestMtime(path.join(root, "src")),
    mtimeOf(corePath),
    mtimeOf(appJsPath),
  ]);
  if (coreTime < 0 || appTime < 0) {
    console.log("  ! No build found in dist/. Run `npm run build`.\n");
    return;
  }
  if (srcTime > Math.min(coreTime, appTime)) {
    console.log("  ! src/ is newer than the build. Run `npm run build` (or `npm run watch`).\n");
  }
}

server.listen(args.port, "127.0.0.1", () => {
  void warnIfStale();
  const base = `http://localhost:${args.port}/`;
  const openUrl = defaultPath ? base + "?path=" + encodeURIComponent(defaultPath) : base;
  console.log(`\n  Glossary Viewer running`);
  console.log(`  url:  ${base}`);
  if (defaultPath) {
    console.log(`  default file: ${defaultPath}`);
  }
  console.log("");
  if (args.open && process.platform === "darwin") {
    exec(`open "${openUrl}"`);
  } else if (args.open && process.platform === "win32") {
    exec(`start "" "${openUrl}"`);
  } else if (args.open) {
    exec(`xdg-open "${openUrl}"`, () => {});
  }
});
