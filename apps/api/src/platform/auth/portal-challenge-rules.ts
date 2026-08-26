// The one-time-code rulebook — PURE. No mongoose, no services, no clock of its own.
//
// Everything a sign-in dispute turns on lives here: whether a fresh code may be sent yet, whether
// the one presented is still good, and what a wrong guess costs. `regularization-rules.ts` is the
// house precedent for this shape, and the reason is the same — a rule that needs a database to
// answer is a rule nobody can check.
//
// `now` is always a parameter. A test that cannot move time is a test that cannot cover expiry,
// and expiry is half of what this file is for.
import {
  PORTAL_CHALLENGE_MAX_ATTEMPTS,
  PORTAL_CHALLENGE_RESEND_COOLDOWN_SECONDS,
} from '@ecms/contracts';

/** The stored side of a challenge. `null` throughout means "no challenge outstanding". */
export interface PortalChallengeState {
  codeHash: string | null;
  expiresAt: Date | null;
  sentAt: Date | null;
  attempts: number;
}

export const EMPTY_PORTAL_CHALLENGE: PortalChallengeState = {
  codeHash: null,
  expiresAt: null,
  sentAt: null,
  attempts: 0,
};

/**
 * How long the caller must wait before another code may be sent, in seconds. Zero means now.
 *
 * The cooldown is measured from the last SEND, not from the last attempt: the thing being rationed
 * is messages to somebody's phone, and a wrong guess does not put one there.
 */
export const resendWaitSeconds = (state: PortalChallengeState, now: Date): number => {
  if (state.sentAt === null) return 0;
  const elapsed = Math.floor((now.getTime() - state.sentAt.getTime()) / 1000);
  const remaining = PORTAL_CHALLENGE_RESEND_COOLDOWN_SECONDS - elapsed;
  return remaining > 0 ? remaining : 0;
};

export const maySend = (state: PortalChallengeState, now: Date): boolean =>
  resendWaitSeconds(state, now) === 0;

/**
 * Why a presented code is refused, or null when it stands.
 *
 * The order matters and is not arbitrary. `expired` is checked before the hash so that a stale
 * code and a wrong code are told apart in the LOG — the caller is told neither, but somebody
 * reading an audit trail should be able to see the difference between a person who was slow and a
 * person who was guessing.
 */
export type PortalChallengeProblem = 'none-outstanding' | 'expired' | 'exhausted' | 'mismatch';

export const verifyProblem = (
  state: PortalChallengeState,
  presentedHash: string,
  now: Date,
): PortalChallengeProblem | null => {
  if (state.codeHash === null || state.expiresAt === null) return 'none-outstanding';
  if (state.expiresAt.getTime() <= now.getTime()) return 'expired';
  // Attempts are counted BEFORE this call, so reaching the cap means the cap is spent.
  if (state.attempts >= PORTAL_CHALLENGE_MAX_ATTEMPTS) return 'exhausted';
  if (state.codeHash !== presentedHash) return 'mismatch';
  return null;
};

/**
 * The state after a failed guess.
 *
 * A wrong code costs an attempt and nothing else — it does not extend the expiry, and it does not
 * reset the cooldown. Once the attempts are spent the code is BURNED (`codeHash: null`) rather
 * than left to be guessed at until it expires on its own.
 */
export const afterFailedAttempt = (state: PortalChallengeState): PortalChallengeState => {
  const attempts = state.attempts + 1;
  if (attempts >= PORTAL_CHALLENGE_MAX_ATTEMPTS) {
    return { ...EMPTY_PORTAL_CHALLENGE, sentAt: state.sentAt, attempts };
  }
  return { ...state, attempts };
};

/**
 * The state after a code is used successfully — nothing left of it.
 *
 * `sentAt` is kept so the cooldown survives a successful sign-in: somebody who signs in and
 * immediately asks for another code is still rationed.
 */
export const afterSuccess = (state: PortalChallengeState): PortalChallengeState => ({
  ...EMPTY_PORTAL_CHALLENGE,
  sentAt: state.sentAt,
});

/** The state after a fresh code goes out: the attempt budget starts over with it. */
export const afterIssue = (codeHash: string, expiresAt: Date, now: Date): PortalChallengeState => ({
  codeHash,
  expiresAt,
  sentAt: now,
  attempts: 0,
});
