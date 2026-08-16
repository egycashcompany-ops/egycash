// P-HR-23 — a cost centre is a reporting axis, and it must not quietly become anything else.
//
// Three pressures act on this feature, and each has a guard below:
//
//   1. ACCOUNTING. A cost centre is the shape an account mapping eventually attaches to, and the
//      temptation to "just add a code field while we're here" is real. The Accounting phase owns
//      that decision and has not taken it, so no accounting vocabulary may appear anywhere near
//      these files — the same fence U14-1 put around the cost breakdown.
//   2. THE CALCULATION. `costCenterId` is a snapshot beside `branchId`. The moment a rule reads
//      it, a reporting label becomes an input to somebody's pay, and the engine's guarantee that
//      org placement never touches a figure is gone.
//   3. HISTORY. The stamp is written once, at issue. A `$set` on it, or a backfill of old
//      payslips, would rewrite documents that were already handed to people.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { costCenterPermissions, platformPages } from '@ecms/contracts';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(resolve(HERE, rel), 'utf8');
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');

// Comments are stripped before every scan below. These files EXPLAIN the accounting boundary in
// prose — "no account, no mapping, no posting rule" — and a guard that read the explanation as a
// violation would punish the documentation for being explicit.
const MODEL = stripComments(read('./cost-center.model.ts'));
const SERVICE = stripComments(read('./cost-center.service.ts'));
const ROUTES = read('./cost-center.routes.ts');
const A_MODEL = stripComments(
  read('../../../modules/hr/employee-management/cost-center-assignments/cost-center-assignment.model.ts'),
);
const A_SERVICE = stripComments(
  read('../../../modules/hr/employee-management/cost-center-assignments/cost-center-assignment.service.ts'),
);
const A_REPO = stripComments(
  read('../../../modules/hr/employee-management/cost-center-assignments/cost-center-assignment.repository.ts'),
);
const A_ROUTES = read('../../../modules/hr/employee-management/cost-center-assignments/cost-center-assignment.routes.ts');
const PAYSLIP_MODEL = stripComments(read('../../../modules/hr/payroll/payslips/payslip.model.ts'));
const PAYSLIP_SERVICE = stripComments(read('../../../modules/hr/payroll/payslips/payslip.service.ts'));
const RULES = stripComments(read('../../../modules/hr/payroll/compensation/compensation-rules.ts'));
const QUANTITIES = stripComments(
  read('../../../modules/hr/payroll/compensation/attendance-quantities.ts'),
);
const ELIGIBILITY = stripComments(
  read('../../../modules/hr/payroll/payslips/payslip-eligibility.ts'),
);

describe('a cost centre names no account', () => {
  /** The Accounting phase owns every one of these words. None may appear here first. */
  it('carries no accounting vocabulary at all', () => {
    for (const source of [MODEL, SERVICE, A_MODEL, A_SERVICE, A_REPO]) {
      for (const word of ['account', 'ledger', 'journal', 'debit', 'credit', 'posting', 'voucher']) {
        expect(source.toLowerCase(), word).not.toContain(word);
      }
    }
  });

  it('and no mapping, trigger or reversal hides in the catalog', () => {
    for (const word of ['glCode', 'accountCode', 'mapping', 'postTo', 'reversal']) {
      expect(`${MODEL}${SERVICE}`, word).not.toContain(word);
    }
  });
});

