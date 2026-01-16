#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
if (args.length === 0) {
  console.log(
    "Usage: node scripts/remove-comments.js <target-path> [--apply] [--verbose] [--exts=.ts,.js,.tsx,.jsx,.css,.html]",
  );
  process.exit(1);
}

const target = args[0];
const APPLY = args.includes("--apply");
const VERBOSE = args.includes("--verbose") || args.includes("-v");
const extsArg = args.find((a) => a.startsWith("--exts="));
const exts = extsArg
  ? extsArg
      .split("=")[1]
      .split(",")
      .map((e) => e.trim())
  : [".ts", ".js", ".tsx", ".jsx", ".css", ".html"];

function log(...s) {
  if (VERBOSE) console.log(...s);
}

function shouldProcess(filePath) {
  const lower = filePath.toLowerCase();
  if (lower.includes("node_modules")) return false;
  return exts.includes(path.extname(filePath));
}

function removeCommentsFromText(content, ext) {
  const preserveTodo = /TODO/i;
  if (ext === ".html") {
    const htmlRegex = /<!--([\s\S]*?)-->/g;
    return content.replace(htmlRegex, (m, g1) =>
      preserveTodo.test(m) ? m : "",
    );
  }

  // For JS/TS/CSS-like files: handle // single-line and /* */ block comments
  const commentRegex = /\/\/.*$|\/\*[\s\S]*?\*\//gm;
  return content.replace(commentRegex, (m) => {
    if (preserveTodo.test(m)) return m;
    // preserve newlines inside block comments so line numbers stay stable
    if (m.includes("\n")) return m.replace(/[^\n]/g, "");
    return "";
  });
}

function walk(dir, fileCallback) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules") continue;
      walk(full, fileCallback);
    } else if (e.isFile()) {
      fileCallback(full);
    }
  }
}

function processFile(filePath) {
  if (!shouldProcess(filePath)) return null;
  try {
    const orig = fs.readFileSync(filePath, "utf8");
    const ext = path.extname(filePath);
    const updated = removeCommentsFromText(orig, ext);
    if (updated !== orig) {
      return { filePath, orig, updated };
    }
  } catch (err) {
    console.error("Failed reading", filePath, err.message);
  }
  return null;
}

function main() {
  const targetPath = path.resolve(process.cwd(), target);
  if (!fs.existsSync(targetPath)) {
    console.error("Target not found:", targetPath);
    process.exit(2);
  }

  const changes = [];
  const stats = fs.statSync(targetPath);
  if (stats.isFile()) {
    const r = processFile(targetPath);
    if (r) changes.push(r);
  } else if (stats.isDirectory()) {
    walk(targetPath, (file) => {
      const r = processFile(file);
      if (r) changes.push(r);
    });
  }

  if (changes.length === 0) {
    console.log("No comment-only removals detected.");
    return;
  }

  console.log(`Found ${changes.length} modified file(s).`);
  for (const c of changes) {
    console.log(c.filePath);
    if (VERBOSE) {
      // show a small sample diff-ish view: first differing region
      const beforeLines = c.orig.split("\n");
      const afterLines = c.updated.split("\n");
      for (
        let i = 0;
        i < Math.min(beforeLines.length, afterLines.length, 50);
        i++
      ) {
        if (beforeLines[i] !== afterLines[i]) {
          console.log("-- before --");
          console.log(beforeLines.slice(Math.max(0, i - 3), i + 3).join("\n"));
          console.log("-- after --");
          console.log(afterLines.slice(Math.max(0, i - 3), i + 3).join("\n"));
          break;
        }
      }
    }
  }

  if (APPLY) {
    for (const c of changes) {
      try {
        fs.writeFileSync(c.filePath, c.updated, "utf8");
        console.log("WROTE", c.filePath);
      } catch (err) {
        console.error("Failed write", c.filePath, err.message);
      }
    }
  } else {
    console.log(
      "Dry-run: no files modified. Re-run with --apply to write changes.",
    );
  }
}

main();
