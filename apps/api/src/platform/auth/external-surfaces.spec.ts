// The confinement rule for external accounts, stated as tests.
//
// This is the file to read to know what a vault customer can reach. Everything here is about the
// COARSE question — which routes exist for them at all — not about which company's metal they may
// see, which the owning module answers per request.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearExternalSurfaces,
  externalMayReach,
  registerExternalSurface,
} from './external-surfaces';
import { type ExternalSubject } from '../../shared/types';

const customer: ExternalSubject = {
  moduleId: 'gold',
  subjectType: 'goldCompany',
  subjectId: '650000000000000000000101',
};

/** A subject type nobody registered — the fail-closed case. */
const stranger: ExternalSubject = { ...customer, subjectType: 'somethingElse' };

describe('external confinement', () => {
  beforeEach(() => {
    clearExternalSurfaces();
    registerExternalSurface('gold', 'goldCompany', '/gold/portal');
  });

  describe('its own account', () => {
    it('reaches every auth route, by any method — the router is self-service by construction', () => {
      for (const [method, path] of [
        ['POST', '/api/v1/auth/login'],
        ['POST', '/api/v1/auth/refresh'],
        ['POST', '/api/v1/auth/logout'],
        ['GET', '/api/v1/auth/me'],
        ['POST', '/api/v1/auth/password/change'],
        ['PATCH', '/api/v1/auth/me/preferences'],
        ['POST', '/api/v1/auth/totp/enroll'],
        ['GET', '/api/v1/auth/sessions'],
        ['DELETE', '/api/v1/auth/sessions/abc'],
      ] as const) {
        expect(externalMayReach(customer, method, path), `${method} ${path}`).toBe(true);
      }
    });

    it('does not treat a route that merely starts with the same letters as an auth route', () => {
      expect(externalMayReach(customer, 'GET', '/api/v1/authorizations')).toBe(false);
    });
  });

  describe('its own surface', () => {
    it('reads the registered prefix and everything under it', () => {
      expect(externalMayReach(customer, 'GET', '/api/v1/gold/portal')).toBe(true);
      expect(externalMayReach(customer, 'GET', '/api/v1/gold/portal/bars')).toBe(true);
      expect(externalMayReach(customer, 'HEAD', '/api/v1/gold/portal/overview')).toBe(true);
    });

    it('may not WRITE, even there — read-only is a property of the account, not of the routes', () => {
      for (const method of ['POST', 'PATCH', 'PUT', 'DELETE'] as const) {
        expect(externalMayReach(customer, method, '/api/v1/gold/portal/bars')).toBe(false);
      }
    });

    it('is not fooled by a sibling path that shares the prefix', () => {
      expect(externalMayReach(customer, 'GET', '/api/v1/gold/portal-accounts')).toBe(false);
    });
  });

  describe('everywhere else', () => {
    it('cannot read the rest of its own module', () => {
      expect(externalMayReach(customer, 'GET', '/api/v1/gold/bars')).toBe(false);
      expect(externalMayReach(customer, 'GET', '/api/v1/gold/companies')).toBe(false);
      expect(externalMayReach(customer, 'GET', '/api/v1/gold/reports/client-balances')).toBe(false);
    });

    it('cannot reach the platform surfaces that are open to any authenticated employee', () => {
      // Both are deliberately permission-free for staff, and both name people who work here.
      expect(externalMayReach(customer, 'POST', '/api/v1/platform/directory/resolve')).toBe(false);
      expect(externalMayReach(customer, 'GET', '/api/v1/platform/directory/u1')).toBe(false);
      expect(externalMayReach(customer, 'GET', '/api/v1/platform/me/applications')).toBe(false);
    });

    it('cannot reach another module at all', () => {
      expect(externalMayReach(customer, 'GET', '/api/v1/hr/employees')).toBe(false);
      expect(externalMayReach(customer, 'GET', '/api/v1/fleet/vehicles')).toBe(false);
    });

    /**
     * The property that makes this worth having: nobody has to remember this file when they add a
     * route. Anything not explicitly opened stays shut.
     */
    it('refuses a route that did not exist when the gate was written', () => {
      expect(externalMayReach(customer, 'GET', '/api/v1/some/module/invented/tomorrow')).toBe(false);
    });
  });

  it('gives a subject type nobody registered self-service and nothing else', () => {
    expect(externalMayReach(stranger, 'GET', '/api/v1/auth/me')).toBe(true);
    expect(externalMayReach(stranger, 'GET', '/api/v1/gold/portal/bars')).toBe(false);
  });
});
