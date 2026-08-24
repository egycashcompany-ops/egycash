// Thin HTTP mapping only (ADR-003). Self-scoped, like the inbox and the preferences beside it:
// registering a browser is identity ownership, not RBAC — the only thing a caller can register or
// remove is their own.
import { type Request, type Response } from 'express';
import {
  type DeletePushSubscription,
  type PushConfigDto,
  type PushSubscriptionDto,
  type PushSubscriptionInput,
} from '@ecms/contracts';
import { noContent, ok } from '../../infrastructure/http/respond';
import { validated } from '../../infrastructure/http/validate';
import { authContext } from '../auth';
import { pushConfig } from './push-config';
import { pushSubscriptionRepository } from './push-subscription.repository';
import { type PushSubscriptionDoc } from './push-subscription.model';

const toDto = (doc: PushSubscriptionDoc): PushSubscriptionDto => ({
  id: String(doc._id),
  endpoint: doc.endpoint,
  userAgent: doc.userAgent,
  createdAt: doc.createdAt.toISOString(),
  lastSeenAt: doc.lastSeenAt.toISOString(),
});

/**
 * What the browser needs before it may subscribe.
 *
 * The PUBLIC key only — that is the half a browser is meant to hold, and it is public by
 * construction: it identifies this server to the push service and can encrypt nothing on its own.
 * The private key never leaves the process.
 */
export const getPushConfig = (req: Request, res: Response): void => {
  const config = pushConfig();
  const dto: PushConfigDto =
    config === null
      ? { enabled: false, publicKey: null }
      : { enabled: true, publicKey: config.publicKey };
  ok(res, dto);
};

export const registerPushSubscription = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<PushSubscriptionInput>(req);
  const doc = await pushSubscriptionRepository.upsert({
    userId: ctx.userId,
    endpoint: body.endpoint,
    keys: body.keys,
    // The only way to tell one of a person's devices from another on the list they manage.
    userAgent: req.headers['user-agent'] ?? null,
    now: new Date(),
  });
  ok(res, toDto(doc));
};

export const listMyPushSubscriptions = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const docs = await pushSubscriptionRepository.listForUser(ctx.userId);
  ok(res, docs.map(toDto));
};

export const removeMyPushSubscription = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<DeletePushSubscription>(req);
  // Deleting something already gone is the caller's desired state either way, so a miss is still
  // 204 — a browser that unsubscribed locally first must not be told it failed.
  await pushSubscriptionRepository.removeOwned(ctx.userId, body.endpoint);
  noContent(res);
};
