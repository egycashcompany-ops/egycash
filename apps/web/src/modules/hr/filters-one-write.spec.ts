// The filters this work converted have to be reachable and have to stick. Three handlers wrote the
// URL twice in one event — the second write rebuilt it from the same pre-click params and put the
// old value back — so «الكل» on «التسويات» and «السلف» never opened (and with it, their filters),
// a month picked on «التسويات» never filtered, and a search typed on «مستندات المتقدمين» was erased.
// Each now writes once: the setter already drops the page. Read from source; the screens need a
// live client to render.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (file: string): string => readFileSync(join(HERE, file), 'utf8');

describe('one URL write per change', () => {
  it.each([['payroll/pages/PayrollAdjustmentsPage.tsx'], ['employee-loans/pages/EmployeeLoansAdminPage.tsx']])(
    '%s opens a tab with one write',
    (file) => {
      const src = read(file);
      expect(src).toContain('onClick={() => setTab(key)}');
      expect(src).not.toMatch(/setTab\(key\);\s*setPage\(1\);/);
    },
  );

  it('filters «التسويات» by the month picked, with one write', () => {
    const src = read('payroll/pages/PayrollAdjustmentsPage.tsx');
    expect(src).toContain('onChange={(e) => setPeriod(e.target.value)}');
    expect(src).not.toMatch(/setPeriod\(e\.target\.value\);\s*setPage\(1\);/);
  });

  it('keeps what is typed into «مستندات المتقدمين»’s search', () => {
    const src = read('recruitment/applicant-documents/pages/ApplicantDocumentsQueuePage.tsx');
    expect(src).toContain('onChange={setSearch}');
    expect(src).not.toMatch(/setSearch\(value\);\s*setPage\(1\);/);
  });
});
