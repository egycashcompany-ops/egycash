// Whether this deployment can push at all, decided in one place.
//
// Three things read the answer and they must not be able to disagree: `notify()` (does a push
// channel row belong on this notification?), the adapter (may I send?), and the endpoint the
// browser asks before it subscribes. A deployment with no VAPID pair is a normal, supported
// state — push is simply not on — so each of those has to give the same quiet answer rather than
// one of them raising.
//
// A HALF pair is the one thing refused outright, at boot rather than at the first delivery. One
// key without the other cannot be a decision anybody made; it is a typo or a half-finished
// secrets migration, and the failure it produces otherwise is a `web-push` error deep inside a
// retry loop hours later.
import webpush from 'web-push';
import { env } from '../../infrastructure/config/env';

export interface PushConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/** The configured pair, or null when this deployment has none. */
export const pushConfig = (): PushConfig | null => {
  const publicKey = env.VAPID_PUBLIC_KEY.trim();
  const privateKey = env.VAPID_PRIVATE_KEY.trim();
  if (publicKey === '' || privateKey === '') return null;
  return { publicKey, privateKey, subject: env.VAPID_SUBJECT.trim() };
};

export const isPushConfigured = (): boolean => pushConfig() !== null;

/**
 * Validate the configuration at boot and hand `web-push` its credentials.
 *
 * Called from `bootPlatform()`. Throws only on a half pair — an absent pair returns quietly,
 * because "push is off here" is a state this platform supports.
 */
export const initPushChannel = (): void => {
  const publicKey = env.VAPID_PUBLIC_KEY.trim();
  const privateKey = env.VAPID_PRIVATE_KEY.trim();
  if (publicKey === '' && privateKey === '') return;
  if (publicKey === '' || privateKey === '') {
    throw new Error(
      'VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set together — one without the other cannot sign a push',
    );
  }
  const subject = env.VAPID_SUBJECT.trim();
  if (subject === '') {
    throw new Error('VAPID_SUBJECT must name a mailto: or https: contact for the push service');
  }
  // `web-push` validates the key pair's shape here, so a malformed key fails the boot rather than
  // every delivery.
  webpush.setVapidDetails(subject, publicKey, privateKey);
};
