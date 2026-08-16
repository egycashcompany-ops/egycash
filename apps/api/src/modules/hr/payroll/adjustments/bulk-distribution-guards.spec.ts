// P-HR-13 — a distribution, and the boundary that keeps it one.
//
// THE DECISION THIS PHASE RESTS ON: finance decides each person's amount OUTSIDE this system, and
// ECMS records the result. So there is no pool, no formula, no percentage, no ratio, no eligibility
// rule, no service-length rule and no proration anywhere in this path — every one of those is a
// financial rule nobody has given, and the amount is never computed here.
//
// THE SECOND THING THESE GUARDS PROTECT is subtler and matters more. A bulk path is the natural
// place for somebody to "just write the rows directly" — and every rule a single adjustment obeys
// (positive amount, the employee's own currency, one employment span, the frozen month, the
// duplicate, the `draft` start, the audit entry) lives in `create`. A second implementation would
// drift, silently, on money. So the batch must call `create`, and these tests say so.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTRACTS = resolve(HERE, '../../../../../../../packages/contracts/src/modules/hr-payroll.ts');

/** Code only — the prose in these files must never satisfy an assertion. */
const code = (file: string): string =>
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '');

const service = code(resolve(HERE, 'payroll-adjustment.service.ts'));
const controller = code(resolve(HERE, 'payroll-adjustment.controller.ts'));
const routes = code(resolve(HERE, 'payroll-adjustment.routes.ts'));
const contracts = code(CONTRACTS);

/** `createMany` alone — the file around it is P-HR-04's and must not be read as this phase's. */
const createMany = ((): string => {
  const from = service.indexOf('async createMany');
  const to = service.indexOf('async update(', from);
  return service.slice(from, to === -1 ? undefined : to);
})();

describe('ECMS records the amount, and never computes it', () => {
  it('the batch path contains no calculation vocabulary at all', () => {
    expect(createMany.length).toBeGreaterThan(500);
    for (const word of [
      'pool',
      'formula',
      'percent',
      'ratio',
      'eligib',
      'tenure',
      'seniority',
      'prorat',
      'distributeAmong',
      'share(',
    ]) {
      expect(createMany.toLowerCase(), word).not.toContain(word.toLowerCase());
    }
  });

  it('and does no arithmetic on the amount it was handed', () => {
    // The row's amount reaches `create` untouched. Any operator here would be a rule about money.
    expect(createMany).toContain('amount: row.amount');
    for (const operator of [' * ', ' / ', ' % ', 'Math.', '+ row.amount', 'row.amount *']) {
      expect(createMany, operator).not.toContain(operator);
    }
  });

  it('and the contract asks for no basis on which one could be computed', () => {
    const schema = contracts.slice(
      contracts.indexOf('export const BulkPayrollAdjustmentRowSchema'),
      contracts.indexOf('export const ListPayrollAdjustmentsQuerySchema'),
    );
    expect(schema.length).toBeGreaterThan(200);
    for (const field of ['pool', 'percentage', 'weight', 'basicSalary', 'serviceYears', 'grade']) {
      expect(schema, field).not.toContain(field);
    }
  });
});

describe('it reuses the single-adjustment path rather than restating it', () => {
  it('calls `create` per row and writes no row itself', () => {
    expect(createMany).toContain('await this.create(');
    for (const write of [
      'PayrollAdjustmentModel.create',
      'insertMany',
      'updateOne',
      'bulkWrite',
      '$set',
    ]) {
      expect(createMany, write).not.toContain(write);
    }
  });

  it('and therefore restates none of the guards it must obey', () => {
    // Each of these lives in `create`/`assertRecordable`. A copy here is the drift this forbids.
    for (const guard of [
      'assertPeriodOpen',
      'frozenPeriods',
      'spanContaining',
      'findDuplicate',
      'employmentSpansOf',
    ]) {
      expect(createMany, guard).not.toContain(guard);
    }
  });

  it('and starts every row as a draft — the second person is untouched', () => {
    expect(createMany).not.toContain("'approved'");
    expect(createMany).not.toContain("'pendingApproval'");
    expect(createMany).not.toContain('decide');
    expect(createMany).not.toContain('submit');
  });
});

