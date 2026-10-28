// A module's own reading of WHO the caller is on ITS routes — and nowhere else.
//
// The context every request carries answers one company-wide question: where the caller is placed
// and what their grants reach. A module can have a reason to answer it differently on its own
// routes. The first one is ATM's, in the owner's words (2026-10-28): «فرع أكتوبر شغال هو والمهندسين
// مع بعض بكل بياناتهم والبيانات دي متسجله إنها المهندسين» — on ATM pages an October employee works
// as a Mohandessin one; on every other page they are still in October. A rule that holds for one
// module's routes cannot be written into the user, their grants or the reach resolution without
// leaking into every other module, so it is applied here, per request, by path.
//
// The same shape as `external-surfaces.ts`: modules PUSH a refiner in at load, keyed by their route
// prefix under `/api/v1`, and this file imports nothing from any module. A refiner receives the
// context AFTER the branch switcher was resolved, so it sees the branch the caller chose, and it
// must return a NEW object rather than edit the one it was given — parts of a context (its reach)
// come from caches, and a refinement that leaked into one would follow the caller onto every route.
import { env } from '../../infrastructure/config/env';
import { type AuthContext } from '../../shared/types';

export type AuthContextRefiner = (ctx: AuthContext) => AuthContext | Promise<AuthContext>;

/** Route prefix under `/api/v1` (e.g. `/atm`) → the refiner its requests pass through. */
const refiners = new Map<string, AuthContextRefiner>();

/**
 * Declare how requests under `prefix` (relative to `/api/v1`, e.g. `/atm`) read the caller. One
 * refiner per prefix — the last registration wins, so a test can install its own.
 */
export const registerAuthContextRefiner = (prefix: string, refine: AuthContextRefiner): void => {
  refiners.set(prefix, refine);
};

/** Path containment that cannot be fooled by a shared prefix: `/atmx` is not under `/atm`. */
const under = (path: string, base: string): boolean => path === base || path.startsWith(`${base}/`);

/**
 * A path as Express ROUTES it: its routers ignore case and let a doubled slash through, so
 * `/api/v1/ATM/machines` and `/api/v1//atm/machines` both reach the ATM handlers. Matched as
 * written, either would skip the refiner — and an October employee's write would be filed under
 * October, where Mohandessin never sees it.
 */
const routedPath = (path: string): string => path.toLowerCase().replace(/\/{2,}/g, '/');

/** The context for this request path: refined by every prefix it sits under, else as given. */
export const refineAuthContext = async (ctx: AuthContext, path: string): Promise<AuthContext> => {
  let refined = ctx;
  const routed = routedPath(path);
  for (const [prefix, refine] of refiners) {
    if (under(routed, routedPath(`${env.BASE_PATH}/api/v1${prefix}`))) {
      refined = await refine(refined);
    }
  }
  return refined;
};

/** Test seam — the registry is process-wide and load-populated. */
export const clearAuthContextRefiners = (): void => {
  refiners.clear();
};
