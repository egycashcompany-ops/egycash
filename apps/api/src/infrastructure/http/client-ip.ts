// Which address a request came from — the key of every per-IP rate limit and the `ip` of every
// audit row.
//
// `trust proxy: true` alone makes Express read the LEFT-most X-Forwarded-For entry, which is
// whatever the client chose to write there: any caller could pick a fresh rate-limit bucket per
// request and put any address it liked into the audit trail. Railway's edge instead states the
// address it saw the connection come from in `X-Real-IP` (docs.railway.com, Networking → Specs &
// Limits → Request Headers), so that header is the answer when it is there.
//
// When it is NOT there — local development, tests, a health check from inside the platform —
// Express's own answer stands, so a deployment that never sets the header behaves exactly as
// before rather than collapsing every caller into the address of the hop in front of it.
import { type Express, type Request } from 'express';

/** The first address in the header's value, or `fallback` when the header says nothing. */
export const clientIpFrom = (
  headerValue: string | undefined,
  fallback: string | undefined,
): string | undefined => {
  const named = headerValue?.split(',')[0]?.trim();
  return named !== undefined && named !== '' ? named : fallback;
};

const findDescriptor = (target: object, key: string): PropertyDescriptor | undefined => {
  for (let proto: object | null = target; proto !== null; proto = Object.getPrototypeOf(proto) as object | null) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, key);
    if (descriptor !== undefined) return descriptor;
  }
  return undefined;
};

/**
 * Make `req.ip` on this app read `header` first. On `app.request`, the app's own request
 * prototype, so every consumer of `req.ip` — the rate limiter, the request context, the
 * authenticated audit actor — gets the same answer without each having to know about it.
 * An empty `header` leaves Express's `req.ip` untouched.
 */
export const installClientIp = (app: Express, header: string): void => {
  if (header === '') return;
  const expressIp = findDescriptor(app.request, 'ip')?.get;
  Object.defineProperty(app.request, 'ip', {
    configurable: true,
    enumerable: true,
    get(this: Request): string | undefined {
      return clientIpFrom(this.get(header), expressIp?.call(this) as string | undefined);
    },
  });
};
