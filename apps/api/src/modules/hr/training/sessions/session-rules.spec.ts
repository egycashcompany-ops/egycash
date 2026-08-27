// The two rules that decide whether a session moves and whether somebody fits in it.
import { describe, expect, it } from 'vitest';
import { TRAINING_SESSION_STATUSES, type TrainingSessionStatus } from '@ecms/contracts';
import { acceptsEnrollments, canTransition, hasSeat, seatsLeft, TARGET_OF } from './session-rules';

describe('the session state machine (§4)', () => {
  it('lets a scheduled session start or be cancelled, and nothing else', () => {
    expect(canTransition('scheduled', 'running')).toBe(true);
    expect(canTransition('scheduled', 'cancelled')).toBe(true);
    expect(canTransition('scheduled', 'completed')).toBe(false);
  });

  /** The day happened and qualified nobody. That is an outcome, not an error to refuse. */
  it('lets a running session be cancelled as well as completed', () => {
    expect(canTransition('running', 'completed')).toBe(true);
    expect(canTransition('running', 'cancelled')).toBe(true);
  });

  /**
   * Both terminal states are terminal in the strong sense. Re-completing would write the immutable
   * records a second time (D7); re-opening a cancelled session would resurrect enrollments that
   * were told not to come.
   */
  it.each(['completed', 'cancelled'] as const)('lets nothing leave %s', (from) => {
    for (const to of TRAINING_SESSION_STATUSES) {
      expect(canTransition(from, to), `${from} → ${to}`).toBe(false);
    }
  });

  /** Every action names a status the machine knows, so no action can ask for a state that is not one. */
  it('maps every action onto a real status', () => {
    for (const target of Object.values(TARGET_OF)) {
      expect(TRAINING_SESSION_STATUSES).toContain(target);
    }
  });

  it('only takes enrollments while the session is still ahead of or in progress', () => {
    const open = TRAINING_SESSION_STATUSES.filter((s: TrainingSessionStatus) =>
      acceptsEnrollments(s),
    );
    expect(open).toEqual(['scheduled', 'running']);
  });
});

describe('seats (D5)', () => {
  it('counts down from the capacity', () => {
    expect(seatsLeft(10, 4)).toBe(6);
    expect(seatsLeft(10, 10)).toBe(0);
  });

  /**
   * UNLIMITED IS NOT ZERO. A session created without a capacity is one nobody has counted seats
   * for; reading that as «full» would refuse every nomination while looking like a fault.
   */
  it('answers null — not zero — when nobody set a capacity', () => {
    expect(seatsLeft(null, 40)).toBeNull();
    expect(hasSeat(null, 40)).toBe(true);
  });

  /** A capacity lowered below the people already in the room is a real state. */
  it('never reports a negative number of seats', () => {
    expect(seatsLeft(5, 9)).toBe(0);
    expect(hasSeat(5, 9)).toBe(false);
  });

  it('fits one more exactly while one is left', () => {
    expect(hasSeat(10, 9)).toBe(true);
    expect(hasSeat(10, 10)).toBe(false);
  });
});