describe('the shape the decisions fixed', () => {
  /** D-CC-4 — no hierarchy in this phase. A parent would change every query that follows. */
  it('has no hierarchy', () => {
    for (const forbidden of ['parentId', 'parentCostCenterId', 'path']) {
      expect(MODEL, forbidden).not.toContain(forbidden);
    }
  });

  /** D-CC-3 — employees only. Nothing else may carry a centre yet. */
  it('is carried by the employee assignment and by nothing else', () => {
    expect(A_MODEL).toContain('employeeId');
    for (const foreign of [
      '../../../modules/hr/payroll/pay-items/pay-item.model.ts',
      './../job-titles/job-title.model.ts',
      '../branches/branch.model.ts',
      '../departments/department.model.ts',
      '../sections/section.model.ts',
    ]) {
      expect(read(foreign), foreign).not.toContain('costCenterId');
    }
  });

  /** D-CC-5 — optional. A payslip issues with or without one. */
  it('is nullable on the payslip and refuses nothing', () => {
    expect(PAYSLIP_MODEL).toMatch(/costCenterId:\s*\{[^}]*default:\s*null/);
    expect(PAYSLIP_MODEL).not.toMatch(/costCenterId:\s*\{[^}]*required:\s*true/);
    // No skip reason was added: an unassigned employee is not a refusal.
    expect(ELIGIBILITY).not.toContain('costCenter');
  });

  /** D-CC-8 — placing a person is its own authority, separate from catalog maintenance. */
  it('separates assigning from editing', () => {
    const keys = costCenterPermissions.map((p) => p.key).sort();
    expect(keys).toEqual([
      'costCenter.assign',
      'costCenter.create',
      'costCenter.delete',
      'costCenter.edit',
      'costCenter.view',
    ]);
    expect(A_ROUTES).toContain("authorize('costCenter.assign')");
    expect(A_ROUTES).not.toContain('manageCompensation');
    // …and the catalog's own writes never use the assign key.
    expect(ROUTES).not.toContain('costCenter.assign');
  });

  /** The page registry refuses a permission pointing nowhere, so the page must exist and be ours. */
  it('declares its page, owned by its own module', () => {
    const page = platformPages.find((p) => p.id === 'platform.cost-centers');
    expect(page).toBeDefined();
    expect(page?.moduleId).toBe('platform');
    expect(costCenterPermissions.every((p) => p.pageId === 'platform.cost-centers')).toBe(true);
  });
});

describe('the payslip stamp is a snapshot, not an input', () => {
  /** Pressure 2: the moment a rule reads this, a label becomes part of somebody's pay. */
  it('no calculation reads a cost centre', () => {
    for (const source of [RULES, QUANTITIES, ELIGIBILITY]) {
      expect(source.toLowerCase()).not.toContain('costcenter');
    }
  });

  /** Pressure 3: written once, at issue. `$setOnInsert` is what makes re-running the pass safe. */
  it('is written under $setOnInsert and never re-set', () => {
    const insert = PAYSLIP_SERVICE.slice(
      PAYSLIP_SERVICE.indexOf('$setOnInsert'),
      PAYSLIP_SERVICE.indexOf('{ upsert: true }'),
    );
    expect(insert).toContain('costCenterId:');
    expect(PAYSLIP_SERVICE).not.toMatch(/\$set:\s*\{[^}]*costCenterId/s);
    expect(PAYSLIP_SERVICE).not.toContain('updateMany');
  });

  /** D-CC-7 — the anchor is the period's last day, never the moment the pass happens to run. */
  it('resolves on the period end rather than the issue date', () => {
    expect(PAYSLIP_SERVICE).toContain('costCentresForPopulation(population, window.to)');
    expect(PAYSLIP_SERVICE).not.toContain('costCentresForPopulation(population, issuedAt');
  });

  /** One query for the whole run: a label must not cost a round trip per employee. */
  it('resolves the population in one query', () => {
    expect(A_REPO).toContain('coveringSystem');
    expect(PAYSLIP_SERVICE).toContain('coveringSystem(ids, on)');
  });

  /** The DTO reads the stored value; re-resolving would make an old document answer with today. */
  it('reads the stored value rather than resolving again', () => {
    expect(PAYSLIP_SERVICE).toContain('doc.costCenterId === null ? null : String(doc.costCenterId)');
  });
});

describe('what this phase deliberately did not build', () => {
  /** No backfill (D-CC-5): there was no membership then, and inventing one is not a migration. */
  it('backfills nothing', () => {
    for (const source of [SERVICE, A_SERVICE, PAYSLIP_SERVICE]) {
      for (const forbidden of ['backfill', 'bulkWrite', 'updateMany']) {
        expect(source.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
      }
    }
  });

  /** D-CC-1/D-CC-6: membership is stored, never evaluated from a rule at read time. */
  it('derives membership from no rule', () => {
    for (const forbidden of ['ruleEngine', 'evaluateRule', 'derivedFrom', 'dimensionRule']) {
      expect(`${A_SERVICE}${SERVICE}`, forbidden).not.toContain(forbidden);
    }
  });

  /**
   * No frozen-period guard, and that is a decision rather than an omission: a cost centre changes
   * no figure, and the stamp is immutable once issued — so correcting an old membership is safe.
   */
  it('does not guard the frozen period, because it does not need to', () => {
    expect(A_SERVICE).not.toContain('frozenPeriod');
    expect(A_SERVICE).not.toContain('payrollRunService');
  });

  /** Overlap is the one invariant the collection cannot express as an index. */
  it('refuses overlapping intervals per employee', () => {
    expect(A_REPO).toContain('findOverlapping');
    expect(A_SERVICE).toContain('findOverlapping');
    expect(A_SERVICE).toContain('ConflictError');
  });
});
