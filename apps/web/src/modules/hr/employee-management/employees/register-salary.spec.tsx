// «عاوز اشيل حتت الراتب دي و اعملها سكشن لوحدها» — the salary leaves «شروط التوظيف» for its own
// section on «تسجيل موظف». Pinned at the source: the page needs a router, a store and a query
// client to render, while what matters — where the field is, and what can be typed — is plain in it.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Locale } from '@ecms/contracts';
import { translate } from '../../../../platform/localization/i18n';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(join(HERE, 'pages/DirectRegisterPage.tsx'), 'utf8');
const CARD = readFileSync(join(HERE, 'components/SalaryCard.tsx'), 'utf8');

describe('the salary on «تسجيل موظف»', () => {
  it('is no longer a field of «شروط التوظيف»', () => {
    const start = PAGE.indexOf("t('employees.detail.employment')");
    const terms = PAGE.slice(start, PAGE.indexOf('</Card>', start));
    expect(terms).not.toContain('MoneyInput');
    expect(terms).not.toContain("t('offers.form.salary')");
  });

  it('is its own section, after the terms, for the same people who could set it before', () => {
    expect(PAGE).toContain('{canComp && <SalaryCard value={salary} onChange={setSalary} />}');
    expect(PAGE.indexOf('<SalaryCard')).toBeGreaterThan(PAGE.indexOf("t('employees.detail.employment')"));
  });

  /** One figure is typed; the rest follow from it and cannot be typed. */
  it('takes one input — the gross — and computes the rest', () => {
    expect([...CARD.matchAll(/<MoneyInput/g)]).toHaveLength(1);
    expect(CARD).toContain('salaryBreakdown(gross)');
    expect(CARD).toContain('amountInArabicWords(parts.gross)');
  });

  it('has every label in both languages', () => {
    const keys = [
      'title', 'gross', 'fixed', 'fixedRule', 'attendanceBonus', 'attendanceBonusRule',
      'insurance', 'insuranceRule', 'inWords', 'computedNote',
    ];
    for (const locale of ['en', 'ar'] as Locale[]) {
      for (const key of keys) {
        expect(translate(locale, `employees.salary.${key}`)).not.toBe(`employees.salary.${key}`);
      }
    }
  });
});
