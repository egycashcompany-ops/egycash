// The one-time-code rules, settled without a database.
//
// These cover the four things that decide whether this mechanism is worth having: a code expires,
// a wrong guess costs something, guesses run out, and messages to somebody's phone are rationed.
import { describe, expect, it } from 'vitest';
import {
  PORTAL_CHALLENGE_MAX_ATTEMPTS,
  PORTAL_CHALLENGE_RESEND_COOLDOWN_SECONDS,
} from '@ecms/contracts';
import {
  EMPTY_PORTAL_CHALLENGE,
  afterFailedAttempt,
  afterIssue,
  afterSuccess,
  maySend,
  resendWaitSeconds,
  verifyProblem,
  type PortalChallengeState,
} from './portal-challenge-rules';

const T0 = new Date('2026-08-26T12:00:00.000Z');
const at = (seconds: number): Date => new Date(T0.getTime() + seconds * 1000);

const issued = (over: Partial<PortalChallengeState> = {}): PortalChallengeState => ({
  ...afterIssue('hash-of-123456', at(600), T0),
  ...over,
});

describe('rationing the messages', () => {
  it('lets the first code go out immediately', () => {
    expect(maySend(EMPTY_PORTAL_CHALLENGE, T0)).toBe(true);
    expect(resendWaitSeconds(EMPTY_PORTAL_CHALLENGE, T0)).toBe(0);
  });

  it('makes the next one wait the cooldown', () => {
    const state = issued();
    expect(maySend(state, T0)).toBe(false);
    expect(resendWaitSeconds(state, T0)).toBe(PORTAL_CHALLENGE_RESEND_COOLDOWN_SECONDS);
    expect(resendWaitSeconds(state, at(1))).toBe(PORTAL_CHALLENGE_RESEND_COOLDOWN_SECONDS - 1);
  });

  it('opens up the moment the cooldown is spent', () => {
    const state = issued();
    expect(maySend(state, at(PORTAL_CHALLENGE_RESEND_COOLDOWN_SECONDS))).toBe(true);
    expect(resendWaitSeconds(state, at(PORTAL_CHALLENGE_RESEND_COOLDOWN_SECONDS + 5))).toBe(0);
  });

  it('rations from the last SEND, not the last guess — a wrong code puts no message on a phone', () => {
    const guessed = afterFailedAttempt(issued());
    expect(resendWaitSeconds(guessed, at(10))).toBe(PORTAL_CHALLENGE_RESEND_COOLDOWN_SECONDS - 10);
  });

  it('keeps rationing after a successful sign-in', () => {
    const used = afterSuccess(issued());
    expect(used.codeHash).toBeNull();
    expect(maySend(used, at(5))).toBe(false);
  });
});

describe('verifying a presented code', () => {
  it('accepts the right code inside its life', () => {
    expect(verifyProblem(issued(), 'hash-of-123456', at(60))).toBeNull();
  });

  it('refuses when there is nothing outstanding', () => {
    expect(verifyProblem(EMPTY_PORTAL_CHALLENGE, 'anything', T0)).toBe('none-outstanding');
    // A burned code is "nothing outstanding" too, not a mismatch.
    expect(verifyProblem(afterSuccess(issued()), 'hash-of-123456', at(60))).toBe('none-outstanding');
  });

  it('refuses an expired code, and says so distinctly from a wrong one', () => {
    expect(verifyProblem(issued(), 'hash-of-123456', at(600))).toBe('expired');
    expect(verifyProblem(issued(), 'hash-of-123456', at(601))).toBe('expired');
    // Slow is not the same as guessing, and the log should be able to tell them apart.
    expect(verifyProblem(issued(), 'wrong', at(60))).toBe('mismatch');
  });

  it('refuses once the attempts are spent', () => {
    const spent = issued({ attempts: PORTAL_CHALLENGE_MAX_ATTEMPTS });
    expect(verifyProblem(spent, 'hash-of-123456', at(60))).toBe('exhausted');
  });

  it('checks expiry before the hash — a stale RIGHT code is expired, not a mismatch', () => {
    expect(verifyProblem(issued({ attempts: 99 }), 'hash-of-123456', at(9999))).toBe('expired');
  });
});

describe('what a wrong guess costs', () => {
  it('one attempt, and nothing else', () => {
    const before = issued();
    const after = afterFailedAttempt(before);
    expect(after.attempts).toBe(1);
    expect(after.codeHash).toBe(before.codeHash);
    expect(after.expiresAt).toEqual(before.expiresAt);
    expect(after.sentAt).toEqual(before.sentAt);
  });

  it('burns the code when the budget runs out, rather than leaving it to be guessed at', () => {
    let state = issued();
    for (let i = 0; i < PORTAL_CHALLENGE_MAX_ATTEMPTS; i += 1) state = afterFailedAttempt(state);
    expect(state.attempts).toBe(PORTAL_CHALLENGE_MAX_ATTEMPTS);
    expect(state.codeHash).toBeNull();
    expect(state.expiresAt).toBeNull();
    // …and the cooldown is still in force, so burning it is not a way to get a fresh one early.
    expect(state.sentAt).not.toBeNull();
    expect(maySend(state, at(5))).toBe(false);
  });
});

describe('issuing', () => {
  it('starts the attempt budget over with every fresh code', () => {
    const spent = issued({ attempts: 4 });
    const fresh = afterIssue('hash-of-654321', at(1200), at(600));
    expect(spent.attempts).toBe(4);
    expect(fresh.attempts).toBe(0);
    expect(fresh.codeHash).toBe('hash-of-654321');
    expect(fresh.sentAt).toEqual(at(600));
  });
});