describe('the batch-level rules the owner decided', () => {
  it('one period for the whole batch, never one per row (D13-3)', () => {
    const row = contracts.slice(
      contracts.indexOf('export const BulkPayrollAdjustmentRowSchema'),
      contracts.indexOf('export const BulkCreatePayrollAdjustmentsSchema'),
    );
    expect(row).not.toContain('period');
    const batch = contracts.slice(
      contracts.indexOf('export const BulkCreatePayrollAdjustmentsSchema'),
      contracts.indexOf('export type BulkCreatePayrollAdjustments '),
    );
    expect(batch).toContain('period: adjustmentPeriod');
    expect(createMany).toContain('period: input.period');
  });

  it('the pay item is required, and checked for existence, life and direction (D13-4)', () => {
    const batch = contracts.slice(
      contracts.indexOf('export const BulkCreatePayrollAdjustmentsSchema'),
      contracts.indexOf('export type BulkCreatePayrollAdjustments '),
    );
    // Required: no `.optional()` on this one, unlike the single-adjustment schema's.
    expect(batch).toMatch(/payItemId: objectId\(\),/);
    expect(createMany).toContain('payItemRepository.findById');
    expect(createMany).toContain("item.status !== 'active'");
    expect(createMany).toContain("item.kind !== 'earning'");
  });

  it('bonus only — a clawback does not travel here (D13-6)', () => {
    expect(createMany).toContain("kind: 'bonus'");
    expect(createMany).not.toContain("'penalty'");
    // And the caller cannot ask for one: the schema has no `kind` at all.
    const batch = contracts.slice(
      contracts.indexOf('export const BulkPayrollAdjustmentRowSchema'),
      contracts.indexOf('export type BulkCreatePayrollAdjustments '),
    );
    expect(batch).not.toContain('kind:');
  });

  it('the currency is derived from the employee, never typed (D13-5)', () => {
    const batch = contracts.slice(
      contracts.indexOf('export const BulkPayrollAdjustmentRowSchema'),
      contracts.indexOf('export type BulkCreatePayrollAdjustments '),
    );
    expect(batch).not.toContain('currency');
    expect(createMany).toContain('employee.employment.salary?.currency');
  });

  it('and the batch is bounded and non-empty (D13-7)', () => {
    const batch = contracts.slice(
      contracts.indexOf('export const BulkCreatePayrollAdjustmentsSchema'),
      contracts.indexOf('export type BulkCreatePayrollAdjustments '),
    );
    expect(batch).toContain('.min(1).max(5000)');
  });
});

describe('one bad row costs nobody else their payment', () => {
  it('refusals are reported per row, not thrown', () => {
    expect(createMany).toContain('rejected.push(');
    expect(createMany).toContain('index');
    expect(createMany).toContain('continue;');
  });

  it('a duplicate is counted rather than treated as a failure — a re-run is safe', () => {
    expect(createMany).toContain('error instanceof ConflictError');
    expect(createMany).toContain('duplicates += 1');
  });

  /** The one thing that must still explode: anything that is not the domain refusing. */
  it('and an unexpected error still travels', () => {
    expect(createMany).toContain('throw error;');
    expect(createMany).toContain('error instanceof BusinessRuleError');
  });
});

describe('and nothing else was added', () => {
  it('no new permission — the key that records one adjustment records three hundred', () => {
    const bulk = routes.slice(routes.indexOf("router.post(\n    '/bulk'"));
    expect(bulk).toContain("authorize('payrollAdjustment.create')");
    expect(routes).not.toContain('payrollAdjustment.bulk');
    expect(routes).not.toContain('profitShar');
  });

  it('no new entity, status, kind or event', () => {
    for (const word of ['profitShar', 'ProfitShar', 'PROFIT_SHARE']) {
      for (const source of [service, controller, routes, contracts]) {
        expect(source, word).not.toContain(word);
      }
    }
    expect(createMany).not.toContain('emit(');
    expect(createMany).not.toContain('notificationsService');
  });

  it('and no export, no document, no accounting', () => {
    const lower = createMany.toLowerCase();
    for (const word of ['pdf', 'csv', 'export', 'ledger', 'journal', 'account']) {
      expect(lower, word).not.toContain(word);
    }
  });
});
