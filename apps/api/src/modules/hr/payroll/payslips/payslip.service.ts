// Issuing payslips (PY-7) — the first thing in this system that writes a figure down.
//
// THE ONE PRECONDITION: the run is FROZEN. A draft has not pinned anything, so every leave line
// would read `pendingLeaveSnapshot` and every quantity line `pendingQuantity`; a cancelled run is
// no longer the period's answer, and PY-5 already stops pricing leave from one. Neither refusal is
// a policy invented here — both are what the ports return, stated as a precondition so the batch
// fails with a sentence instead of producing a page of skips.
//
// THE POPULATION: everyone employed for any part of the period, exited included. Somebody who left
// on the 10th worked ten days and is owed for them.
//
// IDEMPOTENT, BY THE SAME MOVE PY-6 USED. Each row is written under `$setOnInsert` against a
// unique `(runId, employeeId)`, so a second pass — after an interruption, or a month later —
// finds every row already there and writes nothing. That is the point rather than a convenience:
// re-running would otherwise restate a delivered document with today's salary, which is the exact
// failure this whole phase exists to prevent.
//
// NO RECALCULATION LIVES HERE. Every figure comes from `computeCompensation` through PY-3's
// assembly; this file decides who and when, copies what came back, and adds nothing to it.
import { Types } from 'mongoose';
import {
  fromMinorUnits,
  type GeneratePayslipsResultDto,
  type ListPayslipsQuery,
  type Paginated,
  type PayslipDto,
  type PayslipSkipReason,
} from '@ecms/contracts';
import { BusinessRuleError, NotFoundError } from '../../../../shared/errors';
import { auditService } from '../../../../platform/audit';
import { jobTitleService } from '../../../../platform/organization';
import { type ScopeSelector } from '../../../../shared/types';
import { dateOnlyIso } from '../../shared/business-date';
import { employeeRepository, type EmployeeDoc } from '../../employee-management/employees';
import { compensationService } from '../compensation/compensation.service';
import { employmentSpansOf } from '../compensation/employment-spans';
import { periodRange } from '../compensation/compensation-rules';
import { payrollRunRepository } from '../runs/payroll-run.repository';
import { employedDuring, skipReasonFor } from './payslip-eligibility';
import { PayslipModel, type PayslipDoc } from './payslip.model';
import { payslipRepository } from './payslip.repository';

const entityRef = (id: string) => ({ moduleId: 'hr', entityType: 'payslip', entityId: id });

/** PY-3 refuses these before a result exists, so its message is mapped back onto the vocabulary. */
const refusalReason = (message: string): PayslipSkipReason =>
  message.includes('no basic salary') ? 'noBasicSalary' : 'mixedCurrency';

class PayslipService {
  /**
   * Issue every payslip this run is owed.
   *
   * Skips are REPORTED, never thrown: an employee with no basic salary or a line still waiting for
   * a figure is a state somebody has to fix, and failing the whole batch over one of them would
   * leave the other four hundred unissued.
   */
  async generateFor(runId: string, by: string): Promise<GeneratePayslipsResultDto> {
    const run = await payrollRunRepository.getById(runId);
    if (run.status !== 'frozen') {
      throw new BusinessRuleError(
        `payslips can only be issued from a frozen run — this one is ${run.status}`,
      );
    }
    const window = periodRange(run.period);

    const everyone = await employeeRepository.listAllSystem();
    const population = everyone.filter((employee) =>
      employedDuring(employmentSpansOf(employee), window),
    );

    const issuedAt = new Date();
    const skipped: { employeeId: string; reason: PayslipSkipReason }[] = [];
    let created = 0;
    let existing = 0;

    for (const employee of population) {
      const employeeId = String(employee._id);
      let effects;
      try {
        effects = await compensationService.effectsForEmployee(employee, run.period);
      } catch (error) {
        // Only the calculation's OWN refusals are a skip. Anything else — a dropped connection, a
        // bug — must keep travelling, or a batch would report "no basic salary" for a database
        // that was on fire.
        if (!(error instanceof BusinessRuleError)) throw error;
        skipped.push({ employeeId, reason: refusalReason(error.message) });
        continue;
      }

      const reason = skipReasonFor(effects);
      if (reason !== null) {
        skipped.push({ employeeId, reason });
        continue;
      }

      const written = await PayslipModel.updateOne(
        { runId: new Types.ObjectId(runId), employeeId: new Types.ObjectId(employeeId) },
        {
          $setOnInsert: {
            period: run.period,
            employee: await this.identityOf(employee),
            currency: effects.currency,
            basicSalary: effects.basicSalary,
            employmentDaysInPeriod: effects.employmentDaysInPeriod,
            daysInPeriod: effects.daysInPeriod,
            earnings: effects.earnings,
            deductions: effects.deductions,
            leave: effects.leave,
            totalEarningsMinor: effects.totalEarningsMinor,
            totalDeductionsMinor: effects.totalDeductionsMinor,
            netMinor: effects.netMinor,
            warnings: effects.warnings,
            issuedAt,
            issuedBy: new Types.ObjectId(by),
            branchId: employee.employment.branchId,
            isDeleted: false,
            createdBy: new Types.ObjectId(by),
            updatedBy: null,
          },
        },
        { upsert: true },
      ).exec();

      if (written.upsertedCount > 0) created += 1;
      else existing += 1;
    }

    // One audit entry for the PASS, not one per slip: the act somebody performed was issuing a
    // run's payslips, and four hundred rows saying the same thing would bury it.
    await auditService.record({
      entityRef: entityRef(runId),
      action: 'create',
      changes: [
        { field: 'period', old: null, new: run.period },
        { field: 'created', old: null, new: String(created) },
        { field: 'existing', old: null, new: String(existing) },
        { field: 'skipped', old: null, new: String(skipped.length) },
      ],
    });

    return {
      runId,
      period: run.period,
      considered: population.length,
      created,
      existing,
      skipped,
    };
  }

