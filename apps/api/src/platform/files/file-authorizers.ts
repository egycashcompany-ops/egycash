// Entity-derived file authorization (ADR-023).
//
// The Files service can answer "is this file private?" but never "may you see the thing it belongs
// to?" — that question belongs to the module that owns the entity. This is the seam where a module
// answers it: it registers an authorizer per entity type at boot, and the service consults it on
// every path that reaches file data or bytes.
//
// **Dependency direction.** Modules PUSH authorizers in at boot; this file imports nothing from
// any module and the Files service imports nothing from any module either. That is what keeps the
// platform → module direction acyclic while letting the platform ask a module a question.
//
// **Why not in `@ecms/contracts`.** The interface carries an `AuthContext` and a function. Both
// are API-side concerns, and no client ever sees this type — putting it in the contracts package
// would invert the dependency for no gain.
import { logger } from '../../infrastructure/logging/logger';
import { type AuthContext } from '../../shared/types';

/** What the caller wants to do with the file. Reads cover metadata AND bytes. */
export type FileAccessIntent = 'read' | 'write';

export interface FileEntityAuthorizer {
  /** The module-local entity type, e.g. `ticket` or `ticketComment`. */
  entityType: string;
  /**
   * May this caller reach files owned by this entity?
   *
   * Returning `false` — or throwing — denies. An authorizer is pure authorization: it answers a
   * question, it does not mutate, and its answer is never cached across requests.
   */
  authorize(input: {
    ctx: AuthContext;
    entityId: string;
    intent: FileAccessIntent;
  }): Promise<boolean>;
}

/**
 * The budget one authorizer gets (ADR-023). Exceeding it DENIES — a slow answer is not a yes, and
 * what this exists to catch is a HUNG module stalling every file read in the system.
 *
 * The ticket-comment authorizer makes two sequential indexed lookups, so this is not enormous
 * headroom. If a denial ever shows `cause: 'timeout'` in the logs, that is the signal to revisit
 * the number — not a reason to raise it pre-emptively.
 */
export const AUTHORIZER_TIMEOUT_MS = 200;

const key = (moduleId: string, entityType: string): string => `${moduleId}/${entityType}`;

const registry = new Map<string, FileEntityAuthorizer>();

/**
 * Register one module's authorizers, as a SET — the shape a manifest declares them in.
 *
 * Called from the boot sequence with the module id taken from the MANIFEST, so a module cannot
 * claim another module's namespace.
 *
 * Two properties, and taking the whole list is what gives both:
 *
 *   * a manifest that names the same entity type twice is a BOOT ERROR — one of the two would be
 *     silently ignored, and which one would depend on array order;
 *   * re-registering the same module REPLACES its previous entries, so booting the platform twice
 *     in one process (a test harness does this) behaves like `registerModule` itself rather than
 *     throwing on the second call.
 */
export const registerFileEntityAuthorizers = (
  moduleId: string,
  authorizers: readonly FileEntityAuthorizer[],
): void => {
  const seen = new Set<string>();
  for (const authorizer of authorizers) {
    if (seen.has(authorizer.entityType)) {
      throw new Error(`duplicate file entity authorizer for ${key(moduleId, authorizer.entityType)}`);
    }
    seen.add(authorizer.entityType);
  }
  // Drop this module's previous claims before re-asserting them, so a re-boot replaces rather
  // than accumulates. Another module's entries are untouched — the key is namespaced.
  for (const id of [...registry.keys()]) {
    if (id.startsWith(`${moduleId}/`)) registry.delete(id);
  }
  for (const authorizer of authorizers) {
    registry.set(key(moduleId, authorizer.entityType), authorizer);
  }
};

/** Single-authorizer convenience, for tests and for a module with exactly one type. */
export const registerFileEntityAuthorizer = (
  moduleId: string,
  authorizer: FileEntityAuthorizer,
): void => registerFileEntityAuthorizers(moduleId, [authorizer]);

/** Whether an entity type is GUARDED — the switch between the new rules and the previous ones. */
export const hasFileEntityAuthorizer = (moduleId: string, entityType: string): boolean =>
  registry.has(key(moduleId, entityType));

/** Test-only reset; the boot sequence is the sole production caller of `register…`. */
export const clearFileEntityAuthorizers = (): void => registry.clear();

/** Marks a denial as "took too long" rather than "threw", so the log can tell them apart. */
class AuthorizerTimeout extends Error {
  constructor() {
    super(`authorizer exceeded ${AUTHORIZER_TIMEOUT_MS}ms`);
  }
}

const withTimeout = async (promise: Promise<boolean>): Promise<boolean> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<boolean>((_resolve, reject) => {
        timer = setTimeout(() => reject(new AuthorizerTimeout()), AUTHORIZER_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

/**
 * The single question the Files service asks.
 *
 * **Fail-closed for registered types, unchanged for the rest.** An entity type nobody has claimed
 * returns `true` here and the caller falls through to the pre-ADR-023 rules — which is what keeps
 * HR files, branding logos and OCR sources behaving exactly as they did. Once a module claims a
 * type, every failure mode denies: `false`, a throw, and a timeout alike.
 */
export const authorizeFileEntity = async (
  ctx: AuthContext,
  entityRef: { moduleId: string; entityType: string; entityId: string } | undefined,
  intent: FileAccessIntent,
): Promise<boolean> => {
  // A row with no owner cannot match any authorizer, so it is unguarded by definition — the same
  // answer as an unclaimed type. Not a hole: `entityRef` is required by the schema at upload and
  // appears on no update, so one cannot be shed to escape a guard.
  if (entityRef === undefined) return true;
  const authorizer = registry.get(key(entityRef.moduleId, entityRef.entityType));
  if (authorizer === undefined) return true;
  try {
    return await withTimeout(authorizer.authorize({ ctx, entityId: entityRef.entityId, intent }));
  } catch (error) {
    // Deliberately not rethrown: the service turns a denial into the right status code, and a
    // module's internal failure must never surface to a caller as a 500 that leaks its existence.
    // The two causes want different operator responses — a timeout is a performance problem, a
    // throw is a bug — so the log says which. Both deny.
    logger.warn(
      {
        err: error,
        entity: key(entityRef.moduleId, entityRef.entityType),
        intent,
        cause: error instanceof AuthorizerTimeout ? 'timeout' : 'error',
      },
      'file entity authorizer failed — denying (ADR-023 fail-closed)',
    );
    return false;
  }
};
