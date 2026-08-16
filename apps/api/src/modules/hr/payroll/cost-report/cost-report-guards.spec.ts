// P-HR-25 — the promises this report makes are the kind that must be enforced mechanically.
//
// A report is the easiest place in a system for a boundary to erode without looking like it: an
// axis that quietly widens a scope, a calculated column that becomes an input to pay, a "just this
// once" export. Each guard below is attached to one of those.
//
// Comments are stripped before every scan. These files EXPLAIN what they refuse — `$expr`, `export`,
// `calcBasis` and `payroll` all appear in their prose — and a guard that read the explanation as a
// violation would punish the documentation for being explicit (the lesson P-HR-23 recorded).
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PAYROLL_REPORT_GROUP_BY, PAYROLL_REPORT_MAX_COLUMNS } from '@ecms/contracts';
import { COST_REPORT_CATALOG } from './cost-report.row';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(resolve(HERE, rel), 'utf8');
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');

const FEATURE_FILES = [
  'cost-report.service.ts',
  'cost-report.row.ts',
  'cost-report.controller.ts',
  'cost-report.routes.ts',
  'index.ts',
] as const;
const FEATURE = FEATURE_FILES.map((name) => [name, stripComments(read(`./${name}`))] as const);

const SERVICE = stripComments(read('./cost-report.service.ts'));
const ROW = stripComments(read('./cost-report.row.ts'));
const ROUTES = read('./cost-report.routes.ts');
const REPOSITORY = stripComments(read('../payslips/payslip.repository.ts'));

