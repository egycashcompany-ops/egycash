// A one-time code that lets an EXTERNAL subject sign in without a password (P-HR-APP §4).
//
// WHY THIS EXISTS AT ALL. An applicant signs in with their national ID and their mobile number,
// and neither of those is a secret: the number is on every form they fill in, and the mobile is
// known to anyone who has dealt with them. Those two alone would let a colleague, a relative, or
// anybody who has seen the card open the file, read the stage, and upload identity documents in
// that person's name. The code makes knowing the two numbers insufficient — it has to arrive on
// the mobile the company already holds on record.
//
// AND WHY NOT A PASSWORD. A candidate uses this a handful of times over a few weeks. A password is
// a thing to forget, to reset, and to reuse from somewhere else; a code sent to a number that is
// already on file is none of those.
//
// The mechanism is deliberately generic — a challenge belongs to a USER, not to an applicant — so
// a second external population can use it by registering its own resolver. Nothing here names HR.
import { z } from 'zod';

/**
 * The policy, in one place because every one of these numbers is a security trade-off.
 *
 * Six digits and ten minutes is the shape people already expect from a bank; five attempts is
 * enough for a mistyped digit and far short of guessing one in a million; sixty seconds between
 * sends stops the endpoint being a way to make somebody's phone buzz all afternoon.
 */
export const PORTAL_CHALLENGE_CODE_LENGTH = 6;
export const PORTAL_CHALLENGE_TTL_MINUTES = 10;
export const PORTAL_CHALLENGE_MAX_ATTEMPTS = 5;
export const PORTAL_CHALLENGE_RESEND_COOLDOWN_SECONDS = 60;

/** Numeric, fixed length — the shape a keypad produces and a message can carry. */
export const PortalChallengeCodeSchema = z
  .string()
  .trim()
  .regex(new RegExp(`^[0-9]{${PORTAL_CHALLENGE_CODE_LENGTH}}$`), {
    message: `must be ${PORTAL_CHALLENGE_CODE_LENGTH} digits`,
  });

/**
 * Starting a challenge.
 *
 * The two identifiers are what the candidate knows; the module that owns the population turns them
 * into a user. This schema does NOT name a national ID, because the platform does not know what an
 * applicant is — see the resolver seam.
 */
export const StartPortalChallengeSchema = z
  .object({
    subjectType: z.string().min(1).max(50),
    identifier: z.string().trim().min(1).max(100),
    phone: z.string().trim().min(1).max(30),
  })
  .strict();
export type StartPortalChallenge = z.infer<typeof StartPortalChallengeSchema>;

export const CompletePortalChallengeSchema = StartPortalChallengeSchema.extend({
  code: PortalChallengeCodeSchema,
}).strict();
export type CompletePortalChallenge = z.infer<typeof CompletePortalChallengeSchema>;

/**
 * What starting a challenge answers — and what it deliberately does NOT.
 *
 * ONE SHAPE FOR EVERY OUTCOME. Whether the identifiers matched nobody, matched somebody with no
 * portal, or matched somebody whose application was refused, the answer is the same: "if that
 * matched an account, a code is on its way." Anything else turns this endpoint into a way to ask
 * the company whether a given national ID belongs to somebody who applied here and was refused.
 *
 * `retryAfterSeconds` is the one thing that varies, and only because a caller who is being asked to
 * wait needs to know how long. It says nothing about whether an account exists — it is returned on
 * the cooldown path for any identifier.
 */
export interface PortalChallengeStartedDto {
  /** Always the same sentence, whatever happened. The client shows it verbatim. */
  accepted: true;
  retryAfterSeconds: number;
}
