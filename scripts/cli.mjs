#!/usr/bin/env node
// Thin dispatcher: `mdglossary view <file>` or `mdglossary export <file> [out]`.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const [cmd, ...rest] = process.argv.slice(2);

function run(script) {
  const child = spawn(process.execPath, [path.join(here, script), ...rest], {
    stdio: "inherit",
  });
  child.on("exit", (code) => process.exit(code ?? 0));
}

switch (cmd) {
  case "view":
  case "serve":
    run("serve.mjs");
    break;
  case "export":
  case "build":
    run("build-html.mjs");
    break;
  default:
    console.log(`mdglossary — local Markdown glossary viewer

Usage:
  mdglossary view <file.md> [--port 4321] [--no-open]   Serve with live reload
  mdglossary export <file.md> [out.html]                Write a standalone HTML file
`);
    process.exit(cmd ? 1 : 0);
}
