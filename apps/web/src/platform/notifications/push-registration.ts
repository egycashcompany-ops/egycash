// Turning Web Push on and off in THIS browser.
//
// Two records have to agree and either can be changed without the other: the browser's own
// `PushSubscription` (which survives a sign-out and a server it can no longer reach) and the row
// on the server (which the person can delete from another device). Everything here is written so
// that whichever one is missing, the state converges rather than deadlocking:
//
//   • subscribing is an upsert, so re-running it is how you REPAIR a browser whose row was deleted
//     server-side — no "already subscribed" error path to get stuck in;
//   • unsubscribing tells the server first and then the browser, and does not stop on the
//     server's answer: a device that cannot reach ECMS must still be able to switch itself off.
//
// PERMISSION IS THE BROWSER'S, NOT OURS. It cannot be revoked from here — only the person can, in
// site settings — and it cannot be asked for twice: a browser that was refused once answers
// `denied` without prompting anybody. So `denied` is reported as the dead end it is rather than
// retried behind a spinner.
import { del, get, post } from '../../shared/lib/api-client';

export interface PushConfig {
  enabled: boolean;
  publicKey: string | null;
}

export type PushState =
  /** No service worker, or no Push API — an old browser, or an iOS tab that is not installed. */
  | { status: 'unsupported' }
  /** This deployment has no VAPID pair, so there is nothing to switch on. */
  | { status: 'unconfigured' }
  /** The browser refused, permanently, until the person changes it in site settings. */
  | { status: 'denied' }
  | { status: 'off' }
  | { status: 'on' };

/** Whether this browser could push at all, before any permission is involved. */
export const pushSupported = (): boolean =>
  typeof navigator !== 'undefined' &&
  'serviceWorker' in navigator &&
  typeof window !== 'undefined' &&
  'PushManager' in window &&
  'Notification' in window;

/**
 * The VAPID public key travels as base64url text and `PushManager.subscribe` wants raw bytes.
 *
 * The padding and the two swapped characters are what separate base64url from base64 — a key
 * passed through `atob` without this produces an `InvalidCharacterError` on some keys and, worse,
 * a silently wrong key on others.
 */
export const urlBase64ToUint8Array = (base64Url: string): Uint8Array<ArrayBuffer> => {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  // Built over an explicit ArrayBuffer: `applicationServerKey` wants a view onto one, and a plain
  // `new Uint8Array(n)` is typed over `ArrayBufferLike`, which admits a SharedArrayBuffer it can
  // never accept.
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
};

const fetchConfig = (): Promise<PushConfig> => get<PushConfig>('/platform/push/config');

/** What the switch should show right now, asked fresh — none of this is safe to cache. */
export const readPushState = async (): Promise<PushState> => {
  if (!pushSupported()) return { status: 'unsupported' };
  const config = await fetchConfig();
  if (!config.enabled || config.publicKey === null) return { status: 'unconfigured' };
  if (Notification.permission === 'denied') return { status: 'denied' };
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  return { status: existing === null ? 'off' : 'on' };
};

/**
 * Subscribe this browser and register it with the server.
 *
 * `userVisibleOnly` is required by every browser that implements this: a push must produce
 * something the person can see, which is the promise `sw.js` keeps by always calling
 * `showNotification`.
 */
export const enablePush = async (): Promise<PushState> => {
  if (!pushSupported()) return { status: 'unsupported' };
  const config = await fetchConfig();
  if (!config.enabled || config.publicKey === null) return { status: 'unconfigured' };

  // Must be called from a user gesture, which is why this function is only ever reached from a
  // click. A browser that has already answered returns that answer without prompting.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return { status: permission === 'denied' ? 'denied' : 'off' };
  }

  const registration = await navigator.serviceWorker.ready;
  // Reuse the browser's existing subscription when there is one. Re-subscribing would mint a new
  // endpoint and leave the old row on the server pushing to an address this browser has stopped
  // reading — the duplicate-notification bug, permanently.
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(config.publicKey),
    }));

  const json = subscription.toJSON();
  await post('/platform/push/subscriptions', {
    endpoint: subscription.endpoint,
    keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
  });
  return { status: 'on' };
};

/** Unregister this browser. The server is told first; the browser is switched off regardless. */
export const disablePush = async (): Promise<PushState> => {
  if (!pushSupported()) return { status: 'unsupported' };
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (subscription === null) return { status: 'off' };

  try {
    await del('/platform/push/subscriptions', { endpoint: subscription.endpoint });
  } catch {
    // Offline, signed out, or the row is already gone. None of those is a reason to leave this
    // browser subscribed to pushes the person just asked to stop.
  }
  await subscription.unsubscribe();
  return { status: 'off' };
};
