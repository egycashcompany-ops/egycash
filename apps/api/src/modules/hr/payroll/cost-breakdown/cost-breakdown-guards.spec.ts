// P-HR-14 / U14-1 — the arithmetic a general ledger would consume, and nothing that decides one.
//
// WHY THIS FILE IS MOSTLY ABOUT ABSENCES. The whole justification for building this now is that it
// names no account: a chart of accounts, a pay-item→account mapping, a posting rule, a trigger, a
// granularity and a reversal policy are six decisions the owner has not made, and P-HR-14's
// discovery keeps them open. The figures happen to be exactly what a journal needs — which is what
// makes this useful, and also what makes it one careless commit away from becoming a posting.
//
// So the guards assert, in order of how easily each would be lost:
//   1. no accounting vocabulary anywhere in the feature;
//   2. no write of any kind — this is a read over frozen documents;
//   3. the caller's scope on every aggregate (audit finding A2, which this file inherits);
//   4. no net across `kind`, and no total across currencies;
//   5. no new permission, page, event, index, collection or migration.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAYROLL = resolve(HERE, '..');
const CONTRACTS = resolve(HERE, '../../../../../../../packages/contracts/src/modules/hr-payroll.ts');

/** Code only — the prose above and in the feature must never satisfy an assertion. */
const code = (file: string): string =>
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '');

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return entry.name.endsWith('.ts') && !entry.name.includes('.spec.') ? [full] : [];
  });

const FEATURE = sources(HERE);
const service = code(resolve(HERE, 'cost-breakdown.service.ts'));
const controller = code(resolve(HERE, 'cost-breakdown.controller.ts'));
const routes = code(resolve(HERE, 'cost-breakdown.routes.ts'));
const repository = code(resolve(PAYROLL, 'payslips/payslip.repository.ts'));
const contracts = code(CONTRACTS);

describe('it names no account, and posts nothing', () => {
  it('carries no accounting vocabulary at all', () => {
    // Every word here is a decision that has not been made. One of them appearing in this feature
    // means P-HR-14's blocked half was opened without an answer.
    const forbidden = [
      'account',
      'ledger',
      'journal',
      'posting',
      'debit',
      'credit',
      'chartof',
      'fiscal',
      'voucher',
    ];
    for (const file of FEATURE) {
      const lower = code(file).toLowerCase();
      for (const word of forbidden) {
        expect(lower, `${file.slice(PAYROLL.length + 1)}:${word}`).not.toContain(word);
      }
    }
  });

  it('and the DTOs it returns name none either', () => {
    const dto = contracts.slice(
      contracts.indexOf('export interface PayrollRunCostRowDto'),
      contracts.indexOf('export const PAYROLL_ADJUSTMENT_KINDS'),
    );
    expect(dto.length).toBeGreaterThan(200);
    for (const word of ['account', 'ledger', 'journal', 'debit', 'credit', 'posting']) {
      expect(dto.toLowerCase(), word).not.toContain(word);
    }
  });
});

