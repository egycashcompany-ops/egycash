// Architecture guards for the applicant portal, read off the source.
//
// These pin the promises no runtime test can observe, because each is about what the code does NOT
// do: it does not open a portal for everyone who applies, it does not let a caller choose where a
// link or a code is sent, and it does not tell the sign-in screen why somebody was refused.
//
// Widen them by NAMING a new file or a new word — never by loosening a pattern.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (file: string): string => readFileSync(resolve(HERE, file), 'utf8');
/** Prose explains the decision; only CODE may contradict it. */
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');

const FEATURE = readdirSync(HERE)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
  .map((f) => code(read(f)))
  .join('\n');
const SERVICE = code(read('./applicant-portal.service.ts'));
const MODULE = code(readFileSync(resolve(HERE, '../../hr.module.ts'), 'utf8'));
const SEED = code(readFileSync(resolve(HERE, '../../hr.seed.ts'), 'utf8'));

describe('D-APP-2 — the portal opens on clearing screening, never on applying', () => {
  it('subscribes to the screening decision and acts only on an acceptance', () => {
    expect(MODULE).toContain("event: 'hr.screening.decided'");
    expect(MODULE).toContain("payload.outcome !== 'accepted'");
  });

  it('is idempotent — an existing account is returned, not duplicated', () => {
    expect(SERVICE).toContain('const existing = await this.accountFor(applicantId)');
    expect(SERVICE).toContain('if (existing !== null) return existing;');
  });

  it('never fails the screening decision it rides on', () => {
    const handler = MODULE.slice(MODULE.indexOf("'applicantPortal.openOnScreeningPass'"));
    expect(handler.slice(0, handler.indexOf('},'))).toContain('catch');
  });
});

describe('D-APP-3ب — the link is an address, not a key', () => {
  it('sends to the number ON FILE, never to one supplied with the request', () => {
    expect(SERVICE).toContain('applicant.contact?.primaryPhone');
    // A phone parameter on the send would be the whole hole: it would let a caller redirect
    // somebody else's portal to a handset they control.
    expect(SERVICE).not.toContain('sendPortalLink(applicantId: string, phone: string');
  });

  it('records who sent it', () => {
    expect(SERVICE).toContain("{ field: 'by', old: null, new: by }");
  });
});

describe('the sign-in screen cannot be used to enumerate applicants', () => {
  it('the resolver answers null for every kind of no, and never says which', () => {
    const resolver = SERVICE.slice(SERVICE.indexOf('async resolveIdentity'));
    const body = resolver.slice(0, resolver.indexOf('\n  }'));
    // Four different refusals, one answer.
    expect(body.match(/return null;/g)?.length).toBeGreaterThanOrEqual(3);
    expect(body).not.toContain('throw ');
  });

  it('requires the phone to match what the company holds', () => {
    expect(SERVICE).toContain("(applicant.contact?.primaryPhone ?? '') !== phone");
  });

  it('reads applicants of ANY status — a refused candidate still signs in to read that', () => {
    expect(SERVICE).toContain('findAnyByNationalId');
    expect(SERVICE).not.toContain('findLiveByNationalId');
  });
});

describe('the surfaces and the resolver are wired at boot', () => {
  it('registers a read surface, a write surface and an identity resolver', () => {
    expect(SEED).toContain('registerExternalSurface(');
    expect(SEED).toContain('registerExternalWriteSurface(');
    expect(SEED).toContain('registerPortalIdentityResolver(');
  });

  it('uses the shared constants rather than a second copy of the strings', () => {
    expect(SEED).toContain('APPLICANT_PORTAL_SUBJECT');
    expect(SEED).toContain('APPLICANT_PORTAL_PREFIX');
    expect(FEATURE).toContain("APPLICANT_PORTAL_SUBJECT = 'applicant'");
  });
});

describe('no second authentication system (ADR-027)', () => {
  it('the portal account is an ordinary user with an external subject', () => {
    expect(SERVICE).toContain('userService.create');
    expect(SERVICE).toContain('externalSubject');
    for (const forbidden of ['bcrypt', 'argon2', 'passwordHash', 'jwt.sign', 'new Schema']) {
      expect(FEATURE).not.toContain(forbidden);
    }
  });
});
