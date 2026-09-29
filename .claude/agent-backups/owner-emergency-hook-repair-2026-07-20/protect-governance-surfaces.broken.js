#!/usr/bin/env node
/**
 * FuturoOS governance-surface protection (PreToolUse hook).
 *
 * Covers the gaps that permission rules provably cannot cover:
 *   - Write / NotebookEdit path scoping (path-scoped Write(...) rules are accepted
 *     but never matched by Claude Code's file-permission checks).
 *   - File movement / rename / deletion (no supported filesystem-level tool rule exists).
 *
 * Permission rules in settings.local.json remain the primary control. This hook is
 * defense-in-depth, NOT a complete security boundary. See "Known limitations" below.
 *
 * Contract: reads the PreToolUse JSON payload on stdin, emits a permissionDecision.
 *
 * P0B hardening (2026-07-19) â€” closes the confirmed ordinary-use bypasses:
 *   1. Targets are RESOLVED to a repo-relative path before classification, so
 *      absolute Windows paths (backslash or forward-slash), quoted paths, ./ paths,
 *      and ../ traversal (mobile/../.claude/...) all reach the same decision as the
 *      plain relative form. Detection no longer depends on literal fragment matching.
 *   2. Windows PowerShell filesystem mutation cmdlets and their common aliases are
 *      recognized, including inside `powershell -Command "..."`.
 *   3. Common shell mutators (cp, mv, rm, rmdir, install, tee, truncate, sed -i) and
 *      output/append redirection are recognized.
 *   4. Node and Python direct file mutations are recognized when the protected target
 *      is plainly present in the command text.
 *   5. A validly parsed mutation payload missing its required target field is treated
 *      as a malformed mutation request (ask) rather than a silent defer.
 *
 * Design invariant preserved from the original: protection keys off the COMMAND VERB,
 * not off any mention of a protected name. A read-only command (grep, Select-String,
 * Get-Content, git status, node --check) that merely names a protected path is never
 * blocked. This is what keeps the false-positive rate at zero for ordinary work.
 *
 * Known limitations (documented, accepted, not closed by P0B):
 *   - Fails OPEN on completely unparseable stdin, so a hook fault can never break
 *     ordinary application work. A diagnostic is written to stderr.
 *   - Does not attempt to detect deliberate obfuscation, encoded scripts, dynamically
 *     computed paths, or arbitrary code execution. It raises the floor against ordinary
 *     accidental and casual mutation; it does not stop a determined actor.
 */

'use strict';

const fs = require('fs');

const DEFER = { decision: 'defer', reason: '' };

const REPO_ROOT = String(process.env.CLAUDE_PROJECT_DIR || process.cwd())
  .replace(/\\/g, '/')
  .replace(/\/+$/, '');

/* ------------------------------------------------------------------ *
 * Path resolution
 * ------------------------------------------------------------------ */

function stripQuotes(value) {
  const t = String(value == null ? '' : value).trim();
  if (t.length >= 2) {
    const a = t[0];
    const z = t[t.length - 1];
    if ((a === '"' && z === '"') || (a === "'" && z === "'") || (a === '`' && z === '`')) {
      return t.slice(1, -1);
    }
  }
  return t;
}

function isAbsolute(p) {
  return /^[A-Za-z]:\//.test(p) || p.startsWith('/');
}

