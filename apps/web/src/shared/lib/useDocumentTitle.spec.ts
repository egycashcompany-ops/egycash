// The tab says whose screen it is.
//
// The staff platform's tab reads «ECMS» (index.html). The screens that speak for the company —
// both portals, from sign-in on, and the two public pages — draw the EGYCASH logo, so their tab says
// EGYCASH as well. There is no DOM here to run the effect in, so this proves the wiring where it
// lives: each of those screens sets the title before anything can return early.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../..');
const source = (file: string): string => readFileSync(join(SRC, file), 'utf8');

const EGYCASH_SCREENS = [
  'modules/gold/portal/PortalLoginPage.tsx',
  'modules/gold/portal/PortalShell.tsx',
  'modules/hr/recruitment/applicant-portal/ApplicantPortalLoginPage.tsx',
  'modules/hr/recruitment/applicant-portal/ApplicantPortalShell.tsx',
  'modules/hr/recruitment/recruitment-form/pages/PublicApplyPage.tsx',
  'modules/hr/contracts/pages/VerifyContractPage.tsx',
];

describe('the tab title', () => {
  it.each(EGYCASH_SCREENS)('%s names EGYCASH, first thing', (file) => {
    const text = source(file);
    // Straight after the translator: before any early return, as the rules of hooks require.
    expect(text).toMatch(/const t = useT\(\);\n {2}useDocumentTitle\('EGYCASH'\);\n/);
  });

  it('is left to the document on the staff platform', () => {
    for (const file of ['platform/auth/LoginPage.tsx', 'platform/layout/Topbar.tsx']) {
      expect(source(file), file).not.toContain('useDocumentTitle');
    }
    expect(source('../index.html')).toContain('<title>ECMS</title>');
  });

  it('and a shared link previews as the company', () => {
    const index = source('../index.html');
    expect(index).toContain('<meta property="og:site_name" content="EGYCASH" />');
    expect(index).toContain('<meta property="og:title" content="EGYCASH" />');
  });
});
