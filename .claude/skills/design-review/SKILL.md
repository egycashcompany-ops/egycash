---
name: design-review
description: >-
  Review an ECMS design document or draft ADR with fresh-context "goldfish" reviewers (the
  Elephant-Goldfish Model method) before it is implemented, or check a merged design against the
  code. Use for a new or changed design for a module or phase (OPS cash-in-transit, gold vault
  phase 2), a new ADR, or a design touching auth, RBAC, files, migrations or deploy. Not for bug
  fixes (even in those areas), UI tweaks, measured performance work, or a change with no design
  document.
---

# Design review with fresh-context reviewers

The author of a design (the agent that wrote it with the owner) knows too much to see what the
page leaves out. A reviewer that starts with **only the document and the files it names** — no
conversation, no reasoning — reads it the way the next engineer, or the next session, will. This
is the review half of Google's Elephant-Goldfish Model (EGM), run the ECMS way. The reviewer
personas and their standards are vendored under `.claude/vendor/egm/` (Apache-2.0, see its
README); the subagents are `.claude/agents/egm-*.md`.

## When to run it, and how much of it

Run it on a design document or a draft ADR. A code change with no design document gets the code
review only — never write a design just to have something to review. Bug fixes, UI tweaks,
owner-led iterations on samples, measured performance work, and legacy ports whose rule is "do not
redesign" are out, in every area.

| Situation                                                                                                           | Preset             | Stages, reviewers (subagent types) and the range each reads                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A new or changed design for a module or phase; a new ADR; a design touching auth, RBAC, files, migrations or deploy | **Full**           | A `egm-zoom-out` (whole doc) → B `egm-comprehension` (whole doc, nothing else) → C `egm-design` + `egm-structural` + `egm-style` (feature range) → fixes → D `egm-zoom-out` (whole doc, with A's findings) → E `egm-implementation-readiness` + `egm-codebase-details` + `egm-style` (detailed range) |
| A slice plan, not yet built, that a later session will implement                                                    | **Plan check**     | E only (detailed range)                                                                                                                                                                                                                                                                               |
| A design already merged: does the page still describe the code?                                                     | **Accuracy check** | `egm-codebase-details` (whole doc), then the [`drift-check`](../drift-check/SKILL.md) skill on the same doc                                                                                                                                                                                           |

Cost: Full is 9 reviewer runs per pass on the session's model, up to 18 with the one re-run per
stage that step 7 allows, plus the verifier. EGM's own convergence loop (two clean rounds, up to
five) is not used. Keep Full for designs where a mistake is expensive.

## Run it

1. **Ranges.** The **detailed range** starts at the section that orders the work or names its
   files: a heading such as `Implementation plan`, `PR plan`, `Delivery plan`, `Delivery slices`,
   `Phases`, `Slice …`, `WP-…`, `OP-1…`, or «خطة التنفيذ»; or, failing those, the first section that
   splits the work into PRs. The **feature range** is everything above it. A doc with no such
   section: Plan check and Accuracy check read the whole doc; Full runs Stage E on the whole doc
   when the doc names files, models or endpoints, and otherwise skips E and says so in the record.
