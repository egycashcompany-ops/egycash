// The settlement pages' shared view rules (docs/12-planning/atm-settlements-phase1.md §9.3, §10.4).
import {
  ATM_PLAN_LINE_ERROR_CODES,
  ATM_PLAN_LINE_WARNING_CODES,
  type AtmPlanSlot,
} from '@ecms/contracts';
import { describe, expect, it } from 'vitest';
import { translate } from '../../../platform/localization/i18n';
import {
  bagsText,
  issueText,
  lineChips,
  lineStatusKey,
  planState,
  preparationStatusKey,
  runLabel,
} from './settlement-view';

const ar = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);
const en = (key: string, params?: Record<string, string | number>): string =>
  translate('en', key, params);

const byStatus = (draft: number, issued: number, prepared: number, cancelled = 0) => ({
  byStatus: { draft, issued, prepared, cancelled },
});

const slot = (
  n: number,
  kind: AtmPlanSlot['kind'],
  denomination: number | null,
  notes: number,
  currency: string | null = 'EGP',
): AtmPlanSlot => ({ slot: n, kind, denomination, currency, notes, bag: null });

describe('planState', () => {
  it('no line issued → draft; every live line issued or prepared → issued; drafts left → partly', () => {
    expect(planState(byStatus(0, 0, 0))).toBe('draft');
    expect(planState(byStatus(3, 0, 0, 2))).toBe('draft');
    expect(planState(byStatus(0, 2, 1, 1))).toBe('issued');
    expect(planState(byStatus(0, 0, 4))).toBe('issued');
    expect(planState(byStatus(1, 2, 0))).toBe('partlyIssued');
  });
});

describe('lineChips', () => {
  it('one chip per planned slot, in slot order, coloured per denomination', () => {
    const chips = lineChips([
      slot(3, 'withdrawal', 50, 1500),
      slot(1, 'empty', null, 0, null),
      slot(2, 'withdrawal', 200, 4000),
      slot(4, 'deposit', null, 0),
      slot(5, 'recycle', 100, 2000),
      slot(6, 'withdrawal', 20, 0, 'USD'),
    ]);
    expect(chips.map((c) => [c.slot, c.denomination, c.notes])).toEqual([
      [2, 200, 4000],
      [3, 50, 1500],
      [5, 100, 2000],
    ]);
    expect(chips[0]).toMatchObject({ background: '#e0e7ff', colour: '#3730a3' });
    expect(chips[2]).toMatchObject({ background: '#d1fae5', colour: '#065f46' });
  });
});

describe('the words', () => {
  it('bagsText: one bag or two', () => {
    expect(bagsText(1, ar)).toBe('شوال واحد');
    expect(bagsText(2, ar)).toBe('شوالان (4 كاسيتات في الشوال)');
    expect(bagsText(2, en)).toBe('Two bags (4 cassettes per bag)');
  });

  it('issueText words every issue code, in both languages, a slot issue naming its cassette', () => {
    for (const code of [...ATM_PLAN_LINE_ERROR_CODES, ...ATM_PLAN_LINE_WARNING_CODES]) {
      for (const t of [ar, en]) {
        const text = issueText({ code, severity: 'warning', slot: 3 }, t);
        expect(text, code).not.toBe(`atm.settlement.issue.${code}`);
        expect(text, code).not.toMatch(/\{\{/u);
      }
    }
    expect(issueText({ code: 'NOT_MULTIPLE_OF_100', severity: 'warning', slot: 3 }, ar)).toBe(
      'عدد الورق في الكاسيت 3 ليس من مضاعفات 100.',
    );
    expect(issueText({ code: 'NO_LAYOUT', severity: 'error' }, ar)).toBe(
      'لم تُسجَّل فئات الكاسيتات لهذه الماكينة.',
    );
  });

  it('runs and statuses have their words', () => {
    expect(runLabel(1, ar)).toBe('التغذية الأولى');
    expect(runLabel(3, en)).toBe('3rd run');
    expect(ar(lineStatusKey('prepared'))).toBe('جاهزة');
    expect(en(lineStatusKey('issued'))).toBe('Issued');
    expect(ar(preparationStatusKey('partial'))).toBe('ناقصة');
  });
});
