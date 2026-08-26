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
  registerExternalWriteSurface,
} from './external-surfaces';
import { type ExternalSubject } from '../../shared/types';

const customer: ExternalSubject = {
  moduleId: 'gold',
  subjectType: 'goldCompany',
  subjectId: '650000000000000000000101',
};

/** A subject type nobody registered — the fail-closed case. */
const stranger: ExternalSubject = { ...customer, subjectType: 'somethingElse' };

/** The first subject type with a WRITE surface (ADR-027 amendment): a job applicant. */
const applicant: ExternalSubject = {
  moduleId: 'hr',
  subjectType: 'applicant',
  subjectId: '650000000000000000000202',
};

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

    it('may not WRITE, even there — a subject that registered no write surface still cannot', () => {
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

/**
 * The ADR-027 amendment (2026-08-26). The applicant portal needs a candidate to upload their own
 * certificates, which a read-only account cannot do — so a subject type may declare ONE write
 * prefix. Everything here exists to pin how narrow that is.
 */
describe('a declared write surface', () => {
  beforeEach(() => {
    clearExternalSurfaces();
    registerExternalSurface('gold', 'goldCompany', '/gold/portal');
    registerExternalSurface('hr', 'applicant', '/hr/applicant-portal');
    registerExternalWriteSurface('hr', 'applicant', '/hr/applicant-portal');
  });

  it('lets the applicant write under its own prefix', () => {
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE'] as const) {
      const path = '/api/v1/hr/applicant-portal/documents';
      expect(externalMayReach(applicant, method, path), method).toBe(true);
    }
  });

  it('and read it too — but only because the read surface was registered separately', () => {
    expect(externalMayReach(applicant, 'GET', '/api/v1/hr/applicant-portal/status')).toBe(true);
  });

  it('DOES NOT widen the gold customer by one route', () => {
    // The whole point of the amendment being opt-in: a subject that asks for nothing gets nothing.
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE'] as const) {
      expect(externalMayReach(customer, method, '/api/v1/gold/portal/bars'), method).toBe(false);
      expect(externalMayReach(customer, method, '/api/v1/hr/applicant-portal'), method).toBe(false);
    }
  });

  it('does not let the applicant write anywhere but its own prefix', () => {
    for (const path of [
      '/api/v1/hr/applicants',
      '/api/v1/hr/employees',
      '/api/v1/platform/directory/resolve',
      '/api/v1/gold/portal/bars',
      '/api/v1/some/module/invented/tomorrow',
    ]) {
      expect(externalMayReach(applicant, 'POST', path), path).toBe(false);
    }
  });

  it('is not fooled by a sibling that shares the prefix', () => {
    expect(externalMayReach(applicant, 'POST', '/api/v1/hr/applicant-portal-admin')).toBe(false);
  });

  it('a write surface alone grants no reads', () => {
    clearExternalSurfaces();
    registerExternalWriteSurface('hr', 'applicant', '/hr/applicant-portal');
    expect(externalMayReach(applicant, 'POST', '/api/v1/hr/applicant-portal/documents')).toBe(true);
    // Reading is the OTHER registration, and nobody made it.
    expect(externalMayReach(applicant, 'GET', '/api/v1/hr/applicant-portal/status')).toBe(false);
  });

  it('and a read surface alone grants no writes — the pre-amendment world, unchanged', () => {
    clearExternalSurfaces();
    registerExternalSurface('hr', 'applicant', '/hr/applicant-portal');
    expect(externalMayReach(applicant, 'GET', '/api/v1/hr/applicant-portal/status')).toBe(true);
    expect(externalMayReach(applicant, 'POST', '/api/v1/hr/applicant-portal/documents')).toBe(false);
  });
});