  /** Identity as it stands now — copied onto the slip so a later transfer cannot retitle it. */
  private async identityOf(employee: EmployeeDoc): Promise<PayslipDoc['employee']> {
    const title = await jobTitleService
      .getById(String(employee.employment.jobTitleId))
      .catch(() => null);
    return {
      code: employee.code,
      fullNameAr: employee.personal.fullNameAr,
      fullNameEn: employee.personal.fullNameEn,
      jobTitle: title === null ? null : { ar: title.name.ar, en: title.name.en },
    };
  }

  async listForRun(
    runId: string,
    query: ListPayslipsQuery,
    scope: ScopeSelector,
  ): Promise<Paginated<PayslipDoc>> {
    await payrollRunRepository.getById(runId);
    return payslipRepository.list({
      filter: {
        runId: new Types.ObjectId(runId),
        ...(query.employeeId === undefined
          ? {}
          : { employeeId: new Types.ObjectId(query.employeeId) }),
      },
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy ?? 'createdAt',
      sortDir: query.sortDir,
      sortableFields: ['createdAt', 'netMinor', 'period'],
      scope,
    });
  }

  /**
   * The caller's OWN payslips (PY-11) — own-scope by construction.
   *
   * The employee is resolved from the login link and nothing the caller sends can widen that, so
   * this path carries no permission and no scope selector: there is no wider set to reach. It is
   * the posture `/days/me` and My Leave already have, applied to the one document an employee is
   * most entitled to see — their own pay.
   */
  async listMine(userId: string, query: ListPayslipsQuery): Promise<Paginated<PayslipDoc>> {
    const employee = await employeeRepository.findByUserIdSystem(userId);
    if (employee === null) throw new NotFoundError('no employee is linked to this login');
    return payslipRepository.list({
      filter: {
        employeeId: employee._id as Types.ObjectId,
        ...(query.period === undefined ? {} : { period: query.period }),
      },
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy ?? 'period',
      sortDir: query.sortDir ?? 'desc',
      sortableFields: ['createdAt', 'netMinor', 'period'],
    });
  }

  /** One of the caller's OWN payslips. Same posture: the id is checked against their employee. */
  async getMine(userId: string, id: string): Promise<PayslipDoc> {
    const employee = await employeeRepository.findByUserIdSystem(userId);
    if (employee === null) throw new NotFoundError('no employee is linked to this login');
    const doc = await payslipRepository.findById(id);
    // Not-found rather than forbidden: somebody else's payslip is not a thing this caller may
    // learn the existence of.
    if (doc === null || String(doc.employeeId) !== String(employee._id)) {
      throw new NotFoundError('payslip not found');
    }
    return doc;
  }

  async getById(id: string, scope: ScopeSelector): Promise<PayslipDoc> {
    const doc = await payslipRepository.findById(id, scope);
    if (doc === null) throw new NotFoundError('payslip not found');
    return doc;
  }

  toDto(doc: PayslipDoc): PayslipDto {
    const window = periodRange(doc.period);
    return {
      id: String(doc._id),
      runId: String(doc.runId),
      period: doc.period,
      from: dateOnlyIso(window.from),
      to: dateOnlyIso(window.to),
      employeeId: String(doc.employeeId),
      employee: doc.employee,
      currency: doc.currency,
      basicSalary: doc.basicSalary,
      employmentDaysInPeriod: doc.employmentDaysInPeriod,
      daysInPeriod: doc.daysInPeriod,
      earnings: doc.earnings,
      deductions: doc.deductions,
      leave: doc.leave,
      // Minor units are what was stored; the major figure is DERIVED from them on the way out,
      // through the same conversion every other payroll total uses. Storing both would let the
      // two drift on a document nobody may edit.
      totalEarningsMinor: doc.totalEarningsMinor,
      totalEarnings: fromMinorUnits(doc.totalEarningsMinor),
      totalDeductionsMinor: doc.totalDeductionsMinor,
      totalDeductions: fromMinorUnits(doc.totalDeductionsMinor),
      netMinor: doc.netMinor,
      net: fromMinorUnits(doc.netMinor),
      warnings: doc.warnings,
      issuedAt: doc.issuedAt.toISOString(),
      issuedBy: String(doc.issuedBy),
      createdAt: doc.createdAt.toISOString(),
    };
  }
}

export const payslipService = new PayslipService();
