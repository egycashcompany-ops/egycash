// P-HR-MED §8 Q1 as ruled — who reads bodies, pinned at the source.
//
// THE DEFECT THIS CLOSES. D3 gave clinical data its own two keys so that reading somebody's salary
// band would not come with reading their blood type. The separation was real in the catalog and
// absent from every database: `medicalRecord.view` was granted to no named role, so the only
// account that could open a medical record was the Super Admin — which holds it the way it holds
// everything, by being seeded the whole registry. The module shipped, the screens worked, and the
// door D3 designed had its only key on the master ring.
//
// WHY THIS IS A SOURCE-LEVEL GUARD. What has to stay true is a property of the DECLARATION, not of
// any one run: this role holds these two keys and nothing else. A behavioural test would prove the
// seed ran; it would not notice somebody adding `employee.view` to the literal next year, which is
// the failure that matters — it is invisible, it is one line, and it silently reunites the two
// halves D3 spent a phase separating.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HR_MEDICAL_OFFICER_ROLE_KEY } from '../hr.seed';

const seedSource = readFileSync(join(__dirname, '..', 'hr.seed.ts'), 'utf8');

/** The grant array as written, so the assertions argue with the source and not with a mock. */
const grantedKeys = (): string[] => {
  const call = seedSource.slice(seedSource.indexOf('ensureManagedRole(\n    HR_MEDICAL_OFFICER'));
  const list = call.slice(call.indexOf('['), call.indexOf(']') + 1);
  return [...list.matchAll(/'([^']+)'/g)].map((m) => m[1] as string);
};

describe('the role exists and is named', () => {
  it('is keyed, so it can be found and assigned by an administrator', () => {
    expect(HR_MEDICAL_OFFICER_ROLE_KEY).toBe('hr-medical-officer');
  });

  it('is seeded at boot, not only in the dev seed', () => {
    // `seed-data.ts` says in its own header that production never runs it. A role that lived only
    // there would answer §8 Q1 on a developer's laptop and nowhere a real record is kept.
    expect(seedSource).toContain('ensureMedicalOfficerRole');
  });
});

describe('what it may read', () => {
  it('holds the two clinical keys', () => {
    expect(grantedKeys()).toEqual(['medicalRecord.view', 'medicalRecord.manage']);
  });

  /**
   * THE ASSERTION THE WHOLE OF D3 RESTS ON.
   *
   * `medicalInsurance.*` is administrative, and D4 scopes the card by branch precisely because
   * benefits work is delegable — an HR officer in Maadi should be able to run Maadi's cards.
   * Folding those keys in here would mean that delegating card administration hands out clinical
   * access, so the person who files a card number could read everybody's conditions. That is the
   * exact leak the two key families were split to prevent, and it would arrive as one plausible
   * line in an array.
   */
  it('holds NO insurance key — administrative and clinical stay two gates', () => {
    expect(grantedKeys().some((k) => k.startsWith('medicalInsurance.'))).toBe(false);
  });

  it('holds nothing outside the medical record at all', () => {
    expect(grantedKeys().every((k) => k.startsWith('medicalRecord.'))).toBe(true);
  });
});

describe('how it is created', () => {
  /**
   * `isSystem` is one of the two things that make a holder PRIVILEGED, and a privileged account is
   * forced through TOTP enrollment at login. These are ordinary module permissions and have no
   * business changing how their holder signs in — the same reasoning `gold.seed.ts` records for
   * its portal role. `ensureManagedRole` also re-asserts the grant set on every boot, so the array
   * above is the whole truth about this role on every deployed database, not just a fresh one.
   */
  it('is a managed role, never a system role', () => {
    expect(seedSource).toContain('ensureManagedRole(\n    HR_MEDICAL_OFFICER_ROLE_KEY');
    expect(seedSource).not.toContain('ensureSystemRole(\n    HR_MEDICAL_OFFICER_ROLE_KEY');
  });

  /**
   * The seed creates the role and assigns it to no one, and that is the deliberate half.
   *
   * Which people may read medical records is an owner's decision. A seed that picked holders — by
   * job title, by department name, by anything — would be handing out medical records on a naming
   * convention, and would do it silently on every existing database at the next deploy.
   */
  it('assigns the role to nobody', () => {
    const fn = seedSource.slice(seedSource.indexOf('const ensureMedicalOfficerRole'));
    expect(fn.slice(0, fn.indexOf('\n};'))).not.toContain('ensureAssignment');
  });
});