/** Collapse . and .. segments. Returns null if the path escapes above its base. */
function collapse(p) {
  const out = [];
  for (const part of p.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (out.length === 0) return null; // escaped above the repo root
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join('/');
}

/**
 * Resolve any written form of a target to a repo-root-relative POSIX path.
 * Returns null when the target is outside the repository or unusable.
 */
function resolveTarget(raw) {
  // Normalize separators, then collapse repeated separators so that near-miss forms
  // (D://repo//.claude/...) resolve identically to the canonical form.
  let s = stripQuotes(raw).replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  if (!s) return null;

  if (isAbsolute(s)) {
    const low = s.toLowerCase();
    const root = REPO_ROOT.toLowerCase();
    if (low === root) return '';
    if (!low.startsWith(root + '/')) return null; // outside this repository
    s = s.slice(REPO_ROOT.length + 1);
  }

  const rel = collapse(s);
  if (rel !== null) return rel;

  // The path climbs above the repo root, so it depends on a working directory the
  // hook cannot observe (e.g. `cd mobile && rm ../.claude/agents/x.md`). Fall back
  // to the remainder after the leading climb. This can only ever OVER-protect, and
  // the caller has already established mutation intent, so erring toward `ask` is
  // the correct direction.
  return collapse(s.replace(/^(?:\.\.\/)+/, ''));
}

/* ------------------------------------------------------------------ *
 * Protected-surface classification
 * ------------------------------------------------------------------ */

/** Does a repo-relative path already exist on disk? Never throws. */
function exists(rel) {
  try {
    return fs.existsSync(`${REPO_ROOT}/${rel}`);
  } catch {
    return false;
  }
}

/**
 * Build the standard protected-surface denial reason.
 *
 * Every protected-surface denial states the same three things: what the target is,
 * that the action was blocked outright, and how a legitimate change is actually made.
 * The last part matters â€” a bare denial invites workaround attempts, whereas naming
 * the correct procedure routes the work to the owner.
 */
function denyProtected(verb, rel, detail) {
  return {
    decision: 'deny',
    reason: `${verb} ${rel} â€” a protected FuturoOS governance/configuration surface. `
      + `This action was BLOCKED, not queued for approval.${detail ? ` ${detail}` : ''} `
      + 'Changes to protected surfaces must be performed through a separately authorized, '
      + 'owner-controlled procedure, outside the agent tool path.',
  };
}

/**
 * Classify an already-resolved repo-relative path.
 * Covers .claude/** (governance, matrix, agents, hooks, backups), CLAUDE.md,
 * .gitignore, and .git/** (including .git/info/exclude).
 *
 * P0B enforcement floor: every protected verdict is `deny`. `ask` is never returned
 * for a protected surface â€” see the P0B note in the file header for why.
 */
function classifyRel(rel, verb) {
  if (rel === null || rel === undefined || rel === '') return DEFER;
  const low = rel.toLowerCase();

  if (low === '.git' || low.startsWith('.git/')) {
    return denyProtected(verb, rel, 'Git internals (including .git/info/exclude) are never agent-writable.');
  }
  if (low === '.claude/agent-backups' || low.startsWith('.claude/agent-backups/')) {
    // Existing backups are immutable evidence. NEW backup folders were previously an
    // `ask`, but `ask` is not an enforcement floor (see header), and a backup created
    // through a bypassable gate is not trustworthy evidence of a pre-change state.
    // Backup creation is therefore an owner-performed step by design.
    return denyProtected(
      verb,
      rel,
      exists(rel)
        ? 'This is existing agent-backup evidence and is immutable.'
        : 'Backup artifacts must be created by the owner so they remain independent evidence.',
    );
  }
  if (low === '.claude' || low.startsWith('.claude/') || low === 'claude.md' || low === '.gitignore') {
    return denyProtected(verb, rel, '');
  }
  return DEFER;
}

/** Cheap pre-filter: does this token even look like it could name a protected surface? */
const LOOKS_PROTECTED = /(^|[\\/=:])(\.claude|\.gitignore|\.git)([\\/]|$)|claude\.md$/i;

/**
 * Split arbitrary command text into candidate path tokens, quote-aware.
 * A quoted span is ONE token, so a value such as -Value "see CLAUDE.md for rules"
 * can be skipped whole rather than leaking its words back as candidate paths.
 */
function candidateTokens(text) {
  const s = String(text == null ? '' : text);
  const out = [];
  let cur = '';
  let quote = null;
  let started = false;

  const flush = () => {
    if (started || cur !== '') out.push(cur);
    cur = '';
    started = false;
  };

  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) { quote = null; continue; }
      cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; started = true; continue; }
    if (/[\s,;()[\]{}<>|=]/.test(ch)) { flush(); continue; }
    cur += ch;
  }
  flush();
  return out.filter((x) => x !== '');
}

/** Flags whose following token is a value, not a path. */
const VALUE_BEARING_FLAGS = new Set(['-value', '-encoding', '-filter', '-newname']);

/**
 * Scan command text for a protected target. Applied ONLY to segments whose verb
 * has already been identified as a mutation.
 */
