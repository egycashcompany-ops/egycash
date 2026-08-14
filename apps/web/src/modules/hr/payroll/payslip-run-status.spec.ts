// A1 on the two screens that surface it — the HR tab and the employee's own page.
//
// THE FINDING was only ever visible on a list that spans RUNS: a month recalculated through a new
// run leaves the cancelled run's payslip beside the new one, and nothing told them apart. Both such
// lists exist on the client, so both must say it, and both must say it the same way.
//
// THE DECISION was to MARK, which means these screens must fail two ways, not one: by not showing
// the mark, and by showing it as a filter — quietly dropping a row is the option the owner
// rejected, and it is the cheapest thing for a later contributor to add "to tidy up the list".
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type Locale } from '@ecms/contracts';
import { translate } from '../../../platform/localization/i18n';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (file: string): string => readFileSync(resolve(HERE, file), 'utf8');
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');

/** The two cross-run surfaces, named — a third one appearing must be added here deliberately. */
const SURFACES: [string, string][] = [
  ['EmployeePayslipsTab', stripComments(read('./components/EmployeePayslipsTab.tsx'))],
  ['MyPayslipsPage', stripComments(read('./pages/MyPayslipsPage.tsx'))],
];

describe('both cross-run lists mark a cancelled run’s payslip', () => {
  it('reads the status the server derived, and tests it against the run’s own word', () => {
    for (const [name, source] of SURFACES) {
      expect(source, name).toContain("s.runStatus === 'cancelled'");
      expect(source, name).toContain("t('payroll.runs.status.cancelled')");
    }
  });

  it('and explains it in words rather than leaving a bare chip', () => {
    for (const [name, source] of SURFACES) {
      expect(source, name).toContain("t('payroll.payslips.fromCancelledRun')");
    }
  });
});

describe('marking is all it does', () => {
  /**
   * The rejected option, guarded on the client too. The server does not filter these rows out, and
   * a screen that did would hide a document somebody may have been paid against — with the extra
   * cruelty that the API would still be returning it.
   */
  it('never filters a row out by its run status', () => {
    for (const [name, source] of SURFACES) {
      expect(source, name).not.toContain("runStatus !== 'cancelled'");
      expect(source, name).not.toMatch(/\.filter\([^)]*runStatus/);
    }
  });

  it('and adds no new state of its own — the label is the run’s vocabulary', () => {
    for (const [name, source] of SURFACES) {
      for (const invented of ['voided', 'superseded', 'invalid', 'obsolete']) {
        expect(source.toLowerCase(), `${name}:${invented}`).not.toContain(invented);
      }
    }
  });

  /** Still a read. A1 changed what a payslip SAYS, not what anybody may do to one. */
  it('and neither screen gained a mutation', () => {
    for (const [name, source] of SURFACES) {
      for (const word of ['useMutation', '.mutate(', 'cancelRun', 'useCancelRun']) {
        expect(source, `${name}:${word}`).not.toContain(word);
      }
    }
  });
});

describe('both locales can say it', () => {
  const KEYS = ['payroll.payslips.fromCancelledRun', 'payroll.runs.status.cancelled'];

  it('resolves in Arabic and English', () => {
    for (const locale of ['ar', 'en'] as Locale[]) {
      for (const key of KEYS) {
        expect(translate(locale, key), `${locale}:${key}`).not.toBe(key);
      }
    }
  });

  it('and says something different in each', () => {
    for (const key of KEYS) {
      expect(translate('ar', key), key).not.toBe(translate('en', key));
    }
  });
});