2. **Context list** (EGM's "GoldfishContext"), for every stage except B. Name every file a fresh
   reader needs and nothing else: `README.md`, `docs/README.md` (documentation rules), the ADRs and
   designs the doc cites, and the code it touches. When the doc names no files, find them by
   searching for its key symbols (endpoints, model and setting names, error codes) and list what
   you find. Never pass the conversation, your notes or your reasoning — except the one input
   Stage D takes: the path of Stage A's findings.
3. **Standards per reviewer** (paths from the repository root,
   `.claude/vendor/egm/resources/document_standards/`):
   - `egm-zoom-out`: `zoom-out-standard.md`;
   - `egm-design`, `egm-structural`: `feature-spec-standard.md`;
   - `egm-implementation-readiness`, `egm-codebase-details`: `implementation-readiness-standard.md`;
   - `egm-comprehension`, `egm-style`: none beyond their persona.
     The other two vendored standards (`heilmeier`, `re-implementation`) are not used here.
4. **Dispatch.** One Agent call per reviewer, `subagent_type` set to the name above. Reviewers of one
   stage run in parallel; stages run in order. Every task names:
   - `Mode: REVIEW` (every persona branches on it);
   - the target file and its range (start and end lines);
   - the standard, and the context list (except Stage B);
   - this ECMS note:
     > ECMS design docs usually open with the owner's decisions, his Arabic quoted in «»; English is
     > the documentation rule (`docs/README.md`), though some older designs are mostly Arabic; a
     > merged ADR is changed only by a new ADR or a dated amendment. Judge the substance against
     > the standard; the absence of EGM's own template headings is not by itself a finding. Report
     > each finding with severity (Blocker | Major | Nit), title, detail, evidence (path:line) and
     > affected lines — this list replaces the persona's prose layout.
   - For `egm-comprehension` only: the target doc and nothing else, and "first give your two
     paraphrase sections (What this proposes; How the existing system works, per this document),
     then the findings".

   Reviewers write no files; their findings come back in the reply. A reviewer that fails or reports
   an incomplete review is retried once, then recorded as **not run**: a stage with a reviewer not
   run is not complete.

   If a subagent type is not available, for any reason (the session started before these files
   existed, a harness that does not load project agents): use the `Plan` agent type, which cannot
   write files; tell it to read `.claude/agents/<name>.md` and the persona it names and follow them,
   to use only reading and searching, and to run no commands and open no URLs. Note the fallback in
   the record.

5. **Verify each finding.** Merge duplicates, then check each one. Drop a finding only when it
   contradicts:
   - (a) an owner decision quoted in the doc;
   - (b) a merged ADR;
   - (c) an item already in `docs/10-reviews/technical-debt.md`, the `CHANGELOG.md`, or the doc's own
     follow-ups;
   - (d) the current code, for a statement about code that exists.

   The author's own choices are exactly what is under review: they are not "already decided". For
   many findings, one fresh verifier (agent type `Plan`, read-only) told to refute each one and cite
   evidence. In the trial on the passkey design (2026-11-05), 21 findings after merging gave 7 worth
   acting on; about half were noise, and two "high" ones were overstated — this step is what
   separates them.

6. **Triage** every finding left. These categories are adapted from EGM's resolve step:
   - **PROPOSE FIX**: the finding is valid. Change the design, or the code if the design was right
     and the code drifted. A wrong paraphrase from Stage B is always a fix to the doc.
   - **CONTEST**: the reviewer is wrong, and you can cite evidence it could read (a file and symbol,
     or a decision recorded in the doc).
   - **Evidence outside the files** (a verbal owner decision, a convention): write that evidence
     into the doc — the owner's words in «» in the decisions section — then it is a fix.
   - **ESCALATE**: the answer is a business decision. Ask the owner in Arabic, in plain words, one
     question at a time, with your recommendation first. Never ask him an engineering question.
   - **DECLINE**: the finding is a Nit, recorded and not fixed. A Blocker or Major finding is
     fixed, contested with evidence, or escalated, never declined.

   EGM's rules apply as written:
   - a contest must be checkable, and "this was intentional" is not evidence;
   - do not add context only to satisfy a reviewer;
   - do not contest a comprehension gap;
   - do not change a severity (contest it instead);
   - you wrote the document, so a wish to contest is not evidence.

7. **Fix, then go on.** In Full, apply the fixes from Stages A–C before Stage D runs, so that D
   checks what the review added; apply E's fixes after E. Re-run a stage whose fixes changed the
   doc materially, once. Keep a settled list (contested with evidence, or declined): a reviewer
   raising a settled item again does not re-open it. A fixed item raised again does re-open it. A
   real finding still open after the re-run goes into the record as open, with your
   recommendation. It goes to the owner only if it is a business choice, and into `technical-debt.md`
   only once someone has decided to defer it.
8. **Record** the review in the design doc: a short `Review` section with the date, preset,
   reviewers run (and any not run or run by fallback), and findings kept, fixed, contested,
   declined and open, with anything escalated and the owner's answer. A draft ADR under review is
   fixed directly, and its review is recorded in the companion design doc or the PR description. A
   merged ADR's decision is never edited: write a dated amendment (as ADR-016 did) or a new ADR.
9. **Tell the owner** in Arabic what the review found that matters to him, what changed, and any
   question he must answer, without reviewer jargon.

## Files

- Reviewer replies, merged findings and verifier notes go in the scratchpad directory your system
  prompt names; if it names none, in a new directory under `$TMPDIR`. Never inside the repository —
  in a cloud session the stop check would push a stray file into a commit.
- The design lives where ECMS keeps it: `docs/12-planning/<feature>-design.md`; ADRs in
  `docs/03-decisions/ADR-0NN-*.md` with a row in its README.