function checkTargets(text, verbPhrase) {
  const tokens = candidateTokens(text);
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i];
    if (VALUE_BEARING_FLAGS.has(tok.toLowerCase())) {
      i += 1; // skip the value itself â€” it is content, not a target
      continue;
    }
    if (tok.startsWith('-')) continue; // switch / parameter name

    // A token may be a bare path, or a quoted blob of embedded script code such as
    // `require('fs').writeFileSync('CLAUDE.md','x')`. Sub-split it so a path buried
    // in code is still seen. This runs AFTER the value-flag skip above, so a value
    // that merely mentions a protected name is never re-introduced here.
    for (const piece of [tok].concat(tok.split(/[\s'"`,;()[\]{}<>|=]+/))) {
      if (!piece || !LOOKS_PROTECTED.test(piece)) continue;
      const verdict = classifyRel(resolveTarget(piece), verbPhrase);
      if (verdict.decision !== 'defer') return verdict;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Command vocabulary
 * ------------------------------------------------------------------ */

const POSIX_MUTATORS = new Set([
  'cp', 'mv', 'rm', 'rmdir', 'install', 'tee', 'truncate',
  'ln', 'shred', 'unlink', 'touch', 'mkdir', 'chmod', 'chown', 'dd',
]);

const PS_MUTATORS = new Set([
  'set-content', 'add-content', 'clear-content', 'out-file', 'new-item',
  'copy-item', 'move-item', 'rename-item', 'remove-item',
  'set-itemproperty', 'remove-itemproperty', 'clear-item', 'set-item',
]);

/** PowerShell aliases recognizable without broad false positives. */
const PS_ALIASES = new Set([
  'sc', 'ac', 'clc', 'ni', 'copy', 'move', 'ren', 'ri', 'del', 'erase',
  'rd', 'md', 'mi', 'rni', 'cpi', 'si', 'rmo',
]);

const SCRIPT_RUNNERS = new Set([
  'node', 'python', 'python3', 'py', 'perl', 'ruby',
  'powershell', 'pwsh', 'cmd', 'bash', 'sh',
]);

/** Read-only commands: never a mutation, regardless of what they name. */
const READ_ONLY = new Set([
  'grep', 'rg', 'egrep', 'fgrep', 'find', 'cat', 'ls', 'dir', 'head', 'tail',
  'less', 'more', 'type', 'stat', 'file', 'wc', 'awk', 'sort', 'uniq', 'cut',
  'diff', 'sha256sum', 'md5sum', 'certutil', 'echo', 'printf',
  'select-string', 'get-content', 'get-item', 'get-childitem', 'get-filehash',
  'gc', 'gci', 'gi', 'gp', 'ls-files', 'test', 'which', 'where',
]);

/** Direct file-mutating calls in Node / Python / PowerShell script text. */
const SCRIPT_MUTATION_PATTERNS = [
  // Node fs
  /\b(?:writeFileSync|appendFileSync|writeFile|appendFile|renameSync|unlinkSync|rmSync|rmdirSync|copyFileSync|copyFile|truncateSync|createWriteStream|cpSync|mkdirSync)\s*\(/i,
  // Python open() in a write/append/exclusive mode
  /\bopen\s*\([^)]*,\s*(?:mode\s*=\s*)?['"][wax]/i,
  // Python pathlib / os / shutil
  /\b(?:write_text|write_bytes)\s*\(/i,
  /\b(?:os\.(?:remove|unlink|rename|replace|rmdir|truncate)|shutil\.(?:copy|copy2|copyfile|move|rmtree))\s*\(/i,
  /\.(?:unlink|rename|replace)\s*\(/i,
  // PowerShell cmdlets invoked inside -Command / -c
  /\b(?:Set-Content|Add-Content|Clear-Content|Out-File|New-Item|Copy-Item|Move-Item|Rename-Item|Remove-Item)\b/i,
];

function hasScriptMutation(text) {
  return SCRIPT_MUTATION_PATTERNS.some((re) => re.test(text));
}

/* ------------------------------------------------------------------ *
 * Command-line parsing
 * ------------------------------------------------------------------ */

/** Split a command line into independently-executed segments, respecting quotes. */
function segments(cmd) {
  const out = [];
  let cur = '';
  let quote = null;
  const s = String(cmd || '');

  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      cur += ch;
      continue;
    }
    const two = s.slice(i, i + 2);
    if (two === '&&' || two === '||') {
      out.push(cur); cur = ''; i += 1; continue;
    }
    if (ch === ';' || ch === '|' || ch === '\n') {
      out.push(cur); cur = ''; continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

/** Strip leading env-var assignments; return [verb, argString]. */
function head(segment) {
  const s = segment.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*/, '');
  const m = s.match(/^(\S+)\s*([\s\S]*)$/);
  return m ? [m[1], m[2]] : [s, ''];
}

/** Normalize a verb: strip any path to the binary and a trailing .exe. */
function normalizeVerb(verb) {
  return stripQuotes(verb)
    .replace(/\\/g, '/')
    .replace(/^.*\//, '')
    .replace(/\.(?:exe|cmd|bat|ps1)$/i, '')
    .toLowerCase();
}

/* ------------------------------------------------------------------ *
 * Specific checks
 * ------------------------------------------------------------------ */

/** Output / append redirection onto a protected surface. */
function checkRedirection(segment) {
  const re = /(?:^|[^0-9>])>>?\s*(["'`]?)([^\s"'`;|&]+)\1/g;
  let m;
  while ((m = re.exec(segment)) !== null) {
    const verdict = classifyRel(
      resolveTarget(m[2]),
      'Command may overwrite, via redirection,',
    );
    if (verdict.decision !== 'defer') return verdict;
  }
  return null;
}

/** git staging rules. Only `git add` argument lists are inspected. */
function checkGit(rest) {
  const addArgs = rest.match(/^add\s+([\s\S]*)$/i);
  if (!addArgs) return null;
  const args = addArgs[1];

  if (/(^|\s)(-[A-Za-z]*[AfF][A-Za-z]*|--all|--force)(\s|$)/.test(args)) {
    return {
      decision: 'deny',
      reason: 'Broad or forced git staging (-A / --all / -f / --force) is prohibited.',
    };
  }
  if (/(^|\s)(\.|\.\/|\*)(\s|$)/.test(args)) {
    return {
      decision: 'deny',
      reason: 'Whole-tree or wildcard staging (git add . / git add *) is prohibited.',
    };
  }
  const hit = checkTargets(args, 'Staging');
  if (hit) {
    return {
      decision: 'deny',
      reason: 'Staging a protected governance/configuration surface is prohibited; '
        + 'these paths are locally excluded and must remain untracked.',
    };
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Dispatch
 * ------------------------------------------------------------------ */

function classifyBash(cmd) {
  const c = String(cmd || '').trim();
  if (!c) return DEFER;

  for (const seg of segments(c)) {
    // Redirection is checked first: `echo x > CLAUDE.md` mutates despite a benign verb.
    const redirect = checkRedirection(seg);
    if (redirect) return redirect;

    const [rawVerb, rest] = head(seg);
    const verb = normalizeVerb(rawVerb);

    if (verb === 'git') {
      const gitVerdict = checkGit(rest);
      if (gitVerdict) return gitVerdict;
      continue;
    }

    if (READ_ONLY.has(verb)) continue;

    if (verb === 'sed') {
      if (/(^|\s)-[A-Za-z]*i/.test(rest)) {
        const hit = checkTargets(rest, 'In-place edit of');
        if (hit) return hit;
      }
      continue;
    }

    if (POSIX_MUTATORS.has(verb) || PS_MUTATORS.has(verb) || PS_ALIASES.has(verb)) {
      const hit = checkTargets(rest, 'Command may create, overwrite, move, rename, or delete');
      if (hit) return hit;
      continue;
    }

    if (SCRIPT_RUNNERS.has(verb) && hasScriptMutation(rest)) {
      const hit = checkTargets(rest, 'Script command may write to or delete');
      if (hit) return hit;
      continue;
    }
  }

  return DEFER;
}

function decide(payload) {
  const tool = payload && payload.tool_name;
  if (!tool) return DEFER;
  const input = (payload && payload.tool_input) || {};

  if (tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit') {
    const target = input.file_path != null ? input.file_path : input.notebook_path;
    if (target == null || String(target).trim() === '') {
      // Validly parsed mutation payload with no target: malformed, not benign.
      return {
        decision: 'ask',
        reason: `${tool} request is missing its required target path. `
          + 'A mutation request that cannot be checked against the protected surfaces '
          + 'requires explicit owner approval.',
      };
    }
    return classifyPath(target, `${tool} on`);
  }

  if (tool === 'Bash') {
    return classifyBash(String(input.command || ''));
  }

  return DEFER;
}

function classifyPath(filePath, verb) {
  return classifyRel(resolveTarget(filePath), verb);
}

/* ------------------------------------------------------------------ *
 * I/O
 * ------------------------------------------------------------------ */

function emit(result) {
  if (!result || result.decision === 'defer') {
    process.exit(0);
  }
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: result.decision,
      permissionDecisionReason: `[FuturoOS governance guard] ${result.reason}`,
    },
  }));
  process.exit(0);
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', () => {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    // Unparseable input fails OPEN so a malformed payload can never break ordinary
    // work, but it is reported rather than silently swallowed.
    process.stderr.write('[FuturoOS governance guard] malformed hook input; deferring.\n');
    process.exit(0);
  }
  try {
    emit(decide(payload));
  } catch (err) {
    process.stderr.write(`[FuturoOS governance guard] internal error; deferring: ${err && err.message}\n`);
    process.exit(0);
  }
});
