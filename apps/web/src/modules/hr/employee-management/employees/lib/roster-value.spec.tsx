// The preview shows a manager what a value IS, in their language — never an id, never a token.
//
// Three rows on one real preview are why this file exists: `الإدارة 6a9d5b17… → 6a9c84e1…`,
// `insurance — → 0`, `المؤهل bachelor → bachelor`. The API now sends typed values; this is the half
// that turns them into words on the screen, and each case below is one of those rows fixed.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ENUM_KEY_PREFIX, RosterValue } from './roster-value';

const t = (key: string): string => `T:${key}`;
const html = (value: Parameters<typeof RosterValue>[0]['value'], locale: 'ar' | 'en' = 'ar'): string =>
  renderToStaticMarkup(<RosterValue value={value} t={t} locale={locale} />);

describe('a named org entity', () => {
  const name = { ar: 'المالية', en: 'Finance' };

  it('is shown by its Arabic name on the Arabic screen', () => {
    expect(html({ kind: 'named', name, isNew: false }, 'ar')).toBe('المالية');
  });

  it('and by its English name on the English one', () => {
    expect(html({ kind: 'named', name, isNew: false }, 'en')).toBe('Finance');
  });

  /**
   * THE TOKEN THAT LEAKED. `dry-run:jobTitle:…` was shown as a value. The API now sends the name it
   * would have with `isNew`, and the screen says «new» beside it — and never the token.
   */
  it('marks a thing the file would create as new, and shows no placeholder token', () => {
    const out = html({ kind: 'named', name: { ar: 'اخصائي صراف', en: 'اخصائي صراف' }, isNew: true }, 'ar');
    expect(out).toContain('T:employees.roster.new');
    expect(out).toContain('اخصائي صراف');
    expect(out).not.toContain('dry-run');
  });
});

describe('a vocabulary token', () => {
  it('is looked up in the screen’s own label table for its family', () => {
    expect(html({ kind: 'enum', family: 'educationLevel', value: 'bachelor' })).toBe('T:applicants.education.bachelor');
    expect(html({ kind: 'enum', family: 'insuranceStatus', value: 'notInsured' })).toBe('T:employees.insurance.status.notInsured');
    expect(html({ kind: 'enum', family: 'employeeStatus', value: 'exited' })).toBe('T:employees.status.exited');
  });

  /**
   * Every family the API can tag has a label table here. A family added on the API side without a
   * prefix would render `T:undefinedbachelor` — this is the assertion that keeps the two in step.
   */
  it('has a label prefix for every family the contract declares', () => {
    for (const prefix of Object.values(ENUM_KEY_PREFIX)) {
      expect(prefix).toMatch(/^[a-zA-Z.]+\.$/);
    }
    expect(Object.keys(ENUM_KEY_PREFIX).sort()).toEqual(
      ['educationLevel', 'employeeStatus', 'exitType', 'insuranceStatus', 'maritalStatus', 'militaryStatus', 'weaponLicenseType'],
    );
  });
});

describe('plain values', () => {
  it('shows text as given and absence as a dash', () => {
    expect(html({ kind: 'text', text: '7000' })).toBe('7000');
    expect(html({ kind: 'absent' })).toBe('—');
  });
});