describe('R1/R2 — an axis arranges what the caller may see, it does not widen it', () => {
  it('the report runs through the one scoped pipeline, and opens no query of its own', () => {
    expect(SERVICE).toContain('lineTotalsByAxisForRun(runId, scope, groupBy)');
    for (const [name, source] of FEATURE) {
      for (const forbidden of ['aggregate(', '$match', 'PayslipModel', 'find(']) {
        expect(source, `${name}: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('and that pipeline still applies the caller’s scope (A2)', () => {
    const pipeline = REPOSITORY.slice(REPOSITORY.indexOf('private async groupLines'));
    expect(pipeline).toContain('this.baseFilter(scope,');
    expect(pipeline).not.toHaveLength(0);
  });

  it('and no Mongo evaluation operator appears anywhere in the feature', () => {
    for (const [name, source] of FEATURE) {
      for (const operator of ['$expr', '$function', '$where', '$accumulator', 'eval(', 'new Function']) {
        expect(source, `${name}: ${operator}`).not.toContain(operator);
      }
    }
  });
});

describe('R3 — a calculated column never becomes an input to pay', () => {
  it('no payroll calculation imports this feature', () => {
    for (const file of [
      '../compensation/compensation-rules.ts',
      '../compensation/attendance-quantities.ts',
      '../payslips/payslip-eligibility.ts',
    ]) {
      const source = stripComments(read(file));
      // Not vacuous: these files exist, are substantial, and still say what they always said.
      expect(source.length, file).toBeGreaterThan(500);
      for (const symbol of ['cost-report', 'costReportService', 'computeColumns', 'evaluateExpression']) {
        expect(source, `${file}: ${symbol}`).not.toContain(symbol);
      }
    }
    expect(stripComments(read('../compensation/compensation-rules.ts'))).toContain('calcBasis');
  });

  it('and the report names no rule of its own — it sums stored lines and nothing else', () => {
    for (const forbidden of ['calcBasis', 'prorat', 'toMinorUnits', 'scaleMinorUnits']) {
      expect(SERVICE, forbidden).not.toContain(forbidden);
    }
  });
});

describe('R4/R6 — the axes are closed, and currency is not one of them', () => {
  it('offers exactly four axes', () => {
    expect([...PAYROLL_REPORT_GROUP_BY]).toEqual(['origin', 'payItem', 'branch', 'costCenter']);
  });

  it('and every axis key carries currency and kind, so no total spans two currencies', () => {
    const keys = REPOSITORY.slice(REPOSITORY.indexOf('const GROUP_KEYS'), REPOSITORY.indexOf('class PayslipRepository'));
    expect(keys).not.toHaveLength(0);
    for (const axis of PAYROLL_REPORT_GROUP_BY) {
      expect(keys, axis).toContain(`${axis}:`);
    }
    // One `currency` and one `kind` per axis — four of each, and no axis without them.
    expect((keys.match(/currency: '\$currency'/g) ?? []).length).toBe(PAYROLL_REPORT_GROUP_BY.length);
    expect((keys.match(/kind: '\$lines\.kind'/g) ?? []).length).toBe(PAYROLL_REPORT_GROUP_BY.length);
  });

  it('and the request is bounded — a report, not a spreadsheet', () => {
    expect(PAYROLL_REPORT_MAX_COLUMNS).toBe(10);
  });
});

describe('R5 — the cost centre is the stamp, never today’s membership', () => {
  it('groups by the value stored on the payslip', () => {
    expect(REPOSITORY).toContain("costCenterId: '$costCenterId'");
    expect(REPOSITORY).toContain('costCenterId: 1');
  });

  it('and the report never reads the assignment collection', () => {
    for (const [name, source] of FEATURE) {
      for (const forbidden of [
        'costCenterAssignment',
        'coveringSystem',
        'costCentreOn',
        'effectiveFrom',
      ]) {
        expect(source, `${name}: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});

describe('R7/R8 — it reads, and it hands over no document', () => {
  it('writes nothing, anywhere in the feature', () => {
    for (const [name, source] of FEATURE) {
      for (const forbidden of [
        'updateOne',
        'updateMany',
        'insertOne',
        'insertMany',
        'bulkWrite',
        'deleteOne',
        'save(',
        'auditService',
        'eventBus',
      ]) {
        expect(source, `${name}: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('and offers no export — no CSV, no PDF, no attachment (D-REPORT-10)', () => {
    for (const [name, source] of FEATURE) {
      for (const forbidden of ['csv', 'pdf', 'Content-Disposition', 'attachment', 'createWriteStream']) {
        expect(source.toLowerCase(), `${name}: ${forbidden}`).not.toContain(forbidden.toLowerCase());
      }
    }
  });

  it('and stores no definition — the request is answered and forgotten (D-REPORT-1 = C)', () => {
    // `new Schema(` and `model(`, not the bare word: this feature legitimately declares a ZOD
    // schema for the row shape, and a guard that read `CostReportRowSchema` as persistence would be
    // forbidding the very thing that makes the catalog derived rather than hand-written.
    for (const [name, source] of FEATURE) {
      for (const forbidden of ['new Schema(', 'mongoose', 'reportDefinition', 'savedReport']) {
        expect(source, `${name}: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});

describe('R9 — the expression engine is consumed, never extended', () => {
  it('imports it from the contracts package rather than reaching into it', () => {
    expect(ROW).toContain("from '@ecms/contracts'");
    expect(ROW).toContain('validateExpression');
    expect(ROW).toContain('evaluateExpression');
    for (const [name, source] of FEATURE) {
      expect(source, `${name}`).not.toContain('src/expression');
    }
  });

  it('and adds no operation, no node kind and no parser of its own', () => {
    for (const [name, source] of FEATURE) {
      for (const forbidden of ["'round'", "'sum'", "'coalesce'", 'tokeni', 'parseExpression']) {
        expect(source, `${name}: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('and the catalog it validates against is DERIVED, not hand-written', () => {
    expect(ROW).toContain('expressionCatalogFromSchema');
    // D-REPORT-13: this row's own numbers, and nothing from any other row.
    expect(COST_REPORT_CATALOG.fields.map((field) => field.path).sort()).toEqual([
      'amount',
      'amountMinor',
      'lines',
    ]);
  });
});

describe('D-REPORT-4 — no new permission, and the existing one is the gate', () => {
  it('is behind the key that already governs reading somebody’s pay', () => {
    expect([...ROUTES.matchAll(/authorize\('([^']+)'\)/g)].map((match) => match[1])).toEqual([
      'employee.viewCompensation',
    ]);
  });

  it('and declares no permission of its own', () => {
    for (const [name, source] of FEATURE) {
      expect(source, name).not.toContain('declarePermissions');
    }
  });
});
