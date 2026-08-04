// One requestId traces a user action across api → queue → worker (ADR-012).
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/**
 * WHO the caller is, in display terms, carried for the whole request.
 *
 * Every audit row and activity entry records its actor as it was at the time, so something has to
 * supply that identity at write time. Looking it up per row would put a database read — several,
 * once titles are involved — in front of every audited mutation. The identity of the caller is a
 * property of the REQUEST, established once when the token is verified, not a fact to re-derive on
 * each row. Structural on purpose: this file is infrastructure and imports nothing.
 */
export interface ActorIdentity {
  displayName: { ar: string; en: string };
  jobTitle: { ar: string; en: string } | null;
  avatarFileId: string | null;
}

export interface RequestContext {
  requestId: string;
  actor?: {
    userId: string | null;
    ip: string | null;
    userAgent: string | null;
    /** Absent before authentication (login) and for system-initiated work. */
    identity?: ActorIdentity | null;
  };
}

const storage = new AsyncLocalStorage<RequestContext>();

export const runWithContext = <T>(context: RequestContext, fn: () => T): T =>
  storage.run(context, fn);

export const getContext = (): RequestContext | undefined => storage.getStore();

export const getRequestId = (): string | undefined => storage.getStore()?.requestId;

export const setActor = (actor: NonNullable<RequestContext['actor']>): void => {
  const store = storage.getStore();
  if (store !== undefined) store.actor = actor;
};

export const newRequestId = (): string => `req_${randomUUID()}`;
