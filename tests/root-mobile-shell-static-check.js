#!/usr/bin/env node
/*
 * Root mobile shell — static source guard (Phase-1 regression check).
 *
 * ============================================================================
 * IMPORTANT: This is a STATIC SOURCE GUARD ONLY. It parses text in index.html
 * and compares byte/text content against a known-good base fixture. It does
 * NOT execute any code, does NOT open a browser, and does NOT certify iPhone
 * Safari / iPhone standalone PWA / Chrome-iOS / Android Chrome / Desktop
 * Chrome / Edge runtime behavior. Passing this script proves only that the
 * source text has (or has not) certain shapes and that protected surfaces
 * (mobile/* files, the Mobile Ops anchor, the Supabase auth block) are
 * byte-identical to the verified base commit. Physical-device and
 * signed-out/authenticated runtime verification must be performed
 * separately per FuturoOS testing requirements.
 * ============================================================================
 *
 * Self-contained. Uses ONLY Node built-ins: fs, path, crypto. No external
 * dependencies, no package.json is required to run this file.
 *
 * Scope: index.html mobile-shell changes (Phase-1: sidebar drawer, focus
 * management, breakpoint sync, go() navigation, mobile CSS, sign-in input
 * sizing) plus protection of unrelated mobile/* app and the Supabase auth
 * config block, which this task must NOT have touched.
 *
 * Usage: node tests/root-mobile-shell-static-check.js [repoPath]
 *   repoPath is optional and defaults to the current working directory.
 *
 * Exits nonzero on any failure.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const repo = process.argv[2] || process.cwd();
const indexPath = path.join(repo, 'index.html');
const fixturePath = path.join(repo, 'tests', '.fixtures', 'protected-hashes-5b20c8d.json');

const src = fs.readFileSync(indexPath, 'utf8');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const sha256utf8 = (str) => sha256(Buffer.from(str, 'utf8'));

/* ---------------------------------------------------------------------- *
 * Brace-matched function body extraction. Walks braces from the first
 * "{" found after the given signature substring to its matching close.
 * Does NOT rely on line numbers, so it stays valid as the file changes.
 * ---------------------------------------------------------------------- */
function extractFnBody(source, signature) {
  const fnStart = source.indexOf(signature);
  if (fnStart === -1) return null;
  const braceStart = source.indexOf('{', fnStart);
  if (braceStart === -1) return null;
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(braceStart, i + 1);
    }
  }
  return null;
}

/* Brace-matched arbitrary block extraction starting at a given index
 * (index must point AT or BEFORE the opening "{"). Used for @media blocks
 * and other non-function braces. */
function extractBraceBlockFrom(source, searchFromIdx, openBraceNeedle) {
  const braceStart = source.indexOf(openBraceNeedle, searchFromIdx);
  if (braceStart === -1) return null;
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(braceStart, i + 1);
    }
  }
  return null;
}

const checks = [];
function check(label, ok) {
  checks.push([label, !!ok]);
}

/* ======================================================================
 * 1-2. Viewport meta
 * ====================================================================== */
const viewportMatch = src.match(/<meta\s+name="viewport"\s+content="([^"]*)"/);
const viewportContent = viewportMatch ? viewportMatch[1] : '';

check(
  '1. Viewport meta permits zoom (has width=device-width, no user-scalable=no, no maximum-scale)',
  viewportContent.includes('width=device-width') &&
  !/user-scalable\s*=\s*no/i.test(viewportContent) &&
  !/maximum-scale/i.test(viewportContent)
);

check(
  '2. Viewport meta contains viewport-fit=cover',
  /viewport-fit=cover/.test(viewportContent)
);

/* ======================================================================
 * 3-6. Mobile @media (max-width:760px) block — CSS content anchors only,
 * no line-number dependence.
 * ====================================================================== */
const mediaAnchorIdx = src.search(/@media\s+screen\s+and\s+\(max-width:\s*760px\)/);
const mobileBlock = mediaAnchorIdx !== -1
  ? extractBraceBlockFrom(src, mediaAnchorIdx, '{')
  : null;

let sidebarRule = null;
if (mobileBlock) {
  const sbIdx = mobileBlock.indexOf('.sidebar{');
  if (sbIdx !== -1) {
    const close = mobileBlock.indexOf('}', sbIdx);
    if (close !== -1) sidebarRule = mobileBlock.slice(sbIdx, close + 1);
  }
}

