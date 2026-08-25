// WHY THIS EXISTS. `apiOrigin()` shipped as `new URL(BASE_URL).origin`, which works for exactly
// one value of `VITE_API_BASE_URL` — the absolute dev default — and throws for every value a real
// deployment uses. The realtime socket then took the throw at App level, so the error boundary
// replaced EVERY page with "something went wrong". Nothing caught it: the origin was never
// computed under a production-shaped base URL, in any test, on either side.
//
// The values below are not invented. They are copied from docs/09-guides/railway-deployment.md,
// which is what the deployment is actually configured with.
import { describe, expect, it } from 'vitest';
import { originOf } from './api-client';

const APP_ORIGIN = 'https://ecms.example.com';

describe('api origin', () => {
  it('resolves the same-origin deployment default `/api/v1`', () => {
    expect(originOf('/api/v1', APP_ORIGIN)).toBe(APP_ORIGIN);
  });

  it('resolves a base-path deployment `/ecms/api/v1`', () => {
    expect(originOf('/ecms/api/v1', APP_ORIGIN)).toBe(APP_ORIGIN);
  });

  it('resolves the absolute dev default to the api host, not the app host', () => {
    expect(originOf('http://localhost:3000/api/v1', 'http://localhost:5173')).toBe(
      'http://localhost:3000',
    );
  });

  it('resolves an absolute cross-origin api', () => {
    expect(originOf('https://api.example.com/api/v1', APP_ORIGIN)).toBe('https://api.example.com');
  });

  it('falls back to the document origin rather than throwing on nonsense', () => {
    // A misconfigured environment variable must cost live updates, never the whole application.
    expect(originOf('::not a url::', APP_ORIGIN)).toBe(APP_ORIGIN);
    expect(originOf('', APP_ORIGIN)).toBe(APP_ORIGIN);
  });
});
