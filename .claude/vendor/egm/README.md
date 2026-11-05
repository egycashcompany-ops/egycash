# Vendored: Elephant-Goldfish Model (EGM) reviewer personas

Third-party content, kept under its own licence (Apache License 2.0, copy in [LICENSE](LICENSE)).
Not an officially supported Google product.

- **Source:** https://github.com/google/elephant-goldfish-model
- **Commit:** `0dfb5bf3eebd551d1e805c3ab16cbaa9b1c2c42a` (2026-11-04), plugin version 0.1.0.
- **Copied unchanged:**
  - `agents/` — seven reviewer personas, upstream `agents/`: comprehension, zoom_out,
    design_critic, structural, style, codebase_details, implementation_readiness;
  - `resources/document_standards/` — the five document standards those personas grade against.
- **Adapted (modified files, Apache-2.0 §4(b)):** the seven subagent definitions in
  [`.claude/agents/egm-*.md`](../../agents/), from upstream `.claude-plugin/agents/`. The only
  change is the path: upstream reads the persona and standards from `${CLAUDE_PLUGIN_ROOT}`, a
  plugin install folder; these read them from this directory. Each file says so in a comment.
- **Not taken:** the upstream skills (brainstorm, draft, review, review-loop, resolve, bootstrap,
  drift-report), the synthesizer and bootstrap agents, the docs site, scripts and tests. ECMS runs
  the method through its own skills, written for this repository:
  [`design-review`](../../skills/design-review/SKILL.md) and
  [`drift-check`](../../skills/drift-check/SKILL.md).

## Why vendored and not installed as a plugin

Claude Code on the web (cloud sessions) does not install plugins a repository declares in
`.claude/settings.json` (`enabledPlugins` / `extraKnownMarketplaces`), and a per-user install
lives in the session's container and is gone with it. Files in the repository load in every
session, local or cloud, at the commit the branch is on.

## Updating

Upstream is pre-1.0 and changes often. To take a newer version: copy the same files from the new
commit over these, re-apply the path change to `.claude/agents/egm-*.md` if the adapters changed,
update the commit above, and review the diff like any other change.
