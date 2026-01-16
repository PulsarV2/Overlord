#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
if (args.length === 0) {
  console.log('Usage: node scripts/remove-comments.cjs <target-path> [--apply] [--verbose] [--exts=.ts,.js,.tsx,.jsx,.css,.html]');
  process.exit(1);
}

const target = args[0];
const APPLY = args.includes('--apply');
const VERBOSE = args.includes('--verbose') || args.includes('-v');
const extsArg = args.find(a => a.startsWith('--exts='));
const exts = extsArg ? extsArg.split('=')[1].split(',').map(e => e.trim()) : ['.ts','.js','.tsx','.jsx','.css','.html'];

function log(...s) { if (VERBOSE) console.log(...s); }

function shouldProcess(filePath) {
  const lower = filePath.toLowerCase();
  if (lower.includes('node_modules')) return false;
  return exts.includes(path.extname(filePath));
}

function removeCommentsFromText(content, ext) {
  const preserveTodo = /TODO/i;
  if (ext === '.html') {
    const htmlRegex = /<!--([\s\S]*?)-->/g;
    return content.replace(htmlRegex, (m, g1) => (preserveTodo.test(m) ? m : ''));
  }

  // Safer scanner: avoid removing comment-like sequences inside string/template literals
  let out = '';
  const len = content.length;
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;

  while (i < len) {
    const ch = content[i];

    if (inSingle) {
      out += ch;
      if (ch === '\\') { // escape
        if (i + 1 < len) { out += content[i+1]; i += 2; continue; }
      }
      if (ch === "'") { inSingle = false; }
      i++;
      continue;
    }

    if (inDouble) {
      out += ch;
      if (ch === '\\') {
        if (i + 1 < len) { out += content[i+1]; i += 2; continue; }
      }
      if (ch === '"') { inDouble = false; }
      i++;
      continue;
    }

    if (inTemplate) {
      out += ch;
      if (ch === '\\') {
        if (i + 1 < len) { out += content[i+1]; i += 2; continue; }
      }
      if (ch === '`') { inTemplate = false; }
      i++;
      continue;
    }

    // Not inside strings/templates: detect string starts
    if (ch === "'") { inSingle = true; out += ch; i++; continue; }
    if (ch === '"') { inDouble = true; out += ch; i++; continue; }
    if (ch === '`') { inTemplate = true; out += ch; i++; continue; }

    // Detect comments only when outside strings
    if (ch === '/' && i + 1 < len) {
      const nc = content[i+1];
      if (nc === '/') {
        // line comment
        const start = i;
        let j = i + 2;
        while (j < len && content[j] !== '\n') j++;
        const comment = content.slice(start, j);
        if (preserveTodo.test(comment)) {
          out += comment;
        } else {
          // remove comment but preserve newline
        }
        if (j < len && content[j] === '\n') { out += '\n'; j++; }
        i = j;
        continue;
      }
      if (nc === '*') {
        // block comment
        const start = i;
        let j = i + 2;
        while (j < len) {
          if (content[j] === '*' && j + 1 < len && content[j+1] === '/') { j += 2; break; }
          j++;
        }
        const comment = content.slice(start, j);
        if (preserveTodo.test(comment)) {
          out += comment;
        } else {
          // preserve newlines within the block so line numbers remain similar
          const preserved = comment.split('\n').map(() => '').join('\n');
          out += preserved;
        }
        i = j;
        continue;
      }
    }

    out += ch;
    i++;
  }

  return out;
}

function walk(dir, fileCallback) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules') continue;
      walk(full, fileCallback);
    } else if (e.isFile()) {
      fileCallback(full);
    }
  }
}

function processFile(filePath) {
  if (!shouldProcess(filePath)) return null;
  try {
    const orig = fs.readFileSync(filePath, 'utf8');
    const ext = path.extname(filePath);
    const updated = removeCommentsFromText(orig, ext);
    if (updated !== orig) {
      return { filePath, orig, updated };
    }
  } catch (err) {
    console.error('Failed reading', filePath, err.message);
  }
  return null;
}

function main() {
  const targetPath = path.resolve(process.cwd(), target);
  if (!fs.existsSync(targetPath)) {
    console.error('Target not found:', targetPath);
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
    console.log('No comment-only removals detected.');
    return;
  }

  console.log(`Found ${changes.length} modified file(s).`);
  for (const c of changes) {
    console.log(c.filePath);
    if (VERBOSE) {
      // show a small sample diff-ish view: first differing region
      const beforeLines = c.orig.split('\n');
      const afterLines = c.updated.split('\n');
      for (let i=0;i<Math.min(beforeLines.length, afterLines.length, 50); i++){
        if (beforeLines[i] !== afterLines[i]){
          console.log('-- before --');
          console.log(beforeLines.slice(Math.max(0,i-3), i+3).join('\n'));
          console.log('-- after --');
          console.log(afterLines.slice(Math.max(0,i-3), i+3).join('\n'));
          break;
        }
      }
    }
  }

  if (APPLY) {
    for (const c of changes) {
      try {
        fs.writeFileSync(c.filePath, c.updated, 'utf8');
        console.log('WROTE', c.filePath);
      } catch (err) {
        console.error('Failed write', c.filePath, err.message);
      }
    }
  } else {
    console.log('Dry-run: no files modified. Re-run with --apply to write changes.');
  }
}

main();
