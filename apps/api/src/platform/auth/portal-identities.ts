// How the platform turns two numbers a candidate typed into an account — WITHOUT knowing what a
// candidate is.
//
// The applicant portal signs in with a national ID and a mobile. The platform has neither concept:
// it holds users, and a national ID belongs to whatever module owns that population. So the module
// PUSHES a resolver in at boot and the platform asks it, the same dependency direction
// `external-surfaces.ts` and `file-authorizers.ts` already established. Nothing in this folder
// imports a module, and a module that forgets to register simply cannot sign anybody in — the
// fail-closed answer.
//
// THE RESOLVER ANSWERS ONE QUESTION AND RETURNS ONE THING: a user id, or null. It does not say why
// null — not "no such person", not "they were refused", not "they have no portal". That is
// deliberate and it is the whole reason the sign-in endpoint can give one undistinguishing answer:
// the platform never learns enough to leak a difference it does not have.
import { type UserDoc } from '../users';

/** What a candidate typed. Both are theirs to know; neither is a secret (P-HR-APP §4). */
export interface PortalIdentityQuery {
  identifier: string;
  phone: string;
}

/**
 * `subjectType` → the module's answer to "which account is this, if any".
 *
 * Returning null is the ONLY failure mode. A resolver that throws is a bug in the module, and the
 * caller treats it as null rather than letting it change what the sign-in screen says.
 */
export type PortalIdentityResolver = (query: PortalIdentityQuery) => Promise<UserDoc | null>;

const resolvers = new Map<string, PortalIdentityResolver>();

export const registerPortalIdentityResolver = (
  subjectType: string,
  resolver: PortalIdentityResolver,
): void => {
  resolvers.set(subjectType, resolver);
};

/**
 * Resolve, or null. Never throws, whatever the module does.
 *
 * An unregistered subject type and a module that blew up are the same answer here, because they
 * are the same answer to the person at the keyboard: nothing happened that tells them anything.
 */
export const resolvePortalIdentity = async (
  subjectType: string,
  query: PortalIdentityQuery,
): Promise<UserDoc | null> => {
  const resolver = resolvers.get(subjectType);
  if (resolver === undefined) return null;
  return resolver(query).catch(() => null);
};

/** Test seam — the registry is process-wide and boot-populated. */
export const clearPortalIdentityResolvers = (): void => {
  resolvers.clear();
};
