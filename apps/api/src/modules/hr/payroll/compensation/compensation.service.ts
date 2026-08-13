// Compensation effects (PY-3) — gathering, not calculating.
//
// Every rule lives in `compensation-rules.ts`, which is pure. This file only assembles what that
// engine needs: the employee (resolved inside the caller's compensation scope), the assignments
// whose interval touches the period, the catalog rows they cite, — when a quantity item is among
// them — the period's FROZEN attendance (PY-4), and the leave that period's run pinned (PY-5).
// Both of the last two arrive through their own narrow port and both answer `null` for "no run
// has settled this yet", which is a different thing from zero.
//
// It stores nothing: a calculation is a question asked of today's data over yesterday's frozen
// facts, and archiving the answer is not this endpoint's job.
import { Types } from 'mongoose';
import { type CompensationEffectsDto } from '@ecms/contracts';
import { type ScopeSelector } from '../../../../shared/types';
import { employeeRepository, type EmployeeDoc } from '../../employee-management/employees';
import { employeeActionRepository } from '../../employee-management/employee-actions';
import { readableChanges, salaryAsOf } from './salary-history';
import { payItemRepository } from '../pay-items/pay-item.repository';
import { EmployeePayItemModel } from '../employee-pay-items/employee-pay-item.model';
import {
  computeCompensation,
  periodRange,
  type AssignmentInput,
} from './compensation-rules';
import { employmentSpansOf } from './employment-spans';
import { attendanceQuantityPort } from './attendance-quantity.port';
import { leaveSnapshotPort } from './leave-snapshot.port';
import { adjustmentPort } from './adjustment.port';
import { loanInstallmentPort } from './loan-installment.port';

class CompensationService {
  /**
   * What this employee's pay items come to over one period.
   *
   * The scope is spent on the EMPLOYEE, exactly as the pay-item assignments spend it, so an
   * employee outside the caller's compensation reach is not found rather than not permitted.
   */
  async effectsFor(
    employeeId: string,
    period: string,
    scope: ScopeSelector,
  ): Promise<CompensationEffectsDto> {
    return this.effectsForEmployee(await employeeRepository.getById(employeeId, scope), period);
  }

  /**
   * The same calculation for an employee already in hand — the batch path (PY-7).
   *
   * Split out rather than duplicated: issuing a run's payslips resolves its own population (every
   * employee employed for any part of the period, which no caller's scope decides) and would
   * otherwise re-read each employee one at a time through a scope it has no use for. The rules
   * below are untouched; only the fetch above moved.
   */
  async effectsForEmployee(employee: EmployeeDoc, period: string): Promise<CompensationEffectsDto> {
    const employeeId = String(employee._id);
    const { from, to } = periodRange(period);

    // Every assignment whose interval touches the period — the same intersection test the overlap
    // guard uses, with the period as the window.
    const rows = await EmployeePayItemModel.find({
      employeeId: new Types.ObjectId(employeeId),
      isDeleted: false,
      effectiveFrom: { $lte: to },
      $or: [{ effectiveTo: null }, { effectiveTo: { $gte: from } }],
    })
      .lean()
      .exec();

    const assignments: AssignmentInput[] = [];
    if (rows.length > 0) {
      const itemIds = [...new Set(rows.map((row) => String(row.payItemId)))];
      const catalog = await payItemRepository.list({
        filter: { _id: { $in: itemIds.map((id) => new Types.ObjectId(id)) } },
        page: 1,
        pageSize: itemIds.length,
      });
      const byId = new Map(catalog.items.map((item) => [String(item._id), item]));

      for (const row of rows) {
        const item = byId.get(String(row.payItemId));
        // A row whose catalog entry is gone cannot be priced — its kind and basis ARE its meaning.
        // Archived items still price: archiving stops NEW assignments, it does not unpay old ones.
        if (item === undefined) continue;
        assignments.push({
          id: String(row._id),
          payItemId: String(row.payItemId),
          amount: row.amount,
          currency: row.currency,
          effectiveFrom: row.effectiveFrom,
          effectiveTo: row.effectiveTo,
          item: {
            code: item.code,
            name: item.name,
            kind: item.kind,
            calcBasis: item.calcBasis,
            quantitySource: item.quantitySource,
            sortOrder: item.sortOrder,
          },
        });
      }
    }

    // PY-4 — the frozen attendance for this period, or null when it is not frozen. Asked for
    // ONLY when something actually needs it: a month with no quantity item should not pay for a
    // feed read, and an unfrozen month should not look like a failure on a screen that has
    // nothing to do with attendance.
    const needsQuantities = assignments.some(
      (a) => a.item.calcBasis === 'perDay' || a.item.calcBasis === 'perMinute',
    );
    const attendance = needsQuantities
      ? await attendanceQuantityPort.frozenFor(period, employeeId)
      : null;

    // PY-5 — the leave the period's run pinned, or null when no run has. Asked for UNCONDITIONALLY,
    // unlike the attendance read above: a quantity line only exists when an item was assigned, but
    // leave costs money whether or not anybody configured anything, so "nobody assigned an item"
    // is not a reason to skip the question.
    const leave = await leaveSnapshotPort.frozenFor(period, employeeId);

    // PY-8 — the basic salary AS IT WAS, not as it is. `employment.salary` is a single current
    // value that a raise overwrites, so reading it directly let a completed month restate itself
    // months later. The action log dates every change, and the engine is the only writer, so the
    // value in force is recovered by walking backwards rather than by storing a second copy.
    //
    // The date asked about is the period's LAST DAY: the same answer the system would have given
    // while the month was current, and stable forever afterwards.
    const basicSalary = salaryAsOf(
      employee.employment.salary,
      readableChanges(await employeeActionRepository.listAppliedSalaryChanges(employeeId)),
      to,
    );

    // P-HR-04 — the approved one-off decisions for this month. Asked for unconditionally, like
    // leave and unlike attendance: a bonus costs money whether or not anybody configured a pay
    // item, so "nothing is assigned" is not a reason to skip the question.
    const adjustments = await adjustmentPort.approvedFor(employeeId, period);

    // P-HR-05-B — what a debt costs this month. Unconditional for the same reason: an instalment
    // is owed whether or not anything else about this employee's pay was configured.
    const loanInstallments = await loanInstallmentPort.dueFor(employeeId, period);

    return computeCompensation({
      employeeId,
      period,
      basicSalary,
      attendance,
      leave,
      employmentSpans: employmentSpansOf(employee),
      assignments,
      // D1 — the older list is not read. Saying so beats leaving the reader to wonder why a figure
      // they can see on the employment tab is missing from this one.
      hasLegacyAllowances: (employee.employment.allowances ?? []).length > 0,
      adjustments,
      loanInstallments,
    });
  }
}

export const compensationService = new CompensationService();
