# Vendored: Elephant-Goldfish Model (EGM) reviewer personas

Third-party content, kept under its own licence (Apache License 2.0, copy in [LICENSE](LICENSE)).
Not an officially supported Google product.

- **Source:** https://github.com/google/elephant-goldfish-model
- **Commit:** `0dfb5bf3eebd551d1e805c3ab16cbaa9b1c2c42a` (2026-11-04), plugin version 0.1.0.
- **Copied unchanged:**
  - `agents/` — seven reviewer personas, upstream `agents/`: comprehension, zoom_out,
    design_critic, structural, style, codebase_details, implementation_readiness;
  - `resources/document_standards/` — the five upstream document standards (the
    `design-review` skill uses three: zoom-out, feature-spec, implementation-readiness).
- **Adapted (modified files, Apache-2.0 §4(b)):** the seven subagent definitions in
  [`.claude/agents/egm-*.md`](../../agents/), from upstream `.claude-plugin/agents/`. The only
  change is the path: upstream reads the persona and standards from `${CLAUDE_PLUGIN_ROOT}`, a
  plugin install folder; these read them from this directory. Each file says so in a comment.
- **Not taken:** everything else in the upstream tree:
  - the seven skills (brainstorm, draft, review, review-loop, resolve, bootstrap, drift-report);
  - the synthesizer and bootstrap agents;
  - `resources/execution_instructions.md` and `resources/README.md`;
  - the plugin manifests and icons;
  - the other harness packages (`.cursor-plugin`, `.codex-plugin`, `.plugin`, `com.github.copilot`,
    `adapters/`, `distributions/`);
  - `docs/`, `site/`, scripts, tests, and the policy files.

  ECMS runs the method through two skills of its own, written for this repository:
  - [`design-review`](../../skills/design-review/SKILL.md) dispatches these reviewers;
  - [`drift-check`](../../skills/drift-check/SKILL.md) follows the upstream drift-report method
    and needs no persona.

## Why vendored and not installed as a plugin

Two reasons the files are copied in rather than installed:
- **Cloud sessions skip repository-declared plugins.** Claude Code's docs, read on 2026-11-05,
  say a cloud session (Claude Code on the web) does not install the plugins a repository turns on
  in `.claude/settings.json` (`enabledPlugins`, `extraKnownMarketplaces`). See
  https://code.claude.com/docs/en/cloud-environments.md, "What carries over from your setup".
- **A per-user install does not last.** It lives in the session's container and is gone with it.

Files in the repository load in every session, local or cloud, at the commit the branch is on.
`.prettierignore` excludes this folder, so a repo-wide format cannot alter the "unchanged" copies.

## Updating

Upstream is pre-1.0 and changes often. To take a newer version: copy the same files from the new
commit over these, re-apply the path change to `.claude/agents/egm-*.md` if the adapters changed,
update the commit above, and review the diff like any other change.
