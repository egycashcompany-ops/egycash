---
name: design-review
description: >-
  Review an ECMS design document or ADR with fresh-context "goldfish" reviewers (the
  Elephant-Goldfish Model method) before it is implemented, or check an implemented design
  against the code. Use for new modules and phases (OPS cash-in-transit, gold vault phase 2), new
  ADRs, and changes to auth, RBAC, files, migrations or deploy. Not for bug fixes, UI tweaks, or
  performance work driven by measurements.
---

# Design review with fresh-context reviewers

The author of a design (the agent that wrote it with the owner) knows too much to see what the
page leaves out. A reviewer that starts with **only the document and the files it names** — no
conversation, no reasoning — reads it the way the next engineer, or the next session, will. This
is the review half of Google's Elephant-Goldfish Model (EGM), run the ECMS way. The reviewer
personas and their standards are vendored under `.claude/vendor/egm/` (Apache-2.0, see its
README); the subagents are `.claude/agents/egm-*.md`.

## When to run it, and how much of it

| Situation | Preset | Reviewers (subagent types) |
|---|---|---|
| New module or phase design, new ADR, platform contract change, auth/RBAC/files/migrations/deploy | **Full** | Stage A `egm-zoom-out` → Stage B `egm-comprehension` → Stage C `egm-design` + `egm-structural` + `egm-style` → Stage D `egm-zoom-out` → Stage E `egm-implementation-readiness` + `egm-codebase-details` + `egm-style` |
| A slice plan that a later session will implement | **Plan check** | Stage E only |
| A design already merged: does the page still describe the code? | **Accuracy check** | `egm-codebase-details` + `egm-implementation-readiness` on the whole doc, then the [`drift-check`](../drift-check/SKILL.md) skill on the same doc |

Bug fixes, UI tweaks, owner-led iterations on samples, measured performance work, and legacy
ports whose rule is "do not redesign" get no design review — the tests and the code review are the
check. Full costs 9 reviewer runs plus verification, on the session's model: use it where a wrong
design is expensive.

## Run it

1. **Ranges.** `Whole doc` for zoom-out. Split the rest at the implementation-plan heading
   (`Implementation plan`, `PR plan`, `Phases`, `OP-1…`): **feature range** above it, **detailed
   range** from it down. A doc with no plan has no detailed range: skip Stage E and say so.
2. **Context list** (the "GoldfishContext"). Name every file a fresh reader needs and nothing
   else: the ADRs and designs the doc cites, the code paths it touches, `docs/README.md`
   (documentation rules). Never pass the conversation, your own notes or your reasoning.
3. **Standards per reviewer** (paths from the repository root):
   - `egm-zoom-out`: `.claude/vendor/egm/resources/document_standards/zoom-out-standard.md`
   - `egm-design`, `egm-structural`: `…/feature-spec-standard.md`
   - `egm-implementation-readiness`, `egm-codebase-details`: `…/implementation-readiness-standard.md`
   - `egm-comprehension`, `egm-style`: none beyond their persona.
4. **Dispatch.** One Agent call per reviewer with `subagent_type` set to the name above; the
   reviewers of one stage run in parallel, stages run in order (A→E). If the session started
   before `.claude/agents/egm-*.md` existed and the types are missing, use a general-purpose agent
   and tell it to read `.claude/agents/<name>.md` and follow it, read-only. Each task names: the
   target file and range, the standard, the context list, and this ECMS note —
   > ECMS docs open with the owner's decisions (his Arabic quoted in «»), are written in English,
   > and ADRs are immutable (changed only by a new ADR or a dated amendment). Judge the substance
   > against the standard; the absence of EGM's own template headings is not by itself a finding.
   > Return findings as a list: severity, title, detail, evidence (path:line), section.
   Reviewers write no files; their findings come back in the reply.
5. **Verify before acting — every time.** In the trial on the passkey design (2026-11-05) half the
   findings were noise or already decided, and two "high" findings were overstated. So merge
   duplicates, then check each finding against the current code and the record (ADRs,
   `docs/10-reviews/technical-debt.md`, `CHANGELOG.md`, the design's own decisions). For many
   findings, use one fresh verifier subagent told to try to refute each one. Keep a finding only
   when it is true today and not already decided or recorded.
6. **Triage** each kept finding (from EGM's resolve step):
   - **PROPOSE FIX** — change the design (or the code, if the design was right and the code drifted);
   - **CONTEST** — the reviewer is wrong, with evidence it could read;
   - **ESCALATE** — the answer is a business decision: ask the owner in Arabic, in plain words,
     one question at a time, with your recommendation first;
   - **DECLINE** — true but not worth the change; say why.
   Do not add context to the doc only to satisfy a reviewer.
7. **Re-run** a stage whose fixes changed the doc materially, once. A finding that returns after
   that becomes an owner question or an entry in `technical-debt.md`.
8. **Record** the review in the design doc itself: a short `Review` section with the date, preset,
   number of findings kept / fixed / contested / declined, and anything escalated with the owner's
   answer. Never edit an ADR's decision to fold a fix in: write a dated amendment or a new ADR.
9. **Tell the owner** in Arabic: what the review found that matters to him, what changed, and any
   question he must answer. No reviewer jargon.

## Files

- Reviewer working notes and merged findings go in the session scratchpad, never in the
  repository root (the cloud session's stop check would push them into a commit).
- The design lives where ECMS keeps it: `docs/12-planning/<feature>-design.md`; ADRs in
  `docs/03-decisions/ADR-0NN-*.md` with a row in its README.
