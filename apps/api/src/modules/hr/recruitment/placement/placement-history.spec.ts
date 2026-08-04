// `placementHistory` is an EVENT LOG, not a set of distinct placements or a "current + previous".
//
// The distinction only becomes visible in three situations, and all three are ones a recruiter
// actually hits — which is why they are asserted rather than assumed:
//
//   • same job, different branch      — a set keyed on the job would drop it
//   • same branch, different job      — a set keyed on the branch would drop it
//   • back to a placement held before — a UNIQUE list would drop it, and with it the evidence
//     that someone changed their mind twice
//
// The write itself (`placement.service.ts`) is `[...before.placementHistory, change]`: an append,
// with no lookup into what came before. These cases pin the decision that feeds it.
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { changedDimensions } from '../applicants/placement-resolver';

const TITLE_A = new Types.ObjectId();
const TITLE_B = new Types.ObjectId();
const BRANCH_A = new Types.ObjectId();
const BRANCH_B = new Types.ObjectId();

const at = (jobTitleId: Types.ObjectId | null, branchId: Types.ObjectId | null) => ({
  jobPositionId: null,
  jobTitleId,
  departmentId: null,
  sectionId: null,
  branchId,
});

/** The service appends whenever at least one dimension moved. */
const records = (from: ReturnType<typeof at>, to: ReturnType<typeof at>): boolean =>
  changedDimensions(from, to).length > 0;

describe('placement history records every move', () => {
  it('records a branch move that keeps the same job', () => {
    expect(changedDimensions(at(TITLE_A, BRANCH_A), at(TITLE_A, BRANCH_B))).toEqual(['branch']);
    expect(records(at(TITLE_A, BRANCH_A), at(TITLE_A, BRANCH_B))).toBe(true);
  });

  it('records a job move that keeps the same branch', () => {
    expect(changedDimensions(at(TITLE_A, BRANCH_A), at(TITLE_B, BRANCH_A))).toEqual(['title']);
    expect(records(at(TITLE_A, BRANCH_A), at(TITLE_B, BRANCH_A))).toBe(true);
  });

  it('records a return to a placement the candidate held before', () => {
    // A → B → A. The third move is compared against where they stand NOW (B), never against the
    // log, so coming back is an event of its own and the log reads A→B, B→A.
    const first = changedDimensions(at(TITLE_A, BRANCH_A), at(TITLE_B, BRANCH_B));
    const back = changedDimensions(at(TITLE_B, BRANCH_B), at(TITLE_A, BRANCH_A));
    expect(first).toEqual(['title', 'branch']);
    expect(back).toEqual(['title', 'branch']);
    expect(records(at(TITLE_B, BRANCH_B), at(TITLE_A, BRANCH_A))).toBe(true);
  });

  it('records a move that fills in a placement the candidate never had', () => {
    expect(records(at(null, null), at(TITLE_A, BRANCH_A))).toBe(true);
    // …and one that clears it again.
    expect(records(at(TITLE_A, BRANCH_A), at(null, null))).toBe(true);
  });

  it('writes nothing only when the submitted placement is the one already held', () => {
    // Not a suppressed event — nothing moved. Anything else here would mean re-submitting a form
    // unchanged left a false trail in the candidate's history.
    expect(changedDimensions(at(TITLE_A, BRANCH_A), at(TITLE_A, BRANCH_A))).toEqual([]);
    expect(records(at(TITLE_A, BRANCH_A), at(TITLE_A, BRANCH_A))).toBe(false);
  });

  it('names every dimension that moved, so one change is one grouped entry', () => {
    // Both moved at once: one entry carrying both, not two entries racing for the same instant.
    expect(changedDimensions(at(TITLE_A, BRANCH_A), at(TITLE_B, BRANCH_B))).toEqual(['title', 'branch']);
  });

  it('compares ids by value — two ObjectIds for the same row are the same placement', () => {
    // `same()` uses `.equals`; reference equality here would log a move on every save.
    const copy = new Types.ObjectId(TITLE_A.toHexString());
    expect(records(at(TITLE_A, BRANCH_A), at(copy, BRANCH_A))).toBe(false);
  });
});
