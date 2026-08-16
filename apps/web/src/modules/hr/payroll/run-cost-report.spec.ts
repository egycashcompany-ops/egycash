// P-HR-25 — the reader chooses an axis, and that is the ONLY thing they choose.
//
// Web tests run in node here: no DOM, no clicks, no `useEffect`. So these read the component and
// its bindings as source, which is the right level for what they assert anyway — that this panel
// proposes no business figure, invents no column, and does no arithmetic the server did not do.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PAYROLL_REPORT_GROUP_BY, type Locale } from '@ecms/contracts';
import { translate } from '../../../platform/localization/i18n';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(resolve(HERE, rel), 'utf8');
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');

const PANEL = stripComments(read('./components/RunCostReport.tsx'));
const API = stripComments(read('./api/payroll-api.ts'));
const QUERIES = stripComments(read('./api/payroll-queries.ts'));
const BREAKDOWN = stripComments(read('./components/RunCostBreakdown.tsx'));

describe('it asks for one axis, from the contract’s own list', () => {
  it('offers exactly the axes the contract declares — no hand-written list', () => {
    expect(PANEL).toContain('PAYROLL_REPORT_GROUP_BY.map');
    expect([...PAYROLL_REPORT_GROUP_BY]).toEqual(['origin', 'payItem', 'branch', 'costCenter']);
  });

  it('posts to the report route, and the axis is part of the cache key', () => {
    expect(API).toContain('/cost-report`');
    expect(QUERIES).toContain('{ runId, groupBy }');
  });

  it('and sends no calculated column — which derived figure matters is not ours to decide', () => {
    expect(QUERIES).toContain('columns: []');
    // Whole words only: `shared/lib/format` is an import path, not a proposed "share of total"
    // column, and a substring scan would read the one as the other.
    for (const invented of ['perLine', 'average', 'percent', 'ratio', 'share', 'subtotal']) {
      expect(PANEL, invented).not.toMatch(new RegExp(`\\b${invented}\\b`, 'i'));
    }
    // …and it builds no expression of its own to send.
    expect(PANEL).not.toContain('kind: ');
  });
});

describe('the breakdown beside it is untouched', () => {
  it('still states all three splits and still asks nothing', () => {
    expect(BREAKDOWN).toContain('byOrigin');
    expect(BREAKDOWN).toContain('byPayItem');
    expect(BREAKDOWN).toContain('byBranch');
    expect(BREAKDOWN).not.toContain('groupBy');
  });
});

describe('the arithmetic stays the server’s', () => {
  it('does none of its own, and converts through the shared helper', () => {
    expect(PANEL).toContain('fromMinorUnits(minor)');
    expect(PANEL).not.toContain('/ 100');
    // Spaced operators, as the sibling panel's guard states them: a bare `-` is every Tailwind
    // class in the file, and a guard that matched those would be asserting nothing at all.
    for (const operator of [' * ', ' - ', ' + ', 'Math.', 'reduce(']) {
      expect(PANEL, operator).not.toContain(operator);
    }
  });

  /** Direction is what `kind` means; subtracting one from the other would be an accounting choice. */
  it('never nets earnings against deductions, and prints a currency on every row', () => {
    expect(PANEL).toContain('payroll.cost.kind.');
    expect(PANEL).not.toContain('net');
    expect(PANEL).toContain('row.currency');
  });
});

describe('a group with no label is shown, not hidden (D-REPORT-7 / P-HR-23)', () => {
  it('renders an unassigned axis value rather than dropping the row', () => {
    expect(PANEL).toContain('payroll.costReport.unassigned');
    expect(PANEL).not.toContain('.filter(');
  });

  it('and an uncomputable column reads as an em dash rather than a zero', () => {
    expect(PANEL).toContain("'—'");
    expect(PANEL).not.toContain('?? 0');
  });
});

describe('and nothing else was added', () => {
  it('no page, no permission, no export — it rides a dialog that is already gated', () => {
    for (const forbidden of ['<Can', 'useNavigate', 'Route', 'csv', 'download', 'window.open']) {
      expect(PANEL, forbidden).not.toContain(forbidden);
    }
  });

  it('and it is a read: no mutation and no run transition', () => {
    for (const forbidden of ['useMutation', 'invalidateQueries', 'freeze', 'approve']) {
      expect(PANEL, forbidden).not.toContain(forbidden);
    }
  });
});

describe('both locales can say it', () => {
  const KEYS = [
    'payroll.costReport.title',
    'payroll.costReport.hint',
    'payroll.costReport.groupBy',
    'payroll.costReport.unassigned',
    ...PAYROLL_REPORT_GROUP_BY.map((axis) => `payroll.costReport.axis.${axis}`),
  ];

  it('resolves every key in Arabic and English', () => {
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
