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
 * defense-in-depth, not a replacement.
 *
 * Contract: reads the PreToolUse JSON payload on stdin, emits a permissionDecision.
 * Fails OPEN (defer) on any unexpected input so ordinary application work is never
 * broken by a hook error.
 */

'use strict';

const DEFER = { decision: 'defer', reason: '' };

function decide(payload) {
  const tool = payload && payload.tool_name;
  const input = (payload && payload.tool_input) || {};
  if (!tool) return DEFER;

  if (tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit') {
    return classifyPath(input.file_path, `${tool} on`);
  }

  if (tool === 'Bash') {
    return classifyBash(String(input.command || ''));
  }

  return DEFER;
}

/** Normalize an absolute or relative path to a repo-root-relative POSIX path. */
function toRepoRelative(p) {
  if (!p) return null;
  let s = String(p).replace(/\\/g, '/');
  const root = String(process.env.CLAUDE_PROJECT_DIR || process.cwd()).replace(/\\/g, '/');
  const lower = s.toLowerCase();
  const rootLower = root.toLowerCase();
  if (lower.startsWith(rootLower)) s = s.slice(root.length);
  return s.replace(/^\/+/, '').replace(/^\.\//, '');
}

function classifyPath(filePath, verb) {
  const rel = toRepoRelative(filePath);
  if (!rel) return DEFER;

  if (rel.startsWith('.claude/agent-backups/')) {
    return { decision: 'deny', reason: `${verb} an existing agent-backup file. Backups are immutable evidence.` };
  }
  if (rel.startsWith('.git/')) {
    return { decision: 'deny', reason: `${verb} Git internals (including .git/info/exclude) is prohibited.` };
  }
  if (rel.startsWith('.claude/') || rel === 'CLAUDE.md' || rel === '.gitignore') {
    return { decision: 'ask', reason: `${verb} a protected governance/configuration surface (${rel}). Requires explicit owner approval.` };
  }
  return DEFER;
}

/**
 * Protected surfaces as they appear in an ARGUMENT LIST.
 * Deliberately applied only to a command's own arguments — never to the whole
 * command line — so that read-only commands merely *mentioning* these names
 * (grep, node -e, echo, documentation) are not falsely blocked.
 */
const PROTECTED_ARG = /(^|[\s"'=])(\.\/)?(\.claude(\/|\s|$)|CLAUDE\.md|\.gitignore|\.git\/)/i;

/** Split a command line into independently-executed segments. */
function segments(cmd) {
  return cmd.split(/(?:&&|\|\||[;|\n])/g).map((s) => s.trim()).filter(Boolean);
}

/** Strip leading env-var assignments and return [verb, argString] for a segment. */
function head(segment) {
  const s = segment.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*/, '');
  const m = s.match(/^(\S+)\s*([\s\S]*)$/);
  return m ? [m[1], m[2]] : [s, ''];
}

function classifyBash(cmd) {
  const c = String(cmd || '').trim();
  if (!c) return DEFER;

  for (const seg of segments(c)) {
    const [verb, rest] = head(seg);

    // git ... — only inspect the arguments of an actual `git add` invocation.
    if (/^git$/i.test(verb)) {
      const addArgs = rest.match(/^add\s+([\s\S]*)$/i);
      if (addArgs) {
        const args = addArgs[1];
        if (/(^|\s)(-[A-Za-z]*[AfF][A-Za-z]*|--all|--force)(\s|$)/.test(args)) {
          return { decision: 'deny', reason: 'Broad or forced git staging (-A / --all / -f / --force) is prohibited.' };
        }
        if (/(^|\s)(\.|\.\/|\*)(\s|$)/.test(args)) {
          return { decision: 'deny', reason: 'Whole-tree or wildcard staging (git add . / git add *) is prohibited.' };
        }
        if (PROTECTED_ARG.test(args)) {
          return { decision: 'deny', reason: 'Staging a protected governance/configuration surface is prohibited; these paths are locally excluded and must remain untracked.' };
        }
      }
      continue;
    }

    // Movement / rename / deletion targeting a protected surface.
    if (/^(rm|mv|rmdir|ren|rename|del|erase)$/i.test(verb) && PROTECTED_ARG.test(rest)) {
      return { decision: 'ask', reason: 'Command may move, rename, or delete a protected governance/configuration surface. Requires explicit owner approval.' };
    }

    // Redirection that would overwrite a protected surface.
    if (/>\s*("|')?(\.\/)?(\.claude\/|CLAUDE\.md|\.gitignore)/i.test(seg)) {
      return { decision: 'ask', reason: 'Command may overwrite a protected governance/configuration surface via redirection. Requires explicit owner approval.' };
    }
  }

  return DEFER;
}

function emit(result) {
  if (result.decision === 'defer') {
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
    process.exit(0); // fail open
  }
  try {
    emit(decide(payload));
  } catch {
    process.exit(0); // fail open
  }
});
