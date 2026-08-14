// A1 — a cancelled run's payslips are MARKED, and marked is all they are.
//
// THE FINDING (audit 2026-08, docs/12-planning/hr-payroll-audit-2026-08.md §A1). `ux_live_period`
// excludes `cancelled` on purpose, so a period can be recalculated by a new run; the cancelled
// run's payslips survive it, because a payslip has no update path. Once P-HR-20 and PY-11 began
// listing a person's payslips ACROSS runs, a recalculated month showed two documents with nothing
// saying that one of them came from a run somebody cancelled.
//
// THE DECISION, taken by the owner from three options: MARK them. Not hide them — that would
// conceal a document somebody may have been paid against. Not forbid the cancellation — that would
// contradict P-HR-10's recovery path.
//
// This file guards the shape of that decision, and it guards the two rejected options just as
// hard: the cheapest way to "fix" A1 later would be a filter, and the cheapest way to make the
// mark convenient would be to store it.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAYROLL = resolve(HERE, '..');
const CONTRACTS = resolve(HERE, '../../../../../../../packages/contracts/src/modules/hr-payroll.ts');
const API_SRC = resolve(HERE, '../../../../');

/** Code only — prose in these files must never satisfy an assertion. */
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

const model = code(resolve(HERE, 'payslip.model.ts'));
const service = code(resolve(HERE, 'payslip.service.ts'));
const controller = code(resolve(HERE, 'payslip.controller.ts'));
const routes = code(resolve(HERE, 'payslip.routes.ts'));
const runRepository = code(resolve(PAYROLL, 'runs/payroll-run.repository.ts'));
const runService = code(resolve(PAYROLL, 'runs/payroll-run.service.ts'));
const contracts = code(CONTRACTS);

describe('the mark is derived, never stored', () => {
  it('the payslip schema gains no status field of any kind', () => {
    expect(model).not.toContain('runStatus');
    expect(model).not.toContain('cancelled');
    // And the collection still has no update path to keep such a copy true with.
    const repository = code(resolve(HERE, 'payslip.repository.ts'));
    expect(repository).not.toContain('updateById');
    expect(repository).not.toContain('updateMany');
  });

  it('issuing writes no status onto the row', () => {
    const insert = service.slice(service.indexOf('$setOnInsert'), service.indexOf('upsert: true'));
    expect(insert.length).toBeGreaterThan(100);
    expect(insert).not.toContain('runStatus');
    expect(insert).not.toContain('status');
  });

  it('no migration backfills it — there is nothing stored to backfill', () => {
    const migrations = sources(API_SRC).filter((file) => file.endsWith('.migration.ts'));
    expect(migrations.length).toBeGreaterThan(0);
    for (const file of migrations) {
      expect(code(file), file.slice(API_SRC.length + 1)).not.toContain('runStatus');
    }
  });

  it('cancelling a run still writes nothing to any payslip', () => {
    expect(runService).not.toContain('PayslipModel');
    expect(runService).not.toContain('payslipRepository');
    expect(runService).not.toContain('payslipService');
  });
});

describe('it is read at read time, through one batch read', () => {
  it('the run repository answers with the status alone', () => {
    expect(runRepository).toContain('statusByIdsSystem');
    const method = runRepository.slice(runRepository.indexOf('statusByIdsSystem'));
    expect(method).toContain('select({ status: 1 })');
    // A projection is the guard: nothing else about a run can travel through this door.
    expect(method).not.toContain('paymentReference');
    expect(method).not.toContain('approvalNote');
  });

  it('the service resolves per page, not per row', () => {
    expect(service).toContain('runStatusReader');
    const reader = service.slice(
      service.indexOf('async runStatusReader'),
      service.indexOf('async toDtoOne'),
    );
    expect(reader).toContain('statusByIdsSystem');
    // One call for the whole page — a per-row lookup would be an N+1 on every payslip list.
    expect((reader.match(/statusByIdsSystem/g) ?? []).length).toBe(1);
  });

  it('every mapping passes a status in — none defaults one', () => {
    // `toDto` takes it as a parameter, so a call site cannot silently omit it.
    expect(service).toMatch(/toDto\(doc: PayslipDoc, runStatus: PayrollRunStatus \| null\)/);
    expect(controller).not.toMatch(/toDto\([^,)]*\)/);
    // The null decision is made once, in the reader, rather than at each call site.
    expect((service.match(/\?\? null/g) ?? []).length).toBe(1);
  });

  it('and the two cross-run lists — the ones the finding is about — are covered', () => {
    for (const handler of ['listEmployeePayslips', 'listMyPayslips']) {
      const from = controller.indexOf(`export const ${handler}`);
      expect(from, handler).toBeGreaterThan(-1);
      // To the NEXT handler, not to the first `};` — one of these bodies builds an object literal
      // of its own, and a slice that stopped there would prove nothing about the rest of it.
      const next = controller.indexOf('export const ', from + 1);
      const body = controller.slice(from, next === -1 ? undefined : next);
      expect(body, handler).toContain('runStatusReader');
    }
  });
});

describe('the two rejected options stay rejected', () => {
  it('nothing hides a cancelled run’s payslips from any list', () => {
    for (const file of sources(PAYROLL).filter((f) => f.includes('payslip'))) {
      const source = code(file);
      expect(source, file).not.toContain("$ne: 'cancelled'");
      expect(source, file).not.toContain("status: 'cancelled'");
      expect(source, file).not.toContain('excludeCancelled');
    }
    // The employee-facing reads filter by employee and period, and by nothing else.
    const mine = service.slice(service.indexOf('async listMine'), service.indexOf('async getMine'));
    expect(mine).toContain('employeeId');
    expect(mine).toContain('period');
    expect(mine).not.toContain('runId');
  });

  it('a run that issued payslips can still be cancelled', () => {
    expect(contracts).toContain(
      "export const CANCELLABLE_PAYROLL_RUN_STATUSES = ['draft', 'frozen', 'approved'] as const;",
    );
    expect(runService).not.toContain('cannot cancel a run that has issued');
  });
});

describe('and nothing else was added', () => {
  it('no new route, no new permission, no new event', () => {
    expect(routes).not.toContain('runStatus');
    // The two keys PY-7 chose, in the order the file declares them — issuing under
    // `payrollRun.manage`, every read under `employee.viewCompensation`. A1 added neither.
    expect([...routes.matchAll(/authorize\('([^']+)'\)/g)].map((m) => m[1])).toEqual([
      'employee.viewCompensation',
      'payrollRun.manage',
      'employee.viewCompensation',
      'employee.viewCompensation',
    ]);
    for (const source of [service, controller, routes]) {
      expect(source).not.toContain('eventBus');
      expect(source).not.toContain('notificationService');
    }
  });

  it('no new index — runs are fetched by their own _id', () => {
    const runModel = code(resolve(PAYROLL, 'runs/payroll-run.model.ts'));
    expect([...runModel.matchAll(/name: '([a-z_]+)'/g)].map((m) => m[1])).toEqual([
      'ux_live_period',
      'ix_status_period',
    ]);
  });

  it('the DTO says the status is the RUN’s, and adds no payslip state', () => {
    const dto = contracts.slice(
      contracts.indexOf('export interface PayslipDto'),
      contracts.indexOf('export const GeneratePayslipsSchema'),
    );
    expect(dto).toContain('runStatus: PayrollRunStatus | null;');
    for (const forbidden of ['paidAt', 'paymentStatus', 'voided', 'superseded']) {
      expect(dto, forbidden).not.toContain(forbidden);
    }
  });
});
