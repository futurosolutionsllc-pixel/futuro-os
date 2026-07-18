#!/usr/bin/env node
/*
 * S2-B static check — Mobile Ops in-place navigation + detail-sheet scroll reset.
 *
 * Self-contained. No dependencies. Does NOT depend on any S2-A script.
 *
 * Verifies, narrowly and scoped to the specific anchor / function:
 *   1. The Mobile Ops anchor retains href="mobile/".
 *   2. That same anchor has no target="_blank".
 *   3. That same anchor has no rel="noopener".
 *   4. openDetail() makes the detail sheet visible.
 *   5. openDetail() queries the .sheet-card scroll container.
 *   6. scrollTop = 0 occurs after hidden = false.
 *
 * Usage: node tests/s2b-static-check.js [repoPath]
 *   repoPath is optional and defaults to the current working directory.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const repo = process.argv[2] || process.cwd();
const indexPath = path.join(repo, 'index.html');
const appPath = path.join(repo, 'mobile', 'app.js');

const indexSrc = fs.readFileSync(indexPath, 'utf8');
const appSrc = fs.readFileSync(appPath, 'utf8');

/* --- Scope 1: isolate the Mobile Ops anchor only ---
 * Find the single <a ...>...Mobile Ops...</a> so unrelated markup can't
 * create a false pass/fail. */
let mobileAnchor = null;
const anchorRe = /<a\b[^>]*>[\s\S]*?<\/a>/gi;
let m;
while ((m = anchorRe.exec(indexSrc)) !== null) {
  if (/Mobile Ops/.test(m[0])) { mobileAnchor = m[0]; break; }
}
// The attribute checks must run against the opening tag specifically.
const mobileOpenTag = mobileAnchor
  ? (mobileAnchor.match(/<a\b[^>]*>/i) || [null])[0]
  : null;

/* --- Scope 2: isolate the openDetail() function body only --- */
let openDetailBody = null;
const fnStart = appSrc.indexOf('function openDetail(');
if (fnStart !== -1) {
  // Walk braces from the first "{" after the signature to its matching close.
  const braceStart = appSrc.indexOf('{', fnStart);
  if (braceStart !== -1) {
    let depth = 0;
    for (let i = braceStart; i < appSrc.length; i++) {
      const ch = appSrc[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) { openDetailBody = appSrc.slice(braceStart, i + 1); break; }
      }
    }
  }
}

/* --- Ordering helper: scrollTop reset after hidden = false --- */
let scrollAfterVisible = false;
if (openDetailBody) {
  const hiddenIdx = openDetailBody.search(/\$\(\s*['"]detailSheet['"]\s*\)\s*\.hidden\s*=\s*false/);
  const scrollIdx = openDetailBody.search(/\.scrollTop\s*=\s*0/);
  scrollAfterVisible = hiddenIdx !== -1 && scrollIdx !== -1 && scrollIdx > hiddenIdx;
}

const checks = [
  ['Mobile Ops anchor found in index.html', mobileOpenTag !== null],
  ['1. Mobile Ops anchor retains href="mobile/"',
    mobileOpenTag !== null && /href\s*=\s*"mobile\/"/.test(mobileOpenTag)],
  ['2. Mobile Ops anchor has no target="_blank"',
    mobileOpenTag !== null && !/target\s*=/i.test(mobileOpenTag)],
  ['3. Mobile Ops anchor has no rel="noopener"',
    mobileOpenTag !== null && !/rel\s*=/i.test(mobileOpenTag)],
  ['openDetail() function body found in mobile/app.js', openDetailBody !== null],
  ['4. openDetail() makes the detail sheet visible',
    openDetailBody !== null && /\$\(\s*['"]detailSheet['"]\s*\)\s*\.hidden\s*=\s*false/.test(openDetailBody)],
  ['5. openDetail() queries the .sheet-card scroll container',
    openDetailBody !== null && /querySelector\(\s*['"]\.sheet-card['"]\s*\)/.test(openDetailBody)],
  ['6. scrollTop = 0 occurs after hidden = false', scrollAfterVisible]
];

let failures = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
}

console.log(`\nChecks: ${checks.length}`);
console.log(`Failures: ${failures}`);

process.exit(failures === 0 ? 0 : 1);
