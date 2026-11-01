// The tab says whose screen it is.
//
// The staff platform's tab reads «ECMS» (index.html). The screens that speak for the company —
// both portals, from sign-in on, and the two public pages — draw the EGYCASH logo, so their tab says
// EGYCASH as well, and leaving one gives the tab back.
//
// There is no DOM or renderer here that runs effects, so the hook runs against a stand-in `document`
// with React's `useEffect` replaced by one that runs the effect at once and keeps its cleanup; the
// screens' wiring is proved where it lives, in their source.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ReactModule from 'react';
import { useDocumentTitle } from './useDocumentTitle';

const cleanups: (() => void)[] = [];
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactModule>()),
  useEffect: (effect: () => void | (() => void)) => {
    const cleanup = effect();
    if (typeof cleanup === 'function') cleanups.push(cleanup);
  },
}));

/** Unmount: run the kept cleanups, newest first. */
const unmount = (): void => {
  while (cleanups.length > 0) cleanups.pop()?.();
};

describe('the hook', () => {
  beforeEach(() => {
    vi.stubGlobal('document', { title: 'ECMS' });
  });
  afterEach(() => {
    unmount();
    vi.unstubAllGlobals();
  });

  it('names the tab while the screen is up, and gives it back when it goes', () => {
    useDocumentTitle('EGYCASH');
    expect(document.title).toBe('EGYCASH');
    unmount();
    expect(document.title).toBe('ECMS');
  });

  it('survives one EGYCASH screen replacing another: cleanups run before the next screen sets it', () => {
    useDocumentTitle('EGYCASH'); // the portal sign-in
    unmount();
    useDocumentTitle('EGYCASH'); // the portal, once signed in
    expect(document.title).toBe('EGYCASH');
    unmount(); // signed out to a staff screen
    expect(document.title).toBe('ECMS');
  });
});

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
