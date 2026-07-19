#!/usr/bin/env node
/*
 * S2-B static check — job-detail sheet scroll-reset regression (photo-only).
 *
 * Self-contained. Uses only Node built-ins (fs, path). No dependencies.
 * Scoped entirely to openDetail() in mobile/app.js; does NOT read index.html
 * and makes NO claim about Mobile Ops navigation (that change was reverted).
 *
 * Verifies, narrowly and scoped to the brace-matched openDetail() body:
 *   1. openDetail() is found via brace-matched function-body extraction.
 *   2. The detail sheet is made visible (detailSheet.hidden = false).
 *   3. .sheet-card is queried into a named scroller variable.
 *   4. That same named variable receives scrollTop = 0.
 *   5. The scroll reset occurs after hidden = false.
 *   6. The scroll reset occurs before later detail-view event/focus/
 *      animation/positioning logic (the first handler wiring).
 *
 * Exits nonzero on any failure.
 *
 * Usage: node tests/s2b-static-check.js [repoPath]
 *   repoPath is optional and defaults to the current working directory.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const repo = process.argv[2] || process.cwd();
const appPath = path.join(repo, 'mobile', 'app.js');

const appSrc = fs.readFileSync(appPath, 'utf8');

/* --- Isolate the openDetail() function body only, via brace matching. --- */
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

/* --- Index of "detailSheet.hidden = false" (sheet made visible). --- */
const hiddenIdx = openDetailBody
  ? openDetailBody.search(/\$\(\s*['"]detailSheet['"]\s*\)\s*\.hidden\s*=\s*false/)
  : -1;

/* --- Capture the variable that receives the .sheet-card query result. ---
 * e.g.  const detailScroller = $('detailSheet').querySelector('.sheet-card');
 * We capture "detailScroller" so we can prove the SAME object is scrolled. */
let scrollerVar = null;
if (openDetailBody) {
  const assign = openDetailBody.match(
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;]*\.querySelector\(\s*['"]\.sheet-card['"]\s*\)/
  );
  if (assign) scrollerVar = assign[1];
}

/* --- Index of "<scrollerVar>.scrollTop = 0" — the SAME variable. --- */
let boundScrollIdx = -1;
if (openDetailBody && scrollerVar) {
  const boundRe = new RegExp('\\b' + scrollerVar + '\\s*\\.scrollTop\\s*=\\s*0');
  boundScrollIdx = openDetailBody.search(boundRe);
}

/* --- Index of the first later detail-view handler/focus/positioning logic.
 * The scroll reset must land before this wiring. We match the earliest of an
 * onclick handler, a .focus( call, or an .addEventListener( call. --- */
let laterLogicIdx = -1;
if (openDetailBody) {
  laterLogicIdx = openDetailBody.search(/\.onclick\b|\.focus\s*\(|\.addEventListener\s*\(/);
}

const checks = [
  ['1. openDetail() function body found (brace-matched)',
    openDetailBody !== null],
  ['2. openDetail() makes the detail sheet visible (hidden = false)',
    hiddenIdx !== -1],
  ['3. .sheet-card is queried into a named scroller variable',
    scrollerVar !== null],
  ['4. that same variable (' + (scrollerVar || '?') + ') receives scrollTop = 0',
    scrollerVar !== null && boundScrollIdx !== -1],
  ['5. scroll reset occurs after hidden = false',
    hiddenIdx !== -1 && boundScrollIdx !== -1 && boundScrollIdx > hiddenIdx],
  ['6. scroll reset occurs before later event/focus/positioning logic',
    boundScrollIdx !== -1 && laterLogicIdx !== -1 && boundScrollIdx < laterLogicIdx]
];

let failures = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
}

console.log(`\nChecks: ${checks.length}`);
console.log(`Failures: ${failures}`);

process.exit(failures === 0 ? 0 : 1);
