// One requestId traces a user action across api → queue → worker (ADR-012).
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export interface RequestContext {
  requestId: string;
  actor?: {
    userId: string | null;
    ip: string | null;
    userAgent: string | null;
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