check(
  '3. Mobile .sidebar rule has height:100vh followed by height:100dvh (order matters)',
  !!sidebarRule &&
  (() => {
    const iVh = sidebarRule.indexOf('height:100vh');
    const iDvh = sidebarRule.indexOf('height:100dvh');
    return iVh !== -1 && iDvh !== -1 && iVh < iDvh;
  })()
);

check(
  '4. Mobile .sidebar rule does NOT contain overflow-y:auto (single scroll owner)',
  !!sidebarRule && !sidebarRule.includes('overflow-y:auto')
);

check(
  '5. Mobile block has .nav{...min-height:0...}',
  !!mobileBlock && /\.nav\{[^}]*min-height:0[^}]*\}/.test(mobileBlock)
);

check(
  '6. Mobile block has safe-area insets (env(safe-area-inset-top) AND env(safe-area-inset-bottom))',
  !!mobileBlock &&
  mobileBlock.includes('env(safe-area-inset-top)') &&
  mobileBlock.includes('env(safe-area-inset-bottom)')
);

/* ======================================================================
 * 7. toggleSidebar() body
 * ====================================================================== */
const toggleSidebarBody = extractFnBody(src, 'function toggleSidebar(');

check(
  '7. toggleSidebar() sets .inert, sets aria-expanded, toggles body...nav-open, and calls .focus(',
  !!toggleSidebarBody &&
  /\.inert\s*=/.test(toggleSidebarBody) &&
  /aria-expanded/.test(toggleSidebarBody) &&
  /body\b[\s\S]*nav-open/.test(toggleSidebarBody) &&
  /\.focus\s*\(/.test(toggleSidebarBody)
);

/* ======================================================================
 * 8. Initial mobile state sync (IIFE at load)
 * ====================================================================== */
check(
  '8. Initial mobile state sync IIFE references matchMedia, inert, and sidebar/open',
  (() => {
    // Find an IIFE (function(){ ... })(); occurring after toggleSidebar()'s
    // definition, and check it references the required concepts together.
    const afterToggle = toggleSidebarBody ? src.indexOf(toggleSidebarBody) + toggleSidebarBody.length : -1;
    if (afterToggle === -1) return false;
    const iifeStart = src.indexOf('(function()', afterToggle);
    if (iifeStart === -1) return false;
    const iifeBody = extractBraceBlockFrom(src, iifeStart, '{');
    if (!iifeBody) return false;
    return (
      /matchMedia\(\s*['"]\(max-width:760px\)['"]\s*\)/.test(iifeBody) &&
      /\.inert\s*=/.test(iifeBody) &&
      (/getElementById\(\s*['"]sidebar['"]\s*\)/.test(iifeBody) || /['"]open['"]/.test(iifeBody))
    );
  })()
);

/* ======================================================================
 * 9. Breakpoint-change cleanup handler
 * ====================================================================== */
// Find "<mq>.addEventListener('change',<handlerName>)" (or addListener), where
// <mq> was assigned from matchMedia('(max-width:760px)'). This anchors on
// content, not offsets, so it survives reformatting/reordering.
let mqChangeIdx = -1;
let bpChangeHandlerBody = null;
{
  // Anchor to a bare "= window.matchMedia(...);" assignment (statement ends
  // right after the call) so this does NOT match a boolean read like
  // "const mobile=window.matchMedia('(max-width:760px)').matches;".
  const mqAssignMatch = src.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*window\.matchMedia\(\s*['"]\(max-width:760px\)['"]\s*\)\s*;/);
  const mqVar = mqAssignMatch ? mqAssignMatch[1] : null;
  if (mqVar) {
    const changeCallRe = new RegExp(
      '\\b' + mqVar + '\\.(?:addEventListener\\(\\s*[\'"]change[\'"]\\s*,\\s*|addListener\\(\\s*)([A-Za-z_$][\\w$]*)\\)'
    );
    const changeCallMatch = src.match(changeCallRe);
    if (changeCallMatch) {
      mqChangeIdx = changeCallMatch.index;
      const handlerName = changeCallMatch[1];
      // Locate the handler's definition: "<handlerName>=e=>{" or "function <handlerName>(...){"
      const arrowDefIdx = src.search(new RegExp('\\b' + handlerName + '\\s*=\\s*[A-Za-z_$][\\w$]*\\s*=>\\s*\\{'));
      const fnDefIdx = src.indexOf('function ' + handlerName + '(');
      if (arrowDefIdx !== -1) {
        bpChangeHandlerBody = extractBraceBlockFrom(src, arrowDefIdx, '{');
      } else if (fnDefIdx !== -1) {
        bpChangeHandlerBody = extractFnBody(src, 'function ' + handlerName + '(');
      }
    }
  }
}

check(
  "9. matchMedia('(max-width:760px)') change handler exists and clears inert, removes 'nav-open', and clears aria-hidden/'open' on desktop",
  mqChangeIdx !== -1 &&
  !!bpChangeHandlerBody &&
  /\.inert\s*=\s*false/.test(bpChangeHandlerBody) &&
  /nav-open/.test(bpChangeHandlerBody) &&
  /remove/.test(bpChangeHandlerBody) &&
  (/aria-hidden/.test(bpChangeHandlerBody) || /['"]open['"]/.test(bpChangeHandlerBody))
);

/* ======================================================================
 * 10. Escape handler is modal-first, then sidebar in an else path
 * ====================================================================== */
const escHandlerIdx = src.search(/addEventListener\(\s*['"]keydown['"][\s\S]{0,80}?Escape/);
let escHandlerBody = null;
if (escHandlerIdx !== -1) {
  const braceIdx = src.indexOf('{', src.indexOf('=>', escHandlerIdx));
  escHandlerBody = braceIdx !== -1 ? extractBraceBlockFrom(src, braceIdx, '{') : null;
}

check(
  "10. Escape handler closes modal first, sidebar close is in an else branch (not two unconditional calls)",
  escHandlerIdx !== -1 &&
  !!escHandlerBody &&
  /closeModal\s*\(\s*\)/.test(escHandlerBody) &&
  /toggleSidebar\s*\(\s*false\s*\)/.test(escHandlerBody) &&
  (() => {
    const closeModalIdx = escHandlerBody.indexOf('closeModal(');
    const elseIdx = escHandlerBody.indexOf('else', closeModalIdx);
    const toggleIdx = escHandlerBody.indexOf('toggleSidebar(false)');
    // else must appear between the closeModal() call and the toggleSidebar(false) call
    return closeModalIdx !== -1 && elseIdx !== -1 && toggleIdx !== -1 &&
      closeModalIdx < elseIdx && elseIdx < toggleIdx;
  })()
);

/* ======================================================================
 * 11-13. go() body
 * ====================================================================== */
const goBody = extractFnBody(src, 'function go(');

check(
  '11. go() resets window scroll on mobile: window.scrollTo(0,0) gated by matchMedia',
  !!goBody &&
  (() => {
    const scrollIdx = goBody.indexOf('window.scrollTo(0,0)');
    if (scrollIdx === -1) return false;
    // The gating "if(window.matchMedia('(max-width:760px)').matches)" must
    // appear as an unbroken guard immediately preceding the scrollTo call
    // (same statement, no intervening ";").
    const preceding = goBody.slice(0, scrollIdx);
    const ifIdx = preceding.lastIndexOf('if(');
    if (ifIdx === -1) return false;
    const guard = preceding.slice(ifIdx, scrollIdx);
    if (guard.includes(';')) return false; // guard must directly precede the call
    return /if\(\s*window\.matchMedia\(\s*['"]\(max-width:760px\)['"]\s*\)\.matches\s*\)/.test(guard);
  })()
);

check(
  '12a. go() does not unconditionally focus content — the .focus( call is guarded by an "opts"/"userNav" reference',
  !!goBody &&
  (() => {
    const focusIdx = goBody.search(/\.focus\s*\(/);
    if (focusIdx === -1) return false;
    // Find the nearest enclosing "if(" before the .focus( call and confirm it
    // references opts/userNav, i.e. the focus is gated, not unconditional.
    const preceding = goBody.slice(0, focusIdx);
    const ifIdx = preceding.lastIndexOf('if(');
    if (ifIdx === -1) return false;
    const guardCond = preceding.slice(ifIdx);
    return /opts/.test(guardCond) && /userNav/.test(guardCond);
  })()
);

check(
  "12b. At least one go('control') boot call exists WITHOUT a second {userNav...} argument",
  /go\('control'\)(?!\s*,\s*\{userNav)/.test(src) &&
  (() => {
    // Explicitly confirm at least one go('control') is not immediately followed
    // by a userNav opts object.
    const re = /go\('control'\)/g;
    let m; let foundBare = false;
    while ((m = re.exec(src))) {
      const after = src.slice(m.index + m[0].length, m.index + m[0].length + 20);
      if (!/^\s*,\s*\{\s*userNav/.test(after)) { foundBare = true; break; }
    }
    return foundBare;
  })()
);

check(
  "13. Scoped focus path for user nav: a go( call passes ,{userNav:true}) (e.g. rNav's onclick template)",
  /,\{userNav:true\}\)/.test(src)
);

/* ======================================================================
 * 13d-13h. Focus-flow correction — single focus move on user navigation.
 * User-nav close must NOT bounce focus to the toggle first; other close
 * paths (Escape, overlay, direct toggle) keep normal focus return.
 * Whitespace-normalized so trivial formatting differences don't matter.
 * ====================================================================== */
const _srcN = src.replace(/\s+/g, '');
const _tsN = toggleSidebarBody ? toggleSidebarBody.replace(/\s+/g, '') : '';
const _goN = goBody ? goBody.replace(/\s+/g, '') : '';
const _escN = escHandlerBody ? escHandlerBody.replace(/\s+/g, '') : '';

check(
  '13d. Default sidebar close returns focus to #nav-toggle (tg.focus guarded by NEGATION of opts.returnFocus, so a no-opts close still focuses)',
  !!toggleSidebarBody &&
  /functiontoggleSidebar\(force,opts\)/.test(_srcN) &&
  /!\(opts&&opts\.returnFocus===false\)\)tg\.focus\(/.test(_tsN)
);

check(
  '13e. User-nav close SUPPRESSES toggle focus return: go() calls toggleSidebar(false,{returnFocus:false}) gated by opts.userNav',
  !!goBody &&
  /toggleSidebar\(false,\(opts&&opts\.userNav\)\?\{returnFocus:false\}:undefined\)/.test(_goN)
);

check(
  '13f. User-nav then focuses the new content region (#content focus + aria-label, under opts.userNav)',
  !!goBody &&
  /if\(opts&&opts\.userNav&&c\)\{/.test(_goN) &&
  /c\.setAttribute\(['"]aria-label['"]/.test(_goN) &&
  /c\.focus\(\{preventScroll:true\}\)/.test(_goN)
);

check(
  '13g. Boot/programmatic go() (no opts) stays out of the focus-moving path: exactly one .focus( in go(), and it is opts.userNav-gated',
  !!goBody &&
  (goBody.match(/\.focus\s*\(/g) || []).length === 1 &&
  /if\(opts&&opts\.userNav&&c\)\{/.test(_goN)
);

check(
  '13h. Escape and overlay-click close use NORMAL focus return (no returnFocus:false suppression)',
  !!escHandlerBody &&
  /toggleSidebar\(false\)/.test(_escN) &&
  !/returnFocus/.test(_escN) &&
  src.includes('onclick="toggleSidebar(false)"') &&
  !/onclick="toggleSidebar\(false,\{returnFocus/.test(src)
);

/* ======================================================================
 * 14. Sign-in inputs >= 16px in mobile CSS
 * ====================================================================== */
check(
  '14. Mobile block sets #ff-email,#ff-pass font-size >= 16px',
  (() => {
    if (!mobileBlock) return false;
    const m = mobileBlock.match(/#ff-email\s*,\s*#ff-pass\s*\{[^}]*font-size\s*:\s*(\d+(?:\.\d+)?)px[^}]*\}/);
    if (!m) return false;
    return parseFloat(m[1]) >= 16;
  })()
);

/* ======================================================================
 * 15. Labels wired to inputs
 * ====================================================================== */
check(
  '15. Labels for="ff-email"/for="ff-pass" and inputs id="ff-email"/id="ff-pass" exist',
  src.includes('for="ff-email"') &&
  src.includes('for="ff-pass"') &&
  src.includes('id="ff-email"') &&
  src.includes('id="ff-pass"')
);

/* ======================================================================
 * 16. Mobile Ops anchor byte-identical to fixture
 * ====================================================================== */
let anchorLiteral = null;
{
  const anchorStart = src.indexOf('<a href="mobile/"');
  if (anchorStart !== -1) {
    const closeTagIdx = src.indexOf('</a>', anchorStart);
    if (closeTagIdx !== -1) anchorLiteral = src.slice(anchorStart, closeTagIdx + 4);
  }
}
const anchorSha = anchorLiteral !== null ? sha256utf8(anchorLiteral) : null;

check(
  '16. Mobile Ops anchor byte-identical to fixture (literal + sha256), includes target="_blank"',
  anchorLiteral !== null &&
  anchorLiteral === fixture.mobile_ops_anchor.literal &&
  anchorSha === fixture.mobile_ops_anchor.sha256 &&
  anchorLiteral.includes('target="_blank"')
);

/* ======================================================================
 * 17. Every protected /mobile/ file byte-identical to fixture
 * ====================================================================== */
{
  const mobileFileEntries = Object.entries(fixture.mobile_files);
  let allMatch = true;
  const mismatches = [];
  for (const [relPath, expectedHash] of mobileFileEntries) {
    const absPath = path.join(repo, relPath.split('/').join(path.sep));
    let actualHash = null;
    try {
      const bytes = fs.readFileSync(absPath);
      actualHash = sha256(bytes);
    } catch (e) {
      actualHash = null;
    }
    if (actualHash !== expectedHash) {
      allMatch = false;
      mismatches.push(relPath);
    }
  }
  check(
    `17. All ${mobileFileEntries.length} protected /mobile/ files byte-identical to fixture` +
    (mismatches.length ? ` (mismatched: ${mismatches.join(', ')})` : ''),
    allMatch
  );
}

/* ======================================================================
 * 18. Auth block byte-identical to fixture
 * ====================================================================== */
{
  const startIdx = src.indexOf(fixture.auth_block.start_marker);
  const endIdx = startIdx !== -1 ? src.indexOf(fixture.auth_block.end_marker, startIdx) : -1;
  const authSlice = (startIdx !== -1 && endIdx !== -1) ? src.slice(startIdx, endIdx) : null;
  const authSha = authSlice !== null ? sha256utf8(authSlice) : null;
  check(
    '18. Supabase auth config block byte-identical to fixture',
    authSlice !== null && authSha === fixture.auth_block.sha256
  );
}

/* ======================================================================
 * 19. Test file itself requires only Node builtins; no package.json needed
 * ====================================================================== */
{
  const NODE_BUILTINS = new Set(['fs', 'path', 'crypto']);
  const selfSrc = fs.readFileSync(__filename, 'utf8');
  const requireRe = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  let onlyBuiltins = true;
  const offenders = [];
  while ((m = requireRe.exec(selfSrc))) {
    if (!NODE_BUILTINS.has(m[1])) { onlyBuiltins = false; offenders.push(m[1]); }
  }
  const pkgJsonMissing = !fs.existsSync(path.join(repo, 'package.json'));
  check(
    '19. This test file requires only Node builtins (fs/path/crypto); repo root has no package.json this run depends on' +
    (offenders.length ? ` (non-builtin requires found: ${offenders.join(', ')})` : ''),
    onlyBuiltins && pkgJsonMissing
  );
}

/* ======================================================================
 * 20. Deferral guards: unrelated overflow work not touched
 * ====================================================================== */
check(
  '20a. Deferred table overflow rule .th,.tr{min-width:560px} present unchanged',
  src.includes('.th,.tr{min-width:560px}')
);

check(
  '20b. No overflow-x:hidden was introduced',
  !src.includes('overflow-x:hidden')
);

check(
  '20c. No pageshow/pagehide/popstate handler was added',
  !/addEventListener\(\s*['"]pageshow['"]/.test(src) &&
  !/addEventListener\(\s*['"]pagehide['"]/.test(src) &&
  !/addEventListener\(\s*['"]popstate['"]/.test(src)
);

/* ======================================================================
 * Report
 * ====================================================================== */
let failures = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
}

console.log(`\nChecks: ${checks.length}`);
console.log(`Failures: ${failures}`);

process.exit(failures === 0 ? 0 : 1);
