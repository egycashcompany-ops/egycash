// The approval machine, the two-person rule, and what still counts as a taken seat.
import { describe, expect, it } from 'vitest';
import {
  TRAINING_ENROLLMENT_STATUSES,
  TRAINING_NOMINATION_STATUSES,
  type TrainingNominationStatus,
} from '@ecms/contracts';
import {
  canTransition,
  isPending,
  mayCancelEnrollment,
  mayDecide,
  occupiesSeat,
} from './nomination-rules';

describe('the approval machine (D3)', () => {
  it('submits a draft, and lets it be taken back', () => {
    expect(canTransition('draft', 'pendingApproval')).toBe(true);
    expect(canTransition('draft', 'withdrawn')).toBe(true);
    // A draft nobody has submitted cannot be decided — there is nothing in front of anybody yet.
    expect(canTransition('draft', 'approved')).toBe(false);
    expect(canTransition('draft', 'rejected')).toBe(false);
  });

  it('decides or withdraws a pending nomination', () => {
    expect(canTransition('pendingApproval', 'approved')).toBe(true);
    expect(canTransition('pendingApproval', 'rejected')).toBe(true);
    expect(canTransition('pendingApproval', 'withdrawn')).toBe(true);
  });

  /**
   * A rejected nomination is not re-decided: somebody nominates again, and the refusal stays on
   * the record as the thing that happened. Re-deciding would leave the timeline saying two
   * different things about one request.
   */
  it.each(['approved', 'rejected', 'withdrawn'] as const)('lets nothing leave %s', (from) => {
    for (const to of TRAINING_NOMINATION_STATUSES) {
      expect(canTransition(from, to), `${from} → ${to}`).toBe(false);
    }
  });

  it('calls exactly one status pending', () => {
    expect(TRAINING_NOMINATION_STATUSES.filter((s: TrainingNominationStatus) => isPending(s))).toEqual([
      'pendingApproval',
    ]);
  });
});

describe('the rule a permission cannot express (D3/D4)', () => {
  it('refuses the nominator their own decision', () => {
    expect(mayDecide('u1', 'u1')).toBe(false);
  });

  it('allows anybody else holding the key', () => {
    expect(mayDecide('u1', 'u2')).toBe(true);
  });

  /**
   * A nomination with no recorded author — a seeded or migrated row — is decidable by anybody
   * holding the key. The alternative is a request nobody can ever answer, which is worse than a
   * two-person rule that cannot find its first person.
   */
  it('does not deadlock a nomination with no author', () => {
    expect(mayDecide(null, 'u1')).toBe(true);
  });
});

describe('what still counts as a taken seat (D5)', () => {
  /**
   * An absent seat was still taken. The person did not come, but nobody else could have been in
   * it — counting it as free would let a session quietly overfill on the day it runs.
   */
  it('frees a seat only when the enrollment is cancelled', () => {
    const freed = TRAINING_ENROLLMENT_STATUSES.filter((s) => !occupiesSeat(s));
    expect(freed).toEqual(['cancelled']);
  });

  it('still counts a seat that was marked absent', () => {
    expect(occupiesSeat('absent')).toBe(true);
    expect(occupiesSeat('excused')).toBe(true);
    expect(occupiesSeat('completed')).toBe(true);
  });

  /** Only a live seat can be taken back. A settled one is history. */
  it('cancels only an enrolled seat', () => {
    const cancellable = TRAINING_ENROLLMENT_STATUSES.filter((s) => mayCancelEnrollment(s));
    expect(cancellable).toEqual(['enrolled']);
  });
});
