#!/usr/bin/env node
// Conditionally rebuilds better-sqlite3 if the loaded native binding's ABI doesn't
// match the current Node runtime. Uses execFileSync (no shell) to avoid injection risk
// since arguments are fixed string literals.

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function tryLoad() {
  try {
    const Database = require("better-sqlite3");
    new Database(":memory:").close();
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err && err.message ? err.message : String(err) };
  }
}

const result = tryLoad();
if (result.ok) {
  // Silent on the happy path.
  process.exit(0);
}

const mismatch = /NODE_MODULE_VERSION|invalid ELF header|was compiled against a different/i.test(
  result.message,
);
if (!mismatch) {
  console.error("[postinstall] better-sqlite3 load failure unrelated to ABI:", result.message);
  process.exit(0);
}

console.log("[postinstall] better-sqlite3 ABI mismatch — rebuilding...");
try {
  // Fixed args; no user input; safe.
  execFileSync("pnpm", ["rebuild", "better-sqlite3"], { stdio: "inherit" });
  console.log("[postinstall] rebuild OK");
} catch (err) {
  console.error("[postinstall] rebuild failed:", err);
  process.exit(1);
}
