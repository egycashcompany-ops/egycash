// React error #310, and the shape that caused it.
//
// WHY A SOURCE-READING TEST. The failure is a SECOND render of the same component: the first
// returns early on `isLoading` and never reaches the hook, the second runs one hook more, and
// React refuses the mismatch. This harness renders to static markup — one render, never a
// re-render — so no test it can run will ever reach the moment the mismatch exists. The defect is
// therefore only observable statically, which is what `rules-of-hooks` (now an error in
// eslint.config.js) does across the whole app, and what this pins for the five pages it actually
// bit: a person's file opened from a queue.
//
// Both checks below fail against the code as it stood before this change.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RECRUITMENT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The five detail pages that draw a candidate's standing beside their record. */
const PAGES = [
  'applicants/pages/ApplicantDetailPage.tsx',
  'evaluations/pages/EvaluationDetailPage.tsx',
  'interviews/pages/InterviewDetailPage.tsx',
  'job-offers/pages/JobOfferDetailPage.tsx',
  'screening/pages/ScreeningDetailPage.tsx',
];

const source = (page: string): string => readFileSync(join(RECRUITMENT, page), 'utf8');

describe('the candidate step bar cannot reintroduce React #310', () => {
  it('reads all five pages', () => {
    for (const page of PAGES) expect(source(page).length).toBeGreaterThan(500);
  });

  it('no page calls useWorkflowState itself — the hook lives behind a component boundary', () => {
    // Every one of these pages guards on `isLoading` with an early return, and the applicant id
    // the hook needs only exists after that guard. So a `useWorkflowState` call in these files is
    // a conditional hook by construction, whatever order the lines happen to sit in today.
    const offenders = PAGES.filter((page) => source(page).includes('useWorkflowState'));
    expect(offenders).toEqual([]);
  });

  it('each renders ApplicantStepBar, which is what owns the hook now', () => {
    for (const page of PAGES) {
      expect(source(page), page).toMatch(/<ApplicantStepBar\s+applicantId=/);
    }
  });

  it('and ApplicantStepBar calls the hook unconditionally, with no early return above it', () => {
    const bar = source('shared/ApplicantStepBar.tsx');
    const hookAt = bar.indexOf('useWorkflowState(');
    expect(hookAt).toBeGreaterThan(-1);
    // Nothing may return before the hook: that is the entire property this component exists for.
    const body = bar.slice(bar.indexOf('): JSX.Element => {'), hookAt);
    expect(body).not.toMatch(/\breturn\b/);
  });
});