describe('it is a read over frozen documents', () => {
  it('writes nothing, anywhere in the feature', () => {
    for (const file of FEATURE) {
      const source = code(file);
      for (const write of [
        'updateOne',
        'updateMany',
        'insertOne',
        'insertMany',
        'save(',
        'create(',
        'deleteOne',
        'softDelete',
        '$set',
      ]) {
        expect(source, `${file.slice(PAYROLL.length + 1)}:${write}`).not.toContain(write);
      }
    }
  });

  it('and offers exactly one route — a GET, with no query parameter', () => {
    expect([...routes.matchAll(/router\.(get|post|patch|put|delete)\(/g)].map((m) => m[1])).toEqual([
      'get',
    ]);
    // A grouping, a filter or a period selector would each be a report definition — the half of
    // P-HR-15 that stays blocked. The three splits are stated in full instead.
    expect(routes).not.toContain('query:');
    expect(controller).not.toContain('query');
  });

  it('and issues no event and sends no notice', () => {
    for (const file of FEATURE) {
      const source = code(file);
      expect(source).not.toContain('eventBus');
      expect(source).not.toContain('notificationService');
      expect(source).not.toContain('publish');
    }
  });
});

describe('every aggregate takes the caller’s scope (A2)', () => {
  it('all three splits go through the one scoped pipeline', () => {
    for (const method of [
      'lineTotalsByOriginForRun',
      'lineTotalsByPayItemForRun',
      'lineTotalsByBranchForRun',
    ]) {
      expect(repository, method).toContain(method);
    }
    const pipeline = repository.slice(repository.indexOf('private async groupLines'));
    expect(pipeline).toContain('this.baseFilter(scope,');
    // ONE pipeline, so there is one place a missing filter could ever be — and the three public
    // methods must not grow `$match` stages of their own.
    const publicMethods = repository.slice(
      repository.indexOf('async lineTotalsByOriginForRun'),
      repository.indexOf('private async groupLines'),
    );
    expect(publicMethods).not.toContain('$match');
    expect(publicMethods).not.toContain('aggregate');
  });

  it('and the service passes the caller’s scope into each of them', () => {
    expect(service).toContain('scope: ScopeSelector');
    expect((service.match(/, scope\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(service).not.toContain('listAllSystem');
    expect(service).not.toContain('System(');
  });

  it('and the route is behind the key that already governs reading somebody’s pay', () => {
    expect([...routes.matchAll(/authorize\('([^']+)'\)/g)].map((m) => m[1])).toEqual([
      'employee.viewCompensation',
    ]);
  });
});

describe('the arithmetic says only what the lines say', () => {
  /**
   * The defect this would most easily become. Direction is what `kind` MEANS, so an earning and a
   * deduction are two answers rather than one difference — subtracting them is a choice about what
   * offsets what, which is accounting.
   */
  it('never nets an earning against a deduction', () => {
    expect(repository).toContain("kind: '$lines.kind'");
    for (const file of FEATURE) {
      const source = code(file);
      expect(source, file).not.toContain('net');
      expect(source, file).not.toContain('$subtract');
    }
  });

  /**
   * No exchange rate exists in this system, so currency is a group key in EVERY split.
   *
   * P-HR-25 moved the keys out of the three method bodies and into one `GROUP_KEYS` map, so this
   * reads the map rather than each method — and the claim got stronger rather than looser: it now
   * covers all four axes, including the one the dynamic report added, in the single place they are
   * defined. A key that forgot its currency would have to be written here, in front of this test.
   */
  it('and never totals across currencies', () => {
    const keys = repository.slice(
      repository.indexOf('const GROUP_KEYS'),
      repository.indexOf('class PayslipRepository'),
    );
    expect(keys, 'GROUP_KEYS block').not.toHaveLength(0);
    for (const axis of ['origin', 'payItem', 'branch', 'costCenter']) {
      expect(keys, axis).toContain(`${axis}:`);
    }
    expect((keys.match(/currency: '\$currency'/g) ?? []).length).toBe(4);
    // …and the three splits this feature states still read from that map rather than inlining keys.
    for (const method of [
      'lineTotalsByOriginForRun',
      'lineTotalsByPayItemForRun',
      'lineTotalsByBranchForRun',
    ]) {
      expect(repository, method).toContain(method);
    }
  });

  it('and recomputes nothing — it reads the stored line, including its stored code', () => {
    expect(service).not.toContain('computeCompensation');
    expect(service).not.toContain('effectsForEmployee');
    expect(service).toContain('row.code');
    // The catalog is not consulted for the label: a payslip line keeps its own copy so a later
    // rename cannot restate a document somebody was paid against.
    expect(service).not.toContain('payItemRepository');
    expect(service).not.toContain('payItemService');
  });
});

describe('and nothing else was added', () => {
  it('no model, no repository, no migration in the feature', () => {
    const names = FEATURE.map((f) => f.slice(HERE.length + 1)).sort();
    expect(names).toEqual([
      'cost-breakdown.controller.ts',
      'cost-breakdown.routes.ts',
      'cost-breakdown.service.ts',
      'index.ts',
    ]);
  });

  it('and no new index on the payslip collection', () => {
    const model = code(resolve(PAYROLL, 'payslips/payslip.model.ts'));
    expect([...model.matchAll(/name: '([a-z_]+)'/g)].map((m) => m[1])).toEqual([
      'ux_run_employee',
      'ix_employee_period',
    ]);
  });

  /** PY-12 is closed by decision, and "the figures a ledger needs" is exactly how it reopens. */
  it('and offers no document — no export, no PDF, no CSV', () => {
    for (const file of FEATURE) {
      const lower = code(file)
        .replace(/\bexport (const|default|function|type|interface|\*|\{)/g, '')
        .toLowerCase();
      for (const word of ['pdf', 'csv', 'export', 'download', 'attachment']) {
        expect(lower, `${file.slice(HERE.length + 1)}:${word}`).not.toContain(word);
      }
    }
  });
});
